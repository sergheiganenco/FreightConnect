// Strict validation for pickup/delivery time windows written when a load is CREATED (bulk API, EDI, shipper form).
// Booked loads' windows change only through the dedicated PUT /loads/:id/{pickup,delivery}-window endpoints.
const validator = require('validator');

const ZONE = /T.*(Z|[+-]\d{2}(:?\d{2})?)$/i;

// One bound -> Date, or null when absent (undefined/null/''), or throws Error on anything invalid.
function parseBound(v, name, requireZone) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new Error(`${name} is not a valid date`);
    return v;
  }
  if (typeof v !== 'string' || !validator.isISO8601(v, { strict: true, strictSeparator: true })
    || (requireZone && !ZONE.test(v))) {
    throw new Error(`${name} must be an ISO-8601 date-time${requireZone ? ' with a timezone' : ''}, e.g. 2026-06-01T14:00:00Z`);
  }
  return new Date(v);
}

/**
 * @param {*} w  { start, end } or absent
 * @returns {{start: Date, end?: Date}|undefined} the parsed window (undefined when absent). Throws Error with a
 * user-presentable message when invalid: start required if any bound is given, end must not precede start.
 */
function parseWindow(w, name, { requireZone = false } = {}) {
  if (w == null || (typeof w === 'object' && !(w instanceof Date) && w.start == null && w.end == null)) return undefined;
  if (typeof w !== 'object' || w instanceof Date) throw new Error(`${name} must be an object with start and end`);
  const start = parseBound(w.start, `${name}.start`, requireZone);
  const end = parseBound(w.end, `${name}.end`, requireZone);
  if (!start) throw new Error(`${name}.start is required`);
  if (end && end.getTime() < start.getTime()) throw new Error(`${name}.end must not be before start`);
  return end ? { start, end } : { start };
}

module.exports = { parseWindow, parseBound };
