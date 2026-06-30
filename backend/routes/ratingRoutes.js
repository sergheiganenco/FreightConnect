/**
 * ratingRoutes — Post-delivery rating endpoints
 *
 * POST   /api/ratings              Submit a rating after delivery
 * GET    /api/ratings/my           Get your own ratings (given & received)
 * GET    /api/ratings/pending      Loads where you haven't rated the other party
 * GET    /api/ratings/user/:userId Public ratings for a user
 * GET    /api/ratings/load/:loadId Ratings for a specific load
 * POST   /api/ratings/:id/respond  Respond to a rating you received
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const mongoose = require('mongoose');
const Rating = require('../models/Rating');
const Load = require('../models/Load');
const User = require('../models/User');
const auth = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validate');
const { notifyUserSafe } = require('../utils/notifyUser');
const verificationService = require('../services/verificationService');

const router = express.Router();

// ────────────────────────────────────────────────────────────────────────────
// POST /api/ratings — Submit rating after delivery
// ────────────────────────────────────────────────────────────────────────────
router.post(
  '/',
  auth,
  [
    body('loadId').isMongoId().withMessage('Valid loadId required'),
    body('toUser').isMongoId().withMessage('Valid toUser required'),
    body('overall').isInt({ min: 1, max: 5 }).withMessage('Overall rating must be 1-5'),
    body('categories.communication').optional().isInt({ min: 1, max: 5 }),
    body('categories.punctuality').optional().isInt({ min: 1, max: 5 }),
    body('categories.professionalism').optional().isInt({ min: 1, max: 5 }),
    body('categories.cargoHandling').optional().isInt({ min: 1, max: 5 }),
    body('categories.paymentSpeed').optional().isInt({ min: 1, max: 5 }),
    body('comment').optional().isString().isLength({ max: 500 }),
    body('isPublic').optional().isBoolean(),
  ],
  validate,
  async (req, res) => {
    try {
      const fromUserId = req.user.userId;
      const { loadId, toUser, overall, categories, comment, isPublic } = req.body;

      // 1. Load must exist and be delivered
      const load = await Load.findById(loadId);
      if (!load) return res.status(404).json({ error: 'Load not found' });
      if (load.status !== 'delivered') {
        return res.status(400).json({ error: 'Ratings can only be submitted for delivered loads' });
      }

      // 2. User must be a party to this load
      const postedBy = load.postedBy?.toString();
      const acceptedBy = load.acceptedBy?.toString();
      if (fromUserId !== postedBy && fromUserId !== acceptedBy) {
        return res.status(403).json({ error: 'You are not a party to this load' });
      }

      // 3. toUser must be the OTHER party
      if (toUser === fromUserId) {
        return res.status(400).json({ error: 'Cannot rate yourself' });
      }
      if (toUser !== postedBy && toUser !== acceptedBy) {
        return res.status(400).json({ error: 'Rated user is not a party to this load' });
      }

      // 4. Determine roles
      const fromRole = fromUserId === postedBy ? 'shipper' : 'carrier';
      const toRole = fromRole === 'shipper' ? 'carrier' : 'shipper';

      // 5. Check for existing rating (unique index will also catch this)
      const existing = await Rating.findOne({ loadId, fromUser: fromUserId });
      if (existing) {
        return res.status(409).json({ error: 'You have already rated this load' });
      }

      // 6. Create rating
      const rating = await Rating.create({
        loadId,
        fromUser: fromUserId,
        toUser,
        fromRole,
        toRole,
        overall,
        categories: categories || {},
        comment: comment || undefined,
        isPublic: isPublic !== undefined ? isPublic : true,
      });

      // 7. Recalculate trust score for rated user (non-blocking)
      try {
        await verificationService.calculateTrustScore(toUser);
      } catch (scoreErr) {
        console.error('[ratingRoutes] Trust score recalc failed (non-fatal):', scoreErr.message);
      }

      // 8. Notify rated user
      notifyUserSafe(toUser, {
        type: 'rating:new',
        title: 'You received a new rating!',
        body: `${overall}/5 stars for load: ${load.title || `${load.origin} → ${load.destination}`}`,
        link: `/dashboard/${toRole}/profile`,
        metadata: { loadId, ratingId: rating._id, overall },
      });

      res.status(201).json(rating);
    } catch (err) {
      // Duplicate key from unique index
      if (err.code === 11000) {
        return res.status(409).json({ error: 'You have already rated this load' });
      }
      console.error('[ratingRoutes] POST / error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ────────────────────────────────────────────────────────────────────────────
// GET /api/ratings/my — Your own ratings (given & received)
// ────────────────────────────────────────────────────────────────────────────
router.get('/my', auth, async (req, res) => {
  try {
    const userId = req.user.userId;

    const [received, given] = await Promise.all([
      Rating.find({ toUser: userId })
        .sort({ createdAt: -1 })
        .populate('fromUser', 'name companyName')
        .populate('loadId', 'title origin destination')
        .lean(),
      Rating.find({ fromUser: userId })
        .sort({ createdAt: -1 })
        .populate('toUser', 'name companyName')
        .populate('loadId', 'title origin destination')
        .lean(),
    ]);

    const averages = await Rating.getAverageForUser(userId);

    res.json({ received, given, averages });
  } catch (err) {
    console.error('[ratingRoutes] GET /my error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/ratings/pending — Loads where you haven't rated the other party
// ────────────────────────────────────────────────────────────────────────────
router.get('/pending', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userObjId = new mongoose.Types.ObjectId(userId);

    // Find delivered loads where user was a party
    const deliveredLoads = await Load.find({
      status: 'delivered',
      $or: [{ postedBy: userObjId }, { acceptedBy: userObjId }],
    })
      .select('_id title origin destination postedBy acceptedBy deliveredAt')
      .sort({ deliveredAt: -1 })
      .limit(50)
      .lean();

    if (deliveredLoads.length === 0) {
      return res.json([]);
    }

    // Find ratings already submitted by this user for these loads
    const loadIds = deliveredLoads.map((l) => l._id);
    const existingRatings = await Rating.find({
      loadId: { $in: loadIds },
      fromUser: userObjId,
    })
      .select('loadId')
      .lean();

    const ratedLoadIds = new Set(existingRatings.map((r) => r.loadId.toString()));

    // Filter to unrated loads and attach the other party info
    const pending = [];
    for (const load of deliveredLoads) {
      if (ratedLoadIds.has(load._id.toString())) continue;

      const isShipper = load.postedBy?.toString() === userId;
      const otherPartyId = isShipper ? load.acceptedBy : load.postedBy;
      if (!otherPartyId) continue;

      pending.push({
        loadId: load._id,
        title: load.title,
        origin: load.origin,
        destination: load.destination,
        deliveredAt: load.deliveredAt,
        otherPartyId,
        yourRole: isShipper ? 'shipper' : 'carrier',
      });
    }

    // Hydrate other party names
    const partyIds = [...new Set(pending.map((p) => p.otherPartyId.toString()))];
    const parties = await User.find({ _id: { $in: partyIds } })
      .select('name companyName role')
      .lean();
    const partyMap = {};
    for (const p of parties) partyMap[p._id.toString()] = p;

    const result = pending.map((p) => ({
      ...p,
      otherParty: partyMap[p.otherPartyId.toString()] || null,
    }));

    res.json(result);
  } catch (err) {
    console.error('[ratingRoutes] GET /pending error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/ratings/user/:userId — Public ratings for a user (paginated)
// ────────────────────────────────────────────────────────────────────────────
router.get(
  '/user/:userId',
  auth,
  [
    param('userId').isMongoId().withMessage('Valid userId required'),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('role').optional().isIn(['carrier', 'shipper']),
  ],
  validate,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const page = parseInt(req.query.page, 10) || 1;
      const limit = parseInt(req.query.limit, 10) || 20;
      const skip = (page - 1) * limit;

      const filter = { toUser: userId, isPublic: true };
      if (req.query.role) {
        filter.toRole = req.query.role;
      }

      const [ratings, total, averages] = await Promise.all([
        Rating.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('fromUser', 'name companyName')
          .populate('loadId', 'title origin destination')
          .lean(),
        Rating.countDocuments(filter),
        Rating.getAverageForUser(userId),
      ]);

      res.json({
        ratings,
        averages,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      console.error('[ratingRoutes] GET /user/:userId error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ────────────────────────────────────────────────────────────────────────────
// GET /api/ratings/load/:loadId — Ratings for a specific load
// ────────────────────────────────────────────────────────────────────────────
router.get(
  '/load/:loadId',
  auth,
  [param('loadId').isMongoId().withMessage('Valid loadId required')],
  validate,
  async (req, res) => {
    try {
      const ratings = await Rating.find({ loadId: req.params.loadId })
        .populate('fromUser', 'name companyName role')
        .populate('toUser', 'name companyName role')
        .lean();

      res.json(ratings);
    } catch (err) {
      console.error('[ratingRoutes] GET /load/:loadId error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ────────────────────────────────────────────────────────────────────────────
// POST /api/ratings/:id/respond — Respond to a rating (rated user only, once)
// ────────────────────────────────────────────────────────────────────────────
router.post(
  '/:id/respond',
  auth,
  [
    param('id').isMongoId().withMessage('Valid rating ID required'),
    body('response').isString().isLength({ min: 1, max: 500 }).withMessage('Response required (max 500 chars)'),
  ],
  validate,
  async (req, res) => {
    try {
      const rating = await Rating.findById(req.params.id);
      if (!rating) return res.status(404).json({ error: 'Rating not found' });

      // Only the rated user can respond
      if (rating.toUser.toString() !== req.user.userId) {
        return res.status(403).json({ error: 'Only the rated user can respond' });
      }

      // Only once
      if (rating.response) {
        return res.status(409).json({ error: 'You have already responded to this rating' });
      }

      rating.response = req.body.response;
      rating.respondedAt = new Date();
      await rating.save();

      res.json(rating);
    } catch (err) {
      console.error('[ratingRoutes] POST /:id/respond error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

module.exports = router;
