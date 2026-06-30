/**
 * reviewQueueRoutes — admin-only human-review queue for AI-flagged actions.
 *
 * The CarrierRiskAgent no longer auto-suspends carriers. Instead it files
 * ReviewQueue entries that an admin must explicitly approve (apply the
 * recommended action) or dismiss (reject the flag). This keeps a human in
 * the loop before any account suspension takes effect.
 *
 * All endpoints require an authenticated admin.
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const auth = require('../middlewares/authMiddleware');
const ReviewQueue = require('../models/ReviewQueue');
const User = require('../models/User');
const { notifyUserSafe } = require('../utils/notifyUser');

/** Reject non-admins. */
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

/**
 * GET / — list reviews.
 * Filters: ?status=pending&type=carrier_suspension
 * Paginated (?page=1&limit=20), newest first.
 */
router.get('/', auth, adminOnly, async (req, res) => {
  try {
    const { status, type } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const filter = {};
    if (status && ['pending', 'approved', 'dismissed'].includes(status)) {
      filter.status = status;
    }
    if (type && ['carrier_suspension', 'fraud_flag', 'other'].includes(type)) {
      filter.type = type;
    }

    const [items, total] = await Promise.all([
      ReviewQueue.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('subjectUser', 'name email companyName')
        .lean(),
      ReviewQueue.countDocuments(filter),
    ]);

    res.json({
      data: items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('[reviewQueue:list] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /stats — counts by status, for an admin badge.
 * Defined before /:id so 'stats' isn't matched as an id.
 */
router.get('/stats', auth, adminOnly, async (req, res) => {
  try {
    const rows = await ReviewQueue.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const stats = { pending: 0, approved: 0, dismissed: 0 };
    for (const row of rows) {
      if (row._id in stats) stats[row._id] = row.count;
    }

    res.json({ data: stats });
  } catch (err) {
    console.error('[reviewQueue:stats] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/** GET /:id — single review detail. */
router.get('/:id', auth, adminOnly, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid review id' });
    }

    const review = await ReviewQueue.findById(req.params.id)
      .populate('subjectUser', 'name email companyName')
      .populate('reviewedBy', 'name email')
      .lean();

    if (!review) return res.status(404).json({ error: 'Review not found' });

    res.json({ data: review });
  } catch (err) {
    console.error('[reviewQueue:detail] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /:id/approve — admin confirms the recommended action.
 * For 'carrier_suspension': suspend the subject user.
 */
router.put('/:id/approve', auth, adminOnly, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid review id' });
    }

    const { reviewNote } = req.body || {};

    const review = await ReviewQueue.findById(req.params.id);
    if (!review) return res.status(404).json({ error: 'Review not found' });
    if (review.status !== 'pending') {
      return res.status(409).json({ error: `Review already ${review.status}` });
    }

    // Apply the recommended action.
    if (review.type === 'carrier_suspension') {
      const subject = await User.findById(review.subjectUser);
      if (!subject) return res.status(404).json({ error: 'Subject user not found' });

      if (!subject.verification) subject.verification = {};
      subject.verification.status = 'suspended';
      await subject.save();

      await notifyUserSafe(subject._id, {
        type: 'ai:riskSuspension',
        title: 'Account Suspended',
        body: `Your account has been suspended after admin review.${review.reason ? ' Reason: ' + review.reason : ''}`,
        link: '/dashboard/carrier/profile',
        metadata: { reviewId: review._id, riskScore: review.riskScore },
      });
    }

    review.status = 'approved';
    review.reviewedBy = req.user.userId;
    review.reviewedAt = new Date();
    review.reviewNote = reviewNote || null;
    await review.save();

    res.json({ success: true, data: review });
  } catch (err) {
    console.error('[reviewQueue:approve] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PUT /:id/dismiss — admin rejects the flag. No change to user status.
 */
router.put('/:id/dismiss', auth, adminOnly, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid review id' });
    }

    const { reviewNote } = req.body || {};

    const review = await ReviewQueue.findById(req.params.id);
    if (!review) return res.status(404).json({ error: 'Review not found' });
    if (review.status !== 'pending') {
      return res.status(409).json({ error: `Review already ${review.status}` });
    }

    review.status = 'dismissed';
    review.reviewedBy = req.user.userId;
    review.reviewedAt = new Date();
    review.reviewNote = reviewNote || null;
    await review.save();

    res.json({ success: true, data: review });
  } catch (err) {
    console.error('[reviewQueue:dismiss] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
