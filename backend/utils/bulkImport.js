/**
 * Shared bulk-import engine for User.fleet[] (trucks) and User.drivers[] (roster).
 * Validates every row, then either reports (dryRun) or appends ALL rows in one
 * atomic updateOne guarded against concurrent duplicate imports. All-or-nothing.
 */
const User = require('../models/User');

const MAX_ROWS = 2000;
const MAX_TOTAL = 5000; // keeps the owner doc far below Mongo's 16MB limit

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Per-row field helpers. `err(field, message)` records a row error.
function makeRow(raw, err) {
  const get = (field, { required = false, max = 100 } = {}) => {
    const v = raw[field];
    if (v === undefined || v === null || v === '') {
      if (required) err(field, `${field} is required`);
      return undefined;
    }
    if (typeof v !== 'string') { err(field, `${field} must be a string`); return undefined; }
    const s = v.trim();
    if (!s) { if (required) err(field, `${field} is required`); return undefined; }
    if (s.length > max) { err(field, `${field} must be at most ${max} characters`); return undefined; }
    return s;
  };
  const oneOf = (field, allowed, fallback) => {
    const s = get(field, { max: 50 });
    if (s === undefined) return fallback;
    const hit = allowed.find((a) => a.toLowerCase() === s.toLowerCase());
    if (!hit) err(field, `${field} must be one of: ${allowed.join(', ')}`);
    return hit;
  };
  const date = (field) => {
    const s = get(field, { max: 10 });
    if (s === undefined) return undefined;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    if (!DATE_RE.test(s) || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      err(field, `${field} must be a real date in YYYY-MM-DD format`);
      return undefined;
    }
    return dt;
  };
  return { get, oneOf, date };
}

/**
 * opts: { arrayName, bodyKey, idField, parseRow(row, rowHelpers) -> doc, genId?(takenSet) }
 */
async function bulkImport(req, res, opts) {
  const { arrayName, bodyKey, idField, parseRow, genId } = opts;
  try {
    if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
    const rows = req.body[bodyKey];
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: `${bodyKey} must be a non-empty array` });
    }
    if (rows.length > MAX_ROWS) {
      return res.status(400).json({ error: `At most ${MAX_ROWS} rows per import (got ${rows.length})` });
    }

    const ownerId = req.user.companyOwnerId || req.user.userId;
    const owner = await User.findById(ownerId).select(arrayName).lean();
    if (!owner) return res.status(404).json({ error: 'Carrier not found' });
    const existing = owner[arrayName] || [];
    if (existing.length + rows.length > MAX_TOTAL) {
      return res.status(400).json({
        error: `Import would exceed the ${MAX_TOTAL} limit (currently ${existing.length}, importing ${rows.length})`,
      });
    }

    const taken = new Set(existing.map((e) => String(e[idField]).trim().toLowerCase()));
    const seen = new Map(); // lowercased id -> first row number in file
    const errors = [];
    const docs = [];
    rows.forEach((raw, i) => {
      const row = i + 1;
      const err = (field, message) => errors.push({ row, field, message });
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return err('row', 'Row must be an object');
      const doc = parseRow(raw, makeRow(raw, err), err);
      const id = doc && doc[idField];
      if (id) {
        const key = id.toLowerCase();
        if (seen.has(key)) err(idField, `${idField} "${id}" is duplicated in the file (also row ${seen.get(key)})`);
        else if (taken.has(key)) err(idField, `${idField} "${id}" already exists`);
        else seen.set(key, row);
      }
      docs.push(doc);
    });

    // Rows with no supplied id get a generated one (unique vs roster and file).
    if (genId && !errors.length) {
      const all = new Set([...taken, ...seen.keys()]);
      docs.forEach((d) => { if (!d[idField]) { d[idField] = genId(all); all.add(d[idField].toLowerCase()); } });
    }

    const dryRun = req.query.dryRun === 'true';
    if (dryRun) return res.json({ dryRun: true, valid: errors.length === 0, count: rows.length, errors });
    if (errors.length) return res.status(400).json({ error: 'Import has invalid rows; nothing was imported', errors });

    // One atomic write. Guard: none of the new ids exist yet (concurrent import) and
    // the array still has room (index MAX_TOTAL-n must not exist).
    const result = await User.updateOne(
      {
        _id: ownerId,
        [`${arrayName}.${idField}`]: { $nin: docs.map((d) => d[idField]) },
        [`${arrayName}.${MAX_TOTAL - docs.length}`]: { $exists: false },
      },
      { $push: { [arrayName]: { $each: docs } } }
    );
    if (!result.modifiedCount) {
      return res.status(409).json({ error: 'Conflict: the roster changed during import (duplicate ids or size limit). Nothing was imported; retry.' });
    }
    res.status(201).json({ added: docs.length });
  } catch (err) {
    console.error(`[bulk ${arrayName}] failed:`, err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { bulkImport, MAX_ROWS };
