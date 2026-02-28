/**
 * Factoring Routes — Freight Invoice Factoring
 *
 * GET   /api/factoring/eligible         — Carrier: loads eligible for factoring
 * POST  /api/factoring                  — Carrier: submit factoring request
 * GET   /api/factoring                  — Carrier: list own requests
 * GET   /api/factoring/:id              — Detail (carrier or admin)
 * PATCH /api/factoring/:id/approve      — Admin: approve request
 * PATCH /api/factoring/:id/reject       — Admin: reject with reason
 * PATCH /api/factoring/:id/fund         — Admin: mark as funded
 * PATCH /api/factoring/:id/collect      — Admin: mark as collected (shipper paid)
 */

const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/authMiddleware');
const FactoringRequest = require('../models/FactoringRequest');
const Load    = require('../models/Load');
const { notifyUserSafe } = require('../utils/notifyUser');

const CARRIER_ONLY = (req, res, next) => {
  if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
  next();
};
const ADMIN_ONLY = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  next();
};

// ── GET /eligible — loads available for factoring ────────────────────────────
router.get('/eligible', auth, CARRIER_ONLY, async (req, res) => {
  try {
    // Already-factored load IDs (any non-rejected request)
    const existing = await FactoringRequest.find({
      carrier: req.user.userId,
      status: { $ne: 'rejected' },
    }).select('loads').lean();
    const factoredIds = existing.flatMap(r => r.loads.map(id => id.toString()));

    const loads = await Load.find({
      acceptedBy: req.user.userId,
      status:     'delivered',
      _id:        { $nin: factoredIds },
    }).select('title origin destination rate deliveredAt').lean();

    res.json(loads);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch eligible loads' });
  }
});

// ── POST / — submit factoring request ────────────────────────────────────────
router.post('/', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const { loadIds, notes, advancePct = 95 } = req.body;
    if (!Array.isArray(loadIds) || loadIds.length === 0) {
      return res.status(400).json({ error: 'At least one load is required' });
    }
    const pct = Math.min(99, Math.max(50, parseFloat(advancePct)));

    // Validate all loads belong to this carrier and are delivered
    const loads = await Load.find({
      _id:        { $in: loadIds },
      acceptedBy: req.user.userId,
      status:     'delivered',
    }).lean();

    if (loads.length !== loadIds.length) {
      return res.status(400).json({ error: 'Some loads are invalid or not yet delivered' });
    }

    // Check none are already factored
    const existing = await FactoringRequest.findOne({
      carrier: req.user.userId,
      status:  { $ne: 'rejected' },
      loads:   { $in: loadIds },
    });
    if (existing) {
      return res.status(409).json({ error: 'One or more loads already have a factoring request' });
    }

    const invoiceTotalCents = loads.reduce((sum, l) => sum + Math.round((l.rate || 0) * 100), 0);
    const advanceCents      = Math.round(invoiceTotalCents * pct / 100);
    const feeCents          = invoiceTotalCents - advanceCents;

    const request = await FactoringRequest.create({
      carrier:           req.user.userId,
      loads:             loads.map(l => l._id),
      invoiceTotalCents,
      advancePct:        pct,
      advanceCents,
      feeCents,
      notes,
      history: [{ action: 'submitted', performedBy: req.user.userId, details: `${loads.length} load(s) submitted for factoring` }],
    });

    const populated = await FactoringRequest.findById(request._id).populate('loads', 'title origin destination rate');
    res.status(201).json(populated);
  } catch (err) {
    console.error('Factoring submit error:', err);
    res.status(500).json({ error: 'Failed to submit factoring request' });
  }
});

// ── GET / — list carrier's requests ──────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { carrier: req.user.userId };
    if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;

    const requests = await FactoringRequest.find(filter)
      .populate('carrier', 'name companyName')
      .populate('loads', 'title origin destination rate')
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// ── GET /:id — request detail ─────────────────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    const request = await FactoringRequest.findById(req.params.id)
      .populate('carrier',     'name companyName email')
      .populate('loads',       'title origin destination rate deliveredAt status')
      .populate('reviewedBy',  'name')
      .populate('history.performedBy', 'name role');
    if (!request) return res.status(404).json({ error: 'Not found' });

    if (req.user.role !== 'admin' && request.carrier._id.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(request);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch request' });
  }
});

// ── PATCH /:id/approve — admin approves ──────────────────────────────────────
router.patch('/:id/approve', auth, ADMIN_ONLY, async (req, res) => {
  try {
    const request = await FactoringRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Not found' });
    if (request.status !== 'pending') return res.status(409).json({ error: 'Only pending requests can be approved' });

    request.status     = 'approved';
    request.reviewedBy = req.user.userId;
    request.reviewedAt = new Date();
    request.history.push({ action: 'approved', performedBy: req.user.userId, details: 'Request approved' });
    await request.save();

    notifyUserSafe(request.carrier.toString(), {
      type:  'payment:update',
      title: 'Factoring Request Approved',
      body:  `Your factoring request for $${(request.advanceCents / 100).toFixed(2)} has been approved`,
      link:  '/dashboard/carrier/factoring',
      metadata: { requestId: request._id },
    });

    res.json(request);
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve' });
  }
});

// ── PATCH /:id/reject — admin rejects ────────────────────────────────────────
router.patch('/:id/reject', auth, ADMIN_ONLY, async (req, res) => {
  try {
    const request = await FactoringRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Not found' });
    if (!['pending', 'approved'].includes(request.status)) {
      return res.status(409).json({ error: 'Cannot reject in current status' });
    }

    request.status          = 'rejected';
    request.reviewedBy      = req.user.userId;
    request.reviewedAt      = new Date();
    request.rejectionReason = req.body.reason || 'No reason provided';
    request.history.push({ action: 'rejected', performedBy: req.user.userId, details: request.rejectionReason });
    await request.save();

    notifyUserSafe(request.carrier.toString(), {
      type:  'exception:new',
      title: 'Factoring Request Rejected',
      body:  request.rejectionReason,
      link:  '/dashboard/carrier/factoring',
      metadata: { requestId: request._id },
    });

    res.json(request);
  } catch (err) {
    res.status(500).json({ error: 'Failed to reject' });
  }
});

// ── PATCH /:id/fund — admin marks as funded ───────────────────────────────────
router.patch('/:id/fund', auth, ADMIN_ONLY, async (req, res) => {
  try {
    const request = await FactoringRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Not found' });
    if (request.status !== 'approved') return res.status(409).json({ error: 'Must be approved before funding' });

    request.status     = 'funded';
    request.fundedAt   = new Date();
    request.fundingRef = req.body.fundingRef || `FC-FACT-${Date.now()}`;
    request.history.push({ action: 'funded', performedBy: req.user.userId, details: `Advance of $${(request.advanceCents / 100).toFixed(2)} sent (ref: ${request.fundingRef})` });
    await request.save();

    notifyUserSafe(request.carrier.toString(), {
      type:  'payment:update',
      title: 'Factoring Advance Funded',
      body:  `$${(request.advanceCents / 100).toFixed(2)} advance has been sent to your account`,
      link:  '/dashboard/carrier/factoring',
      metadata: { requestId: request._id },
    });

    res.json(request);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fund' });
  }
});

// ── PATCH /:id/collect — admin marks collected ────────────────────────────────
router.patch('/:id/collect', auth, ADMIN_ONLY, async (req, res) => {
  try {
    const request = await FactoringRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Not found' });
    if (request.status !== 'funded') return res.status(409).json({ error: 'Must be funded first' });

    request.status = 'collected';
    request.history.push({ action: 'collected', performedBy: req.user.userId, details: 'Shipper payment collected' });
    await request.save();
    res.json(request);
  } catch (err) {
    res.status(500).json({ error: 'Failed to collect' });
  }
});

module.exports = router;
