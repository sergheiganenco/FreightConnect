/**
 * Delivery pass — the receiver reads and signs the delivery documents on its own device, so nobody prints.
 * Mounted at /api (see app.js).
 *
 * Authenticated:
 *   POST /loads/:id/delivery-pass   the load's carrier company, shipper company or an admin: get the link + QR code
 * Public (no account: the receiving dock), by signed link only:
 *   GET  /receive/:token            what the receiver needs to check the delivery. Never the rate.
 *   GET  /receive/:token/bol        the bill of lading (PDF)
 *   POST /receive/:token/photo      one photo of shortage/damage (up to 6), before signing. Stored privately.
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

// The link is bound to the booking: the carrier is part of what is signed, so if the load is unbooked or rebooked to
// another carrier, every link made for the earlier booking stops working.
const purposeFor = (carrierId) => `receive:${carrierId}`;
const LINK_TTL_MS = 5 * 24 * 60 * 60 * 1000;
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'documents', 'uploads');
const limiter = (max, prefix) => makeLimiter({
  windowMs: 15 * 60 * 1000, max, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
}, prefix);
const infoLimiter = limiter(60, 'rl:receiveinfo:');
const signLimiter = limiter(10, 'rl:receivesign:');
const photoLimiter = limiter(20, 'rl:receivephoto:');

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
    const { token, expiresAt } = signDockToken(String(load._id), purposeFor(load.acceptedBy), LINK_TTL_MS);
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
async function tokenLoadId(req, res) {
  const id = String(req.params.token || '').split('.')[0];
  const booking = /^[a-f0-9]{24}$/.test(id) ? await Load.findById(id).select('acceptedBy').lean() : null;
  const parsed = booking && booking.acceptedBy ? parseDockToken(req.params.token, purposeFor(booking.acceptedBy)) : { error: 'invalid' };
  if (parsed.error === 'expired') { res.status(410).json({ error: 'This delivery link has expired. Ask the driver to show a new one.' }); return null; }
  if (parsed.error) { res.status(404).json({ error: 'Delivery link not found' }); return null; }
  return parsed.loadId;
}

/** Only what a receiving dock needs. Never rate, finance, contacts or the pickup code. */
async function receiveInfo(loadId) {
  const load = await Load.findById(loadId).select(
    '+evidence title status postedBy acceptedBy shipperReferenceNumber poNumber consigneeReference origin destination deliveryFacilityName deliveryAddress deliveryTimeWindow equipmentType commodityType loadWeight hazardousMaterial assignedTruckId assignedDriverName deliveredAt deliverySignature.signedAt deliverySignature.signerName deliverySignature.signedByRole deliverySignature.note'
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
    photoCount: (load.evidence || []).filter((e) => e.receiverFor && !e.archived).length,
    signed: sig.signedAt ? { at: sig.signedAt, by: sig.signerName, byReceiver: sig.signedByRole === 'receiver', note: sig.note || null } : null,
  };
}

router.get('/receive/:token', infoLimiter, async (req, res) => {
  try {
    const loadId = await tokenLoadId(req, res);
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
    const loadId = await tokenLoadId(req, res);
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

// The link is checked BEFORE the upload is read, so only someone holding a live delivery link can send a file at all.
router.post('/receive/:token/photo', photoLimiter,
  async (req, res, next) => {
    try { req.receiveLoadId = await tokenLoadId(req, res); if (req.receiveLoadId) next(); } catch (err) { res.status(500).json({ error: 'Server error' }); }
  },
  (req, res, next) => require('./evidenceRoutes').helpers.uploadOne(req, res, next),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Choose a photo to add.' });
      const { addReceiverPhoto, MAX_RECEIVER_PHOTOS } = require('./evidenceRoutes').helpers;
      const r = await addReceiverPhoto(req.receiveLoadId, req.file, typeof req.body.note === 'string' ? req.body.note : '');
      if (r.ok) return res.status(201).set('Cache-Control', 'no-store').json({ photoCount: r.count });
      if (r.code === 'bad_image') return res.status(400).json({ error: 'That file is not a JPEG, PNG or WEBP photo.' });
      return res.status(409).json({ error: `Photos can be added while the truck is at your dock and before you sign, up to ${MAX_RECEIVER_PHOTOS}.` });
    } catch (err) {
      console.error('[receive-photo] failed:', err.message);
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
      const loadId = await tokenLoadId(req, res);
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
      ).select('+evidence title postedBy acceptedBy');
      if (!load) {
        const cur = await Load.findById(loadId).select('status deliverySignature.signedAt').lean();
        if (!cur) return res.status(404).json({ error: 'Delivery link not found' });
        if (cur.deliverySignature?.signedAt) return res.status(409).json({ error: 'This delivery has already been signed for.', reason: 'already_signed' });
        return res.status(409).json({ error: 'This load is not out for delivery yet, so it cannot be signed for.', reason: 'not_in_transit' });
      }
      StatusHistory.record('load', loadId, 'delivery_unsigned', 'delivery_signed', null, `Receiver signed via delivery link: ${signerName}${note ? ' (with a note)' : ''}`).catch(() => {});
      regenerateBol(loadId).catch((e) => console.error('[receive-sign] BOL rebuild failed (non-fatal):', e.message));
      const photos = (load.evidence || []).filter((e) => e.receiverFor && !e.archived).length;
      const flagged = !!note || photos > 0;
      const notice = {
        type: 'load:delivery_signed',
        title: flagged ? 'Receiver signed and reported a problem' : 'Receiver signed for delivery',
        body: `"${load.title}": signed by ${signerName}.${note ? ` Note: ${note.slice(0, 200)}` : ''}${photos ? ` ${photos} photo${photos > 1 ? 's' : ''} attached; see the load's photos.` : ''}`,
        metadata: { loadId: load._id, priority: flagged ? 'high' : 'normal' },
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
