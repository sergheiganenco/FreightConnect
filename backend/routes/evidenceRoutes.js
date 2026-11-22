/**
 * Photo evidence at pickup and delivery. Mounted at /api (paths are /loads/:id/evidence...).
 *
 * Files live in PRIVATE_DIR = public/documents/load-evidence. That sits inside the
 * Render persistent disk (mounted at public/documents) so photos survive deploys, but
 * no express.static mount serves it (app.js also adds an explicit 404 for the path);
 * the only way to read a photo is GET .../file, which checks the caller is a load party.
 *
 * Immutable: there is no update endpoint. Delete is limited to the uploading
 * company, within 10 minutes, before the load leaves that stage. Admins cannot delete.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const multer = require('multer');
const { body, param } = require('express-validator');
const auth = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validate');
const { makeLimiter } = require('../middlewares/rateLimiter');
const Load = require('../models/Load');
const User = require('../models/User');
const StatusHistory = require('../models/StatusHistory');
const { notifyUserSafe } = require('../utils/notifyUser');
const { haversineMiles } = require('../utils/geo');

const router = express.Router();

const PRIVATE_DIR = path.join(__dirname, '..', 'public', 'documents', 'load-evidence');
try { fs.mkdirSync(PRIVATE_DIR, { recursive: true }); } catch (_) {}

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PER_LOAD = 30;
const DELETE_WINDOW_MS = 10 * 60 * 1000;
const POST_DELIVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const CLIENT_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
// ponytail: HEIC/HEIF deliberately unsupported - browsers can't render it and a safe
// header check isn't worth it; phone camera pickers convert to JPEG.

const uploadLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many uploads, please try again later' },
}, 'rl:evidence:');

// Memory storage: nothing touches disk until type, size and magic bytes all pass.
const mem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = Object.prototype.hasOwnProperty.call(EXT, file.mimetype || '')
      && CLIENT_EXTS.has(path.extname(file.originalname || '').toLowerCase());
    cb(ok ? null : new Error('Only JPEG, PNG or WEBP photos are allowed'), ok);
  },
});
function uploadOne(req, res, next) {
  mem.single('file')(req, res, (err) => {
    if (!err) return next();
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'Photo is larger than 10 MB' : (err.message || 'Upload rejected') });
  });
}

/** Real type from the leading bytes - the declared mimetype/extension are not trusted. */
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

const companyOf = (req) => String(req.user.companyOwnerId || req.user.userId);
const isCarrierOf = (load, req) => req.user.role === 'carrier' && String(load.acceptedBy) === companyOf(req);
const isParty = (load, req) =>
  req.user.role === 'admin' || String(load.postedBy) === companyOf(req) || String(load.acceptedBy) === companyOf(req);
// eslint-disable-next-line no-control-regex
const clean = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
const num = (v) => (v === undefined || v === '' || v === null ? null : Number(v));

const idParam = param('id').isMongoId().withMessage('Invalid load id');
const evParam = param('evidenceId').isMongoId().withMessage('Invalid evidence id');
const rm = (file) => fs.promises.unlink(path.join(PRIVATE_DIR, path.basename(file))).catch(() => {});

function stageOpen(load, stage) {
  if (stage === 'pickup') return ['accepted', 'in-transit'].includes(load.status);
  if (load.status === 'in-transit') return true;
  return load.status === 'delivered' && !!load.deliveredAt && Date.now() - new Date(load.deliveredAt).getTime() <= POST_DELIVERY_WINDOW_MS;
}
// Deletable by the uploading company: <10 min old and the load has not left the stage.
function deletable(load, item, req) {
  return isCarrierOf(load, req)
    && String(item.companyId) === companyOf(req)
    && Date.now() - new Date(item.uploadedAt).getTime() <= DELETE_WINDOW_MS
    && load.status === (item.stage === 'pickup' ? 'accepted' : 'in-transit');
}
function view(load, item, req) {
  const o = item.toObject ? item.toObject() : item;
    delete o.file; delete o.companyId;
  return { ...o, uploadedBy: String(o.uploadedBy), deletable: deletable(load, item, req) };
}
const audit = (load, to, userId, reason, meta) =>
  StatusHistory.record('load', load._id, load.status, to, userId, reason, meta).catch(() => {});

// -- POST /loads/:id/evidence ------------------------------------------------
router.post('/loads/:id/evidence', auth,
  (req, res, next) => (req.user.role === 'carrier' ? next() : res.status(403).json({ error: 'Only the booked carrier can add photos' })),
  uploadLimiter, idParam, uploadOne,
  body('stage').isIn(['pickup', 'delivery']).withMessage('stage must be pickup or delivery'),
  body('kind').optional({ checkFalsy: true }).isIn(['cargo', 'seal', 'damage', 'paperwork', 'other']).withMessage('Invalid kind'),
  body('latitude').optional({ checkFalsy: true }).isFloat({ min: -90, max: 90 }).withMessage('latitude must be -90..90'),
  body('longitude').optional({ checkFalsy: true }).isFloat({ min: -180, max: 180 }).withMessage('longitude must be -180..180'),
  body('accuracyMeters').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('accuracyMeters must be >= 0'),
  body('sealNumber').optional().customSanitizer(clean).isLength({ max: 40 }).withMessage('sealNumber max 40 characters'),
  body('note').optional().customSanitizer(clean).isLength({ max: 300 }).withMessage('note max 300 characters'),
  validate,
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'A photo (field "file") is required' });
      const load = await Load.findById(req.params.id).select('+evidence');
      if (!load) return res.status(404).json({ error: 'Load not found' });
      if (!isCarrierOf(load, req)) return res.status(403).json({ error: 'Forbidden' });

      const { stage } = req.body;
      if (!stageOpen(load, stage)) {
        return res.status(409).json({ error: `Cannot add ${stage} photos while the load is ${load.status}` });
      }
      if (load.evidence.length >= MAX_PER_LOAD) {
        return res.status(409).json({ error: `Photo limit reached (${MAX_PER_LOAD} per load)` });
      }
      const type = sniff(req.file.buffer);
      if (!type || type !== req.file.mimetype) {
        return res.status(400).json({ error: 'File is not a valid JPEG, PNG or WEBP image' });
      }

      let lat = num(req.body.latitude), lng = num(req.body.longitude);
      if (lat === null || lng === null) { lat = null; lng = null; }
      const fLat = stage === 'pickup' ? load.originLat : load.destinationLat;
      const fLng = stage === 'pickup' ? load.originLng : load.destinationLng;
      const dist = lat !== null && typeof fLat === 'number' && typeof fLng === 'number'
        ? Math.round(haversineMiles(lat, lng, fLat, fLng) * 100) / 100 : null;

      let capturedAt = req.body.capturedAt ? new Date(req.body.capturedAt) : null;
      const now = Date.now();
      if (!capturedAt || isNaN(capturedAt) || capturedAt.getTime() > now + 5 * 60 * 1000 || capturedAt.getTime() < now - 24 * 3600 * 1000) capturedAt = null;

      const file = `${crypto.randomBytes(16).toString('hex')}${EXT[type]}`;
      await fs.promises.writeFile(path.join(PRIVATE_DIR, file), req.file.buffer, { flag: 'wx' });

      const item = {
        _id: new mongoose.Types.ObjectId(),
        stage, kind: req.body.kind || 'cargo', file, mimeType: type, sizeBytes: req.file.buffer.length,
        sha256: crypto.createHash('sha256').update(req.file.buffer).digest('hex'),
        capturedAt, uploadedAt: new Date(), uploadedBy: req.user.userId, companyId: companyOf(req),
        latitude: lat, longitude: lng, accuracyMeters: lat === null ? null : num(req.body.accuracyMeters),
        facilityDistanceMiles: dist,
        sealNumber: clean(req.body.sealNumber) || undefined, note: clean(req.body.note) || undefined,
      };
      // Atomic cap + status guard so parallel uploads cannot exceed the limit.
      const updated = await Load.findOneAndUpdate(
        { _id: load._id, status: load.status, [`evidence.${MAX_PER_LOAD - 1}`]: { $exists: false } },
        { $push: { evidence: item } }, { new: true }
      ).select('+evidence');
      if (!updated) {
        await rm(file);
        return res.status(409).json({ error: 'The load changed or the photo limit was reached; try again' });
      }
      await audit(load, 'evidence_added', req.user.userId, `${stage} photo added (${item.kind})`, { evidenceId: item._id, sha256: item.sha256 });
      if (updated.evidence.filter((e) => e.stage === stage).length === 1) {
        notifyUserSafe(load.postedBy, {
          type: 'load:evidence_added',
          title: `${stage === 'pickup' ? 'Pickup' : 'Delivery'} photos added`,
          body: `The carrier added the first ${stage} photo for "${load.title}".`,
          link: '/dashboard/shipper/loads',
          metadata: { loadId: load._id, stage },
        });
      }
      res.status(201).json({ success: true, data: view(updated, updated.evidence.id(item._id), req) });
    } catch (err) {
      console.error('[evidence-upload] failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

// -- GET /loads/:id/evidence - parties only ----------------------------------
router.get('/loads/:id/evidence', auth, idParam, validate, async (req, res) => {
  try {
    const load = await Load.findById(req.params.id).select('+evidence status deliveredAt postedBy acceptedBy evidenceRequired');
    if (!load) return res.status(404).json({ error: 'Load not found' });
    if (!isParty(load, req)) return res.status(403).json({ error: 'Forbidden' });
    const users = await User.find({ _id: { $in: load.evidence.map((e) => e.uploadedBy) } }).select('name').lean();
    const names = new Map(users.map((u) => [String(u._id), u.name]));
    res.json({
      success: true,
      data: {
        required: { pickup: !!load.evidenceRequired?.pickup, delivery: !!load.evidenceRequired?.delivery },
        canAdd: isCarrierOf(load, req) ? { pickup: stageOpen(load, 'pickup'), delivery: stageOpen(load, 'delivery') } : { pickup: false, delivery: false },
        items: load.evidence.map((e) => ({ ...view(load, e, req), uploadedByName: names.get(String(e.uploadedBy)) || null })),
      },
    });
  } catch (err) {
    console.error('[evidence-list] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// -- GET /loads/:id/evidence/:evidenceId/file - authenticated stream ---------
router.get('/loads/:id/evidence/:evidenceId/file', auth, idParam, evParam, validate, async (req, res) => {
  try {
    const load = await Load.findById(req.params.id).select('+evidence postedBy acceptedBy');
    if (!load) return res.status(404).json({ error: 'Load not found' });
    if (!isParty(load, req)) return res.status(403).json({ error: 'Forbidden' });
    const item = load.evidence.id(req.params.evidenceId);
    if (!item) return res.status(404).json({ error: 'Photo not found' });
    const full = path.resolve(PRIVATE_DIR, path.basename(item.file));
    if (path.dirname(full) !== path.resolve(PRIVATE_DIR) || !fs.existsSync(full)) return res.status(404).json({ error: 'Photo not found' });
    res.set({
      'Content-Type': item.mimeType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="evidence-${item._id}${EXT[item.mimeType] || ''}"`,
      'Cache-Control': 'private, max-age=300',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    fs.createReadStream(full).on('error', () => res.destroy()).pipe(res);
  } catch (err) {
    console.error('[evidence-file] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// -- DELETE /loads/:id/evidence/:evidenceId - uploader's company, 10 min -----
router.delete('/loads/:id/evidence/:evidenceId', auth, idParam, evParam, validate, async (req, res) => {
  try {
    const load = await Load.findById(req.params.id).select('+evidence status acceptedBy postedBy title');
    if (!load) return res.status(404).json({ error: 'Load not found' });
    if (!isParty(load, req)) return res.status(403).json({ error: 'Forbidden' });
    const item = load.evidence.id(req.params.evidenceId);
    if (!item) return res.status(404).json({ error: 'Photo not found' });
    if (!deletable(load, item, req)) {
      return res.status(403).json({ error: 'Photos can only be removed by the uploading carrier within 10 minutes, before the load leaves that stage' });
    }
    const done = await Load.updateOne({ _id: load._id, status: load.status }, { $pull: { evidence: { _id: item._id } } });
    if (!done.modifiedCount) return res.status(409).json({ error: 'The load changed; try again' });
    await rm(item.file);
    await audit(load, 'evidence_removed', req.user.userId, `${item.stage} photo removed (${item.kind})`, { evidenceId: item._id, sha256: item.sha256 });
    res.json({ success: true });
  } catch (err) {
    console.error('[evidence-delete] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// -- PUT /loads/:id/evidence-required - shipper (open/booked) or admin -------
router.put('/loads/:id/evidence-required', auth, idParam,
  body('pickup').optional().isBoolean({ strict: true }), body('delivery').optional().isBoolean({ strict: true }), validate,
  async (req, res) => {
    try {
      const load = await Load.findById(req.params.id).select('postedBy status evidenceRequired');
      if (!load) return res.status(404).json({ error: 'Load not found' });
      const ok = req.user.role === 'admin' || (req.user.role === 'shipper' && String(load.postedBy) === companyOf(req));
      if (!ok) return res.status(403).json({ error: 'Forbidden' });
      if (!['open', 'accepted'].includes(load.status)) {
        return res.status(409).json({ error: 'Photo requirements can only be changed while the load is open or booked' });
      }
      const set = {};
      for (const k of ['pickup', 'delivery']) {
        if (typeof req.body[k] !== 'boolean') continue;
        if (!req.body[k] && load.status === 'accepted' && req.user.role !== 'admin') {
          return res.status(403).json({ error: 'Photo requirements cannot be turned off once the load is booked' });
        }
        set[`evidenceRequired.${k}`] = req.body[k];
      }
      if (Object.keys(set).length) await Load.updateOne({ _id: load._id, status: load.status }, { $set: set });
      const fresh = await Load.findById(load._id).select('evidenceRequired').lean();
      res.json({ success: true, data: { pickup: !!fresh.evidenceRequired?.pickup, delivery: !!fresh.evidenceRequired?.delivery } });
    } catch (err) {
      console.error('[evidence-required] failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

module.exports = router;
module.exports.PRIVATE_DIR = PRIVATE_DIR;
