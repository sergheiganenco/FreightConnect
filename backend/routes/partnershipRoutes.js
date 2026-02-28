/**
 * Partnership Routes
 *
 * POST   /api/partnerships               — send partnership request
 * GET    /api/partnerships               — list own partnerships (accepted + pending)
 * GET    /api/partnerships/directory     — carrier directory (verified carriers)
 * PUT    /api/partnerships/:id/accept    — accept a request
 * PUT    /api/partnerships/:id/decline   — decline a request
 * DELETE /api/partnerships/:id           — remove a partnership
 */

const express = require('express');
const router = express.Router();
const auth = require('../middlewares/authMiddleware');
const Partnership = require('../models/Partnership');
const User = require('../models/User');
const { notifyUserSafe } = require('../utils/notifyUser');

const CARRIER_ONLY = (req, res, next) => {
  if (req.user.role !== 'carrier') {
    return res.status(403).json({ error: 'Carriers only' });
  }
  next();
};

// ── POST /api/partnerships — send request ─────────────────────────────────
router.post('/', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const { carrierId, message = '' } = req.body;
    if (!carrierId) return res.status(400).json({ error: 'carrierId is required' });
    if (carrierId === req.user.userId) {
      return res.status(400).json({ error: 'Cannot partner with yourself' });
    }

    const target = await User.findById(carrierId).select('name companyName role');
    if (!target || target.role !== 'carrier') {
      return res.status(404).json({ error: 'Carrier not found' });
    }

    // Check for existing partnership in either direction
    const existing = await Partnership.findOne({
      $or: [
        { requestedBy: req.user.userId, requestedTo: carrierId },
        { requestedBy: carrierId, requestedTo: req.user.userId },
      ],
    });
    if (existing) {
      return res.status(409).json({
        error: `Partnership already ${existing.status === 'accepted' ? 'active' : 'pending'}`,
        partnership: existing,
      });
    }

    const partnership = await Partnership.create({
      requestedBy: req.user.userId,
      requestedTo: carrierId,
      message,
    });

    notifyUserSafe(carrierId, {
      type: 'load:matched',
      title: 'Partnership request received',
      body: `${target.companyName || 'A carrier'} wants to connect with you`,
      link: '/dashboard/carrier/network',
      metadata: { partnershipId: partnership._id },
    });

    res.status(201).json(partnership);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Partnership request already exists' });
    console.error('Partnership request error:', err);
    res.status(500).json({ error: 'Failed to send partnership request' });
  }
});

// ── GET /api/partnerships — list own partnerships ─────────────────────────
router.get('/', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const uid = req.user.userId;
    const { status } = req.query;
    const filter = {
      $or: [{ requestedBy: uid }, { requestedTo: uid }],
    };
    if (status && status !== 'all') filter.status = status;

    const partnerships = await Partnership.find(filter)
      .populate('requestedBy', 'name companyName email trustScore verification.status')
      .populate('requestedTo', 'name companyName email trustScore verification.status')
      .sort({ updatedAt: -1 });

    res.json(partnerships);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch partnerships' });
  }
});

// ── GET /api/partnerships/directory — browsable carrier directory ──────────
// Must be before /:id routes
router.get('/directory', auth, async (req, res) => {
  try {
    const { equipmentType, state, search, page = 1, limit = 20 } = req.query;
    const uid = req.user.userId;

    const filter = { role: 'carrier' };
    if (equipmentType && equipmentType !== 'all') {
      filter['preferences.equipmentTypes'] = equipmentType;
    }
    if (state) {
      filter.$or = [
        { 'preferences.preferredRegions': new RegExp(state, 'i') },
        { 'preferences.homeBase': new RegExp(state, 'i') },
      ];
    }
    if (search) {
      filter.$or = [
        { name: new RegExp(search, 'i') },
        { companyName: new RegExp(search, 'i') },
        { 'verification.fmcsaData.dotNumber': new RegExp(search, 'i') },
      ];
    }

    // Exclude self
    filter._id = { $ne: uid };

    const [carriers, total] = await Promise.all([
      User.find(filter)
        .select('name companyName email trustScore verification.status verification.fmcsaData preferences.equipmentTypes preferences.preferredRegions preferences.homeBase createdAt')
        .sort({ 'trustScore.overall': -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit)),
      User.countDocuments(filter),
    ]);

    // Hydrate with partnership status for the requesting user
    const partnershipMap = {};
    if (req.user.role === 'carrier') {
      const carrierIds = carriers.map(c => c._id.toString());
      const partnerships = await Partnership.find({
        $or: [
          { requestedBy: uid, requestedTo: { $in: carrierIds } },
          { requestedTo: uid, requestedBy: { $in: carrierIds } },
        ],
      }).lean();

      partnerships.forEach(p => {
        const otherId = p.requestedBy.toString() === uid
          ? p.requestedTo.toString()
          : p.requestedBy.toString();
        partnershipMap[otherId] = { status: p.status, partnershipId: p._id };
      });
    }

    const enriched = carriers.map(c => ({
      ...c.toObject(),
      partnershipStatus: partnershipMap[c._id.toString()] || null,
    }));

    res.json({ carriers: enriched, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('Directory error:', err);
    res.status(500).json({ error: 'Failed to fetch carrier directory' });
  }
});

// ── PUT /api/partnerships/:id/accept ─────────────────────────────────────
router.put('/:id/accept', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const p = await Partnership.findById(req.params.id)
      .populate('requestedBy', 'name companyName');
    if (!p) return res.status(404).json({ error: 'Partnership not found' });
    if (p.requestedTo.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Only the recipient can accept' });
    }
    if (p.status !== 'pending') {
      return res.status(409).json({ error: `Partnership is already ${p.status}` });
    }

    p.status = 'accepted';
    await p.save();

    notifyUserSafe(p.requestedBy._id.toString(), {
      type: 'bid:accepted',
      title: 'Partnership request accepted!',
      body: `You are now connected on the carrier network`,
      link: '/dashboard/carrier/network',
      metadata: { partnershipId: p._id },
    });

    res.json(p);
  } catch (err) {
    res.status(500).json({ error: 'Failed to accept partnership' });
  }
});

// ── PUT /api/partnerships/:id/decline ────────────────────────────────────
router.put('/:id/decline', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const p = await Partnership.findById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Partnership not found' });
    if (p.requestedTo.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Only the recipient can decline' });
    }
    p.status = 'declined';
    await p.save();
    res.json(p);
  } catch (err) {
    res.status(500).json({ error: 'Failed to decline partnership' });
  }
});

// ── DELETE /api/partnerships/:id ─────────────────────────────────────────
router.delete('/:id', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const uid = req.user.userId;
    const p = await Partnership.findById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (p.requestedBy.toString() !== uid && p.requestedTo.toString() !== uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await p.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove partnership' });
  }
});

module.exports = router;
