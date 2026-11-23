/**
 * Delivery pass — the receiver reads and signs the delivery documents on its own device, so nobody prints.
 * Mounted at /api (see app.js).
 *
 * Authenticated:
 *   POST /loads/:id/delivery-pass   the load's carrier company, shipper company or an admin: get the link + QR code
 * Public (no account: the receiving dock), by signed link only:
 *   GET  /receive/:token            what the receiver needs to check the delivery. Never the rate.
 *   GET  /receive/:token/bol        the bill of lading (PDF)
 *   POST /receive/:token/sign       receiver's name + signature (+ shortage/damage note). Once, while in transit.
 *
 * Signing records proof of delivery and tells both parties; it does NOT mark the load delivered or move money.
 * The carrier still completes the delivery in its own app.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { body, param } = require('express-validator');
const router = express.Router();
const auth = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validate');
const { makeLimiter } = require('../middlewares/rateLimiter');
const Load = require('../models/Load');
const User = require('../models/User');
const StatusHistory = require('../models/StatusHistory');
const { notifyUserSafe } = require('../utils/notifyUser');
const { signDockToken, parseDockToken, carrierIdentity } = require('../services/pickupVerificationService');

const PURPOSE = 'receive';
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'documents', 'uploads');
const limiter = (max, prefix) => makeLimiter({
  windowMs: 15 * 60 * 1000, max, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
}, prefix);
const infoLimiter = limiter(60, 'rl:receiveinfo:');
const signLimiter = limiter(10, 'rl:receivesign:');

let qrcode = null;
try { qrcode = require('qrcode'); } catch (_) { /* link still works without the QR image */ }

// ── The load's own parties: mint the link ────────────────────────────────────
router.post('/loads/:id/delivery-pass', auth, param('id').isMongoId().withMessage('Invalid load id'), validate, async (req, res) => {
  try {
    const load = await Load.findById(req.params.id).select('postedBy acceptedBy status').lean();
    if (!load) return res.status(404).json({ error: 'Load not found' });
    const company = String(req.user.companyOwnerId || req.user.userId);
    const party = req.user.role === 'admin' || String(load.postedBy) === company || String(load.acceptedBy) === company;
    if (!party) return res.status(403).json({ error: 'Forbidden' });
    if (!load.acceptedBy || !['accepted', 'in-transit', 'delivered'].includes(load.status)) {
      return res.status(409).json({ error: 'Delivery documents are available once a carrier has booked the load.' });
    }
    const { token, expiresAt } = signDockToken(String(load._id), PURPOSE);
    const linkPath = `/receive/${token}`;
    // The address in the QR code is ours: the configured site, or the caller's origin only when it is on the allowed list.
    const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
    const asked = req.get('origin') || '';
    const origin = (process.env.FRONTEND_URL || (allowed.includes(asked) || process.env.NODE_ENV !== 'production' ? asked : '') || '').replace(/\/$/, '');
    let qr = null;
    if (qrcode && origin) { try { qr = await qrcode.toDataURL(origin + linkPath, { margin: 1, width: 320 }); } catch (_) { /* no QR */ } }
    res.status(201).json({ token, path: linkPath, url: origin ? origin + linkPath : null, qr, expiresAt });
  } catch (err) {
    console.error('[delivery-pass] failed:', err.message);
    res.status(500).json({ error: 'Failed to create the delivery link' });
  }
});

// ── Public (receiver) ────────────────────────────────────────────────────────
function tokenLoadId(req, res) {
  const parsed = parseDockToken(req.params.token, PURPOSE);
  if (parsed.error === 'expired') { res.status(410).json({ error: 'This delivery link has expired. Ask the driver to show a new one.' }); return null; }
  if (parsed.error) { res.status(404).json({ error: 'Delivery link not found' }); return null; }
  return parsed.loadId;
}

/** Only what a receiving dock needs. Never rate, finance, contacts or the pickup code. */
async function receiveInfo(loadId) {
  const load = await Load.findById(loadId).select(
    'title status postedBy acceptedBy shipperReferenceNumber poNumber consigneeReference origin destination deliveryFacilityName deliveryAddress deliveryTimeWindow equipmentType commodityType loadWeight hazardousMaterial assignedTruckId assignedDriverName deliveredAt deliverySignature.signedAt deliverySignature.signerName deliverySignature.signedByRole deliverySignature.note'
  ).lean();
  if (!load) return null;
  const booked = !!load.acceptedBy && ['accepted', 'in-transit', 'delivered'].includes(load.status);
  const sig = load.deliverySignature || {};
  const shipper = booked ? await User.findById(load.postedBy).select('companyName name').lean() : null;
  return {
    state: !booked ? 'not_booked' : sig.signedAt ? 'signed' : load.status === 'accepted' ? 'awaiting_pickup' : load.status === 'in-transit' ? 'ready' : 'delivered',
    loadTitle: load.title,
    references: { shipper: load.shipperReferenceNumber || null, po: load.poNumber || null, consignee: load.consigneeReference || null },
    shipperName: shipper ? shipper.companyName || shipper.name : null,
    origin: load.origin,
    destination: load.destination,
    facility: load.deliveryFacilityName || null,
    address: load.deliveryAddress || null,
    deliveryWindow: load.deliveryTimeWindow || null,
    equipmentType: load.equipmentType || null,
    commodity: load.commodityType || null,
    weightLbs: load.loadWeight || null,
    hazardous: !!load.hazardousMaterial,
    carrier: booked ? await carrierIdentity(load.acceptedBy) : null,
    truckId: booked ? load.assignedTruckId || null : null,
    driverName: booked ? load.assignedDriverName || null : null,
    signed: sig.signedAt ? { at: sig.signedAt, by: sig.signerName, byReceiver: sig.signedByRole === 'receiver', note: sig.note || null } : null,
  };
}

router.get('/receive/:token', infoLimiter, async (req, res) => {
  try {
    const loadId = tokenLoadId(req, res);
    if (!loadId) return;
    const info = await receiveInfo(loadId);
    if (!info) return res.status(404).json({ error: 'Delivery link not found' });
    res.set('Cache-Control', 'no-store').json(info);
  } catch (err) {
    console.error('[receive-info] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/receive/:token/bol', infoLimiter, async (req, res) => {
  try {
    const loadId = tokenLoadId(req, res);
    if (!loadId) return;
    const load = await Load.findById(loadId).select('acceptedBy status').lean();
    if (!load || !load.acceptedBy || !['accepted', 'in-transit', 'delivered'].includes(load.status)) return res.status(404).json({ error: 'Document not available' });
    // Always rebuilt from the current record, so it carries the signatures captured so far. The file name is ours (the load id).
    await require('./documentRoutes').helpers.regenerateBol(loadId);
    const file = path.join(UPLOADS_DIR, `${loadId}-bol.pdf`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Document not available' });
    res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="bill-of-lading.pdf"', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error('[receive-bol] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/receive/:token/sign', signLimiter,
  body('signerName').isString().trim().isLength({ min: 2, max: 120 }).withMessage('Enter the name of the person receiving the freight.'),
  body('note').optional({ values: 'falsy' }).isString().trim().isLength({ max: 1000 }).withMessage('Keep the note under 1,000 characters.'),
  body('dataUrl').isString().withMessage('A signature is required.'),
  validate,
  async (req, res) => {
    try {
      const loadId = tokenLoadId(req, res);
      if (!loadId) return;
      const { parseSignatureDataUrl, regenerateBol } = require('./documentRoutes').helpers;
      const dataUrl = parseSignatureDataUrl(req.body.dataUrl);
      if (!dataUrl) return res.status(400).json({ error: 'A signature is required.' });
      const signerName = String(req.body.signerName).trim();
      const note = req.body.note ? String(req.body.note).trim() : null;
      const now = new Date();
      // One signature, only while the truck is in transit: decided by the database, so two taps cannot both win.
      const load = await Load.findOneAndUpdate(
        { _id: loadId, status: 'in-transit', acceptedBy: { $ne: null }, 'deliverySignature.signedAt': null },
        { $set: { deliverySignature: { dataUrl, signerName, signedByRole: 'receiver', signedBy: null, signedAt: now, note }, 'documents.podSignerName': signerName } },
        { new: true }
      ).select('title postedBy acceptedBy');
      if (!load) {
        const cur = await Load.findById(loadId).select('status deliverySignature.signedAt').lean();
        if (!cur) return res.status(404).json({ error: 'Delivery link not found' });
        if (cur.deliverySignature?.signedAt) return res.status(409).json({ error: 'This delivery has already been signed for.', reason: 'already_signed' });
        return res.status(409).json({ error: 'This load is not out for delivery yet, so it cannot be signed for.', reason: 'not_in_transit' });
      }
      StatusHistory.record('load', loadId, 'delivery_unsigned', 'delivery_signed', null, `Receiver signed via delivery link: ${signerName}${note ? ' (with a note)' : ''}`).catch(() => {});
      regenerateBol(loadId).catch((e) => console.error('[receive-sign] BOL rebuild failed (non-fatal):', e.message));
      const notice = {
        type: 'load:delivery_signed',
        title: note ? 'Receiver signed with a note' : 'Receiver signed for delivery',
        body: `"${load.title}": signed by ${signerName}.${note ? ` Note: ${note.slice(0, 200)}` : ''}`,
        metadata: { loadId: load._id, priority: note ? 'high' : 'normal' },
      };
      notifyUserSafe(load.postedBy, { ...notice, link: '/dashboard/shipper/loads' });
      notifyUserSafe(load.acceptedBy, { ...notice, link: '/dashboard/carrier/my-loads' });
      res.set('Cache-Control', 'no-store').json({ signed: { at: now, by: signerName, byReceiver: true, note } });
    } catch (err) {
      console.error('[receive-sign] failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

module.exports = router;
