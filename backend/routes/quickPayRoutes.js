/**
 * QuickPay Routes — Early Payment for Carriers
 *
 * GET   /api/quickpay/eligible         — Carrier: delivered loads eligible for QuickPay
 * POST  /api/quickpay/request/:loadId  — Carrier: request QuickPay (3% fee, 2-day payout)
 * GET   /api/quickpay/requests         — Carrier: own QuickPay history
 * GET   /api/quickpay/pending          — Admin: pending QuickPay requests
 * PATCH /api/quickpay/:id/approve      — Admin: approve request
 * PATCH /api/quickpay/:id/reject       — Admin: reject request
 * PATCH /api/quickpay/:id/pay          — Admin: mark as paid
 */

const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/authMiddleware');
const QuickPayRequest = require('../models/QuickPayRequest');
const Load    = require('../models/Load');
const Invoice = require('../models/Invoice');
const { notifyUserSafe } = require('../utils/notifyUser');

const CARRIER_ONLY = (req, res, next) => {
  if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
  next();
};
const ADMIN_ONLY = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  next();
};

const DEFAULT_FEE_PCT = 3;

// ── GET /eligible — loads available for QuickPay ────────────────────────────
router.get('/eligible', auth, CARRIER_ONLY, async (req, res) => {
  try {
    // Find loads already in QuickPay (any non-rejected status)
    const existing = await QuickPayRequest.find({
      carrier: req.user.userId,
      status:  { $ne: 'rejected' },
    }).select('loadId').lean();
    const quickPayedIds = existing.map(r => r.loadId.toString());

    // Find delivered loads with issued invoices, not yet in QuickPay
    const loads = await Load.find({
      acceptedBy: req.user.userId,
      status:     'delivered',
      _id:        { $nin: quickPayedIds },
    }).select('title origin destination rate deliveredAt').lean();

    // Filter to only loads that have an issued invoice
    const eligible = [];
    for (const load of loads) {
      const invoice = await Invoice.findOne({
        loadId:   load._id,
        carrierId: req.user.userId,
        status:   { $in: ['issued', 'draft'] },
      }).select('_id invoiceNumber total status').lean();

      if (invoice) {
        eligible.push({
          ...load,
          invoice,
          quickPayFeePct: DEFAULT_FEE_PCT,
          quickPayFeeCents: Math.round(load.rate * 100 * DEFAULT_FEE_PCT / 100),
          payoutAmountCents: Math.round(load.rate * 100) - Math.round(load.rate * 100 * DEFAULT_FEE_PCT / 100),
        });
      }
    }

    res.json(eligible);
  } catch (err) {
    console.error('[QuickPay] Eligible fetch failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch eligible loads' });
  }
});

// ── POST /request/:loadId — request QuickPay ───────────────────────────────
router.post('/request/:loadId', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const load = await Load.findById(req.params.loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });

    if (load.status !== 'delivered') {
      return res.status(400).json({ error: 'Only delivered loads are eligible for QuickPay' });
    }
    if (load.acceptedBy.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'You can only request QuickPay for your own loads' });
    }

    // Check for existing non-rejected QuickPay request
    const existing = await QuickPayRequest.findOne({
      loadId: load._id,
      status: { $ne: 'rejected' },
    });
    if (existing) {
      return res.status(409).json({ error: 'QuickPay already requested for this load' });
    }

    // Find the invoice
    const invoice = await Invoice.findOne({
      loadId:    load._id,
      carrierId: req.user.userId,
      status:    { $in: ['issued', 'draft'] },
    });
    if (!invoice) {
      return res.status(400).json({ error: 'No invoice found for this load. Invoice must exist before requesting QuickPay.' });
    }

    // Calculate amounts (rate is in dollars, store in cents)
    const originalAmountCents = Math.round(load.rate * 100);
    const feePct = DEFAULT_FEE_PCT;
    const quickPayFeeCents = Math.round(originalAmountCents * feePct / 100);
    const payoutAmountCents = originalAmountCents - quickPayFeeCents;

    const request = await QuickPayRequest.create({
      carrier:             req.user.userId,
      loadId:              load._id,
      invoiceId:           invoice._id,
      originalAmountCents,
      quickPayFeePct:      feePct,
      quickPayFeeCents,
      payoutAmountCents,
    });

    res.status(201).json(request);
  } catch (err) {
    // Duplicate key on loadId unique index
    if (err.code === 11000) {
      return res.status(409).json({ error: 'QuickPay already requested for this load' });
    }
    console.error('[QuickPay] Request failed:', err.message);
    res.status(500).json({ error: 'Failed to submit QuickPay request' });
  }
});

// ── GET /requests — carrier's QuickPay history ─────────────────────────────
router.get('/requests', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const requests = await QuickPayRequest.find({ carrier: req.user.userId })
      .populate('loadId', 'title origin destination rate')
      .sort({ createdAt: -1 })
      .lean();
    res.json(requests);
  } catch (err) {
    console.error('[QuickPay] History fetch failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch QuickPay history' });
  }
});

// ── GET /pending — admin: pending requests ──────────────────────────────────
router.get('/pending', auth, ADMIN_ONLY, async (req, res) => {
  try {
    const requests = await QuickPayRequest.find({ status: 'requested' })
      .populate('carrier', 'name email companyName')
      .populate('loadId', 'title origin destination rate')
      .sort({ requestedAt: 1 })
      .lean();
    res.json(requests);
  } catch (err) {
    console.error('[QuickPay] Pending fetch failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch pending requests' });
  }
});

// ── PATCH /:id/approve — admin approves ─────────────────────────────────────
router.patch('/:id/approve', auth, ADMIN_ONLY, async (req, res) => {
  try {
    const request = await QuickPayRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'QuickPay request not found' });
    if (request.status !== 'requested') {
      return res.status(400).json({ error: `Cannot approve a request in "${request.status}" status` });
    }

    request.status     = 'approved';
    request.approvedAt = new Date();
    request.approvedBy = req.user.userId;
    await request.save();

    // Notify carrier
    await notifyUserSafe(request.carrier, {
      type:  'quickpay:approved',
      title: 'QuickPay Approved',
      body:  `Your QuickPay request has been approved. Payout of $${(request.payoutAmountCents / 100).toFixed(2)} will be processed within 2 business days.`,
      link:  '/dashboard/carrier/payments',
      metadata: { quickPayId: request._id, loadId: request.loadId },
    });

    res.json(request);
  } catch (err) {
    console.error('[QuickPay] Approve failed:', err.message);
    res.status(500).json({ error: 'Failed to approve QuickPay request' });
  }
});

// ── PATCH /:id/reject — admin rejects ───────────────────────────────────────
router.patch('/:id/reject', auth, ADMIN_ONLY, async (req, res) => {
  try {
    const request = await QuickPayRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'QuickPay request not found' });
    if (request.status !== 'requested') {
      return res.status(400).json({ error: `Cannot reject a request in "${request.status}" status` });
    }

    request.status          = 'rejected';
    request.rejectedAt      = new Date();
    request.rejectedBy      = req.user.userId;
    request.rejectionReason = req.body.reason || 'No reason provided';
    await request.save();

    await notifyUserSafe(request.carrier, {
      type:  'quickpay:rejected',
      title: 'QuickPay Rejected',
      body:  `Your QuickPay request was rejected. Reason: ${request.rejectionReason}`,
      link:  '/dashboard/carrier/payments',
      metadata: { quickPayId: request._id, loadId: request.loadId },
    });

    res.json(request);
  } catch (err) {
    console.error('[QuickPay] Reject failed:', err.message);
    res.status(500).json({ error: 'Failed to reject QuickPay request' });
  }
});

// ── PATCH /:id/pay — admin marks as paid ────────────────────────────────────
router.patch('/:id/pay', auth, ADMIN_ONLY, async (req, res) => {
  try {
    const request = await QuickPayRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'QuickPay request not found' });
    if (request.status !== 'approved') {
      return res.status(400).json({ error: `Cannot pay a request in "${request.status}" status. Must be approved first.` });
    }

    request.status = 'paid';
    request.paidAt = new Date();
    await request.save();

    await notifyUserSafe(request.carrier, {
      type:  'quickpay:paid',
      title: 'QuickPay Paid!',
      body:  `$${(request.payoutAmountCents / 100).toFixed(2)} has been sent to your account via QuickPay.`,
      link:  '/dashboard/carrier/payments',
      metadata: { quickPayId: request._id, loadId: request.loadId },
    });

    res.json(request);
  } catch (err) {
    console.error('[QuickPay] Pay failed:', err.message);
    res.status(500).json({ error: 'Failed to mark QuickPay as paid' });
  }
});

module.exports = router;
