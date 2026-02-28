/**
 * Capacity Routes
 *
 * POST   /api/capacity            — post available capacity (carrier only)
 * GET    /api/capacity            — browse capacity board (any auth'd user; filtered)
 * GET    /api/capacity/my         — own capacity posts
 * GET    /api/capacity/:id        — single post detail
 * PUT    /api/capacity/:id        — update own post
 * PUT    /api/capacity/:id/book   — mark as booked (another carrier contacts + books)
 * PUT    /api/capacity/:id/cancel — cancel own post
 * DELETE /api/capacity/:id        — hard delete own post
 */

const express = require('express');
const router = express.Router();
const auth = require('../middlewares/authMiddleware');
const Capacity = require('../models/Capacity');
const { notifyUserSafe } = require('../utils/notifyUser');

const CARRIER_ONLY = (req, res, next) => {
  if (req.user.role !== 'carrier' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Carriers only' });
  }
  next();
};

// ── POST /api/capacity — post capacity ─────────────────────────────────────
router.post('/', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const {
      equipmentType, truckId, weightCapacity,
      availableFrom, availableTo,
      originCity, originState, destCity, destState, preferredRegions,
      ratePerMile, minLoadValue, notes, contactPhone,
    } = req.body;

    if (!equipmentType || !availableFrom || !availableTo || !originCity || !originState) {
      return res.status(400).json({ error: 'equipmentType, availableFrom, availableTo, originCity, originState are required' });
    }
    if (new Date(availableTo) <= new Date(availableFrom)) {
      return res.status(400).json({ error: 'availableTo must be after availableFrom' });
    }

    const post = await Capacity.create({
      carrierId: req.user.userId,
      equipmentType, truckId, weightCapacity,
      availableFrom, availableTo,
      originCity, originState, destCity, destState,
      preferredRegions: preferredRegions || [],
      ratePerMile, minLoadValue, notes, contactPhone,
    });

    res.status(201).json(post);
  } catch (err) {
    console.error('Post capacity error:', err);
    res.status(500).json({ error: 'Failed to post capacity' });
  }
});

// ── GET /api/capacity — browse board ──────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const {
      equipmentType, originState, destState,
      from, to,
      page = 1, limit = 20,
    } = req.query;

    const filter = { status: 'active' };
    if (equipmentType && equipmentType !== 'all') filter.equipmentType = equipmentType;
    if (originState) filter.originState = new RegExp(`^${originState}$`, 'i');
    if (destState) filter.destState = new RegExp(`^${destState}$`, 'i');
    if (from) filter.availableFrom = { $gte: new Date(from) };
    if (to) filter.availableTo = { $lte: new Date(to) };

    const [posts, total] = await Promise.all([
      Capacity.find(filter)
        .populate('carrierId', 'name companyName trustScore verification.status verification.fmcsaData')
        .sort({ availableFrom: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit)),
      Capacity.countDocuments(filter),
    ]);

    res.json({ posts, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch capacity board' });
  }
});

// ── GET /api/capacity/my — own posts ──────────────────────────────────────
router.get('/my', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const posts = await Capacity.find({ carrierId: req.user.userId })
      .sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch your capacity posts' });
  }
});

// ── GET /api/capacity/:id — single post ──────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    const post = await Capacity.findById(req.params.id)
      .populate('carrierId', 'name companyName trustScore verification email')
      .populate('bookedBy', 'name companyName email');
    if (!post) return res.status(404).json({ error: 'Capacity post not found' });
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch capacity post' });
  }
});

// ── PUT /api/capacity/:id — update own post ───────────────────────────────
router.put('/:id', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const post = await Capacity.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Not found' });
    if (post.carrierId.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (post.status === 'booked') {
      return res.status(409).json({ error: 'Cannot edit a booked post' });
    }

    const allowed = [
      'equipmentType','truckId','weightCapacity','availableFrom','availableTo',
      'originCity','originState','destCity','destState','preferredRegions',
      'ratePerMile','minLoadValue','notes','contactPhone',
    ];
    allowed.forEach(k => { if (req.body[k] !== undefined) post[k] = req.body[k]; });
    await post.save();
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update capacity post' });
  }
});

// ── PUT /api/capacity/:id/book — another carrier books this capacity ───────
router.put('/:id/book', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const post = await Capacity.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Not found' });
    if (post.carrierId.toString() === req.user.userId) {
      return res.status(409).json({ error: 'Cannot book your own capacity post' });
    }
    if (post.status !== 'active') {
      return res.status(409).json({ error: `Capacity is already ${post.status}` });
    }

    post.status = 'booked';
    post.bookedBy = req.user.userId;
    post.bookedAt = new Date();
    await post.save();

    // Notify the carrier who posted
    notifyUserSafe(post.carrierId.toString(), {
      type: 'load:status',
      title: 'Your capacity post was booked!',
      body: `${post.equipmentType} · ${post.originCity}, ${post.originState}`,
      link: '/dashboard/carrier/network',
      metadata: { capacityId: post._id },
    });

    res.json(post);
  } catch (err) {
    res.status(500).json({ error: 'Failed to book capacity' });
  }
});

// ── PUT /api/capacity/:id/cancel — cancel own active post ─────────────────
router.put('/:id/cancel', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const post = await Capacity.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Not found' });
    if (post.carrierId.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    post.status = 'cancelled';
    await post.save();
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel post' });
  }
});

// ── DELETE /api/capacity/:id ───────────────────────────────────────────────
router.delete('/:id', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const post = await Capacity.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Not found' });
    if (post.carrierId.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await post.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

module.exports = router;
