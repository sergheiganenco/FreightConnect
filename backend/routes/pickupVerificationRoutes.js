/**
 * Pickup handshake routes — mounted at /api (see app.js).
 *
 * Authenticated (under /api/loads/:id):
 *   GET  /loads/:id/pickup-code      booked carrier company ONLY, while accepted & unverified
 *   POST /loads/:id/dock-link        shipper company / admin — mint the public dock link token
 *   POST /loads/:id/pickup-verify    shipper company / admin — enter the driver's code
 *   POST /loads/:id/pickup-unlock    shipper company / admin — clear a lockout
 *   PUT  /loads/:id/pickup-required  shipper company / admin — require the handshake
 * Public (no account — the dock worker):
 *   GET  /dock/:token                what a dock needs to compare against the driver
 *   POST /dock/:token/verify {code}  verify (5 wrong codes → locked)
 */
const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();
const auth = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validate');
const { makeLimiter } = require('../middlewares/rateLimiter');
const Load = require('../models/Load');
const svc = require('../services/pickupVerificationService');

const dockInfoLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
}, 'rl:dockinfo:');
const dockVerifyLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
}, 'rl:dockverify:');

const companyOf = (req) => req.user.companyOwnerId || req.user.userId;
const isShipperOf = (load, req) =>
  req.user.role === 'admin' || (req.user.role === 'shipper' && String(load.postedBy) === String(companyOf(req)));
const idParam = param('id').isMongoId().withMessage('Invalid load id');

// Resolve the load for a shipper/admin action; sends the error response itself.
async function loadForShipper(req, res) {
  const load = await Load.findById(req.params.id).select('postedBy acceptedBy status pickupVerification.required pickupVerification.verifiedAt');
  if (!load) { res.status(404).json({ error: 'Load not found' }); return null; }
  if (!isShipperOf(load, req)) { res.status(403).json({ error: 'Forbidden' }); return null; }
  return load;
}

// ── Carrier: show the code (booked carrier company only) ─────────────────────
router.get('/loads/:id/pickup-code', auth, idParam, validate, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Forbidden' });
    const load = await Load.findById(req.params.id).select('+pickupVerification.code acceptedBy status pickupVerification.verifiedAt');
    // Same answer for "not found" and "not yours" — don't reveal other carriers' loads.
    if (!load || !load.acceptedBy || String(load.acceptedBy) !== String(companyOf(req))) {
      return res.status(404).json({ error: 'Load not found' });
    }
    res.set('Cache-Control', 'no-store');
    const pv = load.pickupVerification || {};
    if (pv.verifiedAt) return res.json({ verified: true, verifiedAt: pv.verifiedAt });
    if (load.status !== 'accepted') return res.status(409).json({ error: 'A pickup code is only available while the load is booked and awaiting pickup' });
    if (!pv.code) return res.status(404).json({ error: 'No pickup code was issued for this load' });
    res.json({ verified: false, code: pv.code });
  } catch (err) {
    console.error('[pickup-code] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Shipper/admin: mint the dock link ────────────────────────────────────────
router.post('/loads/:id/dock-link', auth, idParam, validate, async (req, res) => {
  try {
    const load = await loadForShipper(req, res);
    if (!load) return;
    const { token, expiresAt } = svc.signDockToken(load._id);
    res.set('Cache-Control', 'no-store');
    res.status(201).json({ token, path: `/dock/${token}`, expiresAt });
  } catch (err) {
    console.error('[dock-link] failed:', err.message);
    res.status(500).json({ error: 'Failed to generate dock link' });
  }
});

// ── Shipper/admin: verify in-app with the driver's code ──────────────────────
router.post('/loads/:id/pickup-verify', auth, idParam, body('code').isString().trim().isLength({ max: 12 }), validate, async (req, res) => {
  try {
    const load = await loadForShipper(req, res);
    if (!load) return;
    const out = await svc.attemptVerify({
      loadId: load._id, code: req.body.code,
      verifiedBy: req.user.role === 'admin' ? 'admin' : 'shipper', actorId: req.user.userId,
    });
    res.status(out.http).json(out.body);
  } catch (err) {
    console.error('[pickup-verify] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/loads/:id/pickup-unlock', auth, idParam, validate, async (req, res) => {
  try {
    const load = await loadForShipper(req, res);
    if (!load) return;
    if (!(await svc.unlock({ loadId: load._id, actorId: req.user.userId }))) {
      return res.status(409).json({ error: 'Pickup verification is not locked' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[pickup-unlock] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Shipper/admin: require (or, admin only after booking, stop requiring) ────
router.put('/loads/:id/pickup-required', auth, idParam, body('required').isBoolean({ strict: true }), validate, async (req, res) => {
  try {
    const load = await loadForShipper(req, res);
    if (!load) return;
    const want = req.body.required;
    if (!['open', 'accepted'].includes(load.status)) {
      return res.status(409).json({ error: 'Pickup verification can only be changed while the load is open or booked' });
    }
    // A hijacked shipper session must not be able to quietly disable the check.
    if (!want && load.status === 'accepted' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Pickup verification cannot be turned off once the load is booked' });
    }
    await Load.updateOne({ _id: load._id, status: load.status }, { $set: { 'pickupVerification.required': want } });
    if (want && load.status === 'accepted') {
      // Legacy loads booked before this feature have no code yet — issue one so the carrier can pass.
      const crypto = require('crypto');
      await Load.updateOne(
        { _id: load._id, status: 'accepted', 'pickupVerification.code': { $exists: false } },
        { $set: { 'pickupVerification.code': String(crypto.randomInt(0, 1000000)).padStart(6, '0') } }
      );
    }
    res.json({ success: true, required: want });
  } catch (err) {
    console.error('[pickup-required] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Public dock endpoints (no account) ───────────────────────────────────────
function dockLoadId(req, res) {
  const parsed = svc.parseDockToken(req.params.token);
  if (parsed.error === 'expired') { res.status(410).json({ error: 'This dock link has expired. Ask the shipper for a new one.' }); return null; }
  if (parsed.error) { res.status(404).json({ error: 'Dock link not found' }); return null; }
  return parsed.loadId;
}

router.get('/dock/:token', dockInfoLimiter, async (req, res) => {
  try {
    const loadId = dockLoadId(req, res);
    if (!loadId) return;
    const info = await svc.dockInfo(loadId);
    if (!info) return res.status(404).json({ error: 'Dock link not found' });
    res.set('Cache-Control', 'no-store');
    res.json(info);
  } catch (err) {
    console.error('[dock-info] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/dock/:token/verify', dockVerifyLimiter, body('code').isString().trim().isLength({ max: 12 }), validate, async (req, res) => {
  try {
    const loadId = dockLoadId(req, res);
    if (!loadId) return;
    const out = await svc.attemptVerify({ loadId, code: req.body.code, verifiedBy: 'dock_link' });
    res.set('Cache-Control', 'no-store');
    res.status(out.http).json(out.body);
  } catch (err) {
    console.error('[dock-verify] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
