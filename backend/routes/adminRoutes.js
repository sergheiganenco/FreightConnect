const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const bcrypt = require("bcrypt");

const Load = require("../models/Load");
const User = require("../models/User");
const Exception = require("../models/Exception");
const Company = require('../models/Company');
const companyNormalize = require('../utils/companyNormalize');

const ADMIN_ONLY = (req, res, next) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  next();
};

// ── GET /api/admin/stats ──────────────────────────────────────────────────────
router.get('/stats', auth, ADMIN_ONLY, async (req, res) => {
  try {
    const [liveLoads, flaggedIssues, users, revenueAgg] = await Promise.all([
      Load.countDocuments({ status: { $in: ['open', 'accepted', 'in-transit'] } }),
      Exception.countDocuments({ status: { $in: ['open', 'investigating'] } }),
      User.countDocuments({}),
      Load.aggregate([
        { $match: { status: 'delivered' } },
        { $group: { _id: null, total: { $sum: '$rate' } } },
      ]),
    ]);

    // Pending docs: accepted loads missing rateConfirmation
    const pendingDocs = await Load.countDocuments({
      status: { $in: ['accepted', 'in-transit'] },
      'documents.rateConfirmation': null,
    });

    const revenue = revenueAgg[0]?.total || 0;

    res.json({ pendingDocs, liveLoads, flaggedIssues, users, revenue });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// ── GET /api/admin/activity ───────────────────────────────────────────────────
router.get('/activity', auth, ADMIN_ONLY, async (req, res) => {
  try {
    // Combine recent loads + recent exceptions as activity feed
    const [recentLoads, recentExceptions] = await Promise.all([
      Load.find({})
        .sort({ updatedAt: -1 })
        .limit(5)
        .select('title status origin destination updatedAt')
        .lean(),
      Exception.find({})
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('filedBy', 'name')
        .select('title type severity status createdAt filedBy')
        .lean(),
    ]);

    const activity = [
      ...recentLoads.map(l => ({
        _id:         l._id,
        description: `Load "${l.title}" (${l.origin} → ${l.destination}) is ${l.status}`,
        date:        l.updatedAt,
        type:        'load',
      })),
      ...recentExceptions.map(e => ({
        _id:         e._id,
        description: `Exception filed: "${e.title}" [${e.severity}/${e.type}] — ${e.status}`,
        date:        e.createdAt,
        type:        'exception',
      })),
    ]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10);

    res.json(activity);
  } catch (err) {
    console.error('Admin activity error:', err);
    res.status(500).json({ error: 'Failed to load activity' });
  }
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────
router.get('/users', auth, ADMIN_ONLY, async (req, res) => {
  const page  = parseInt(req.query.page)  || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip  = (page - 1) * limit;
  const search = req.query.search || '';
  const role   = req.query.role   || '';

  const filter = {};
  if (search) {
    filter.$or = [
      { name:  { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }
  if (role) filter.role = role;

  const [total, users] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-password'),
  ]);

  res.json({ users, total, page, totalPages: Math.ceil(total / limit) });
});

// ── POST /api/admin/users — create user (any role, including admin) ───────────
router.post('/users', auth, ADMIN_ONLY, async (req, res) => {
  const { name, email, password, role, companyName } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password, role are required' });
  }
  if (!['carrier', 'shipper', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: 'Email already in use' });

    const hashed = await bcrypt.hash(password, 10);
    const userData = { name, email, password: hashed, role };

    if (companyName && role !== 'admin') {
      const normalized = companyNormalize(companyName);
      const company = await Company.findOneAndUpdate(
        { normalized },
        { $setOnInsert: { name: companyName, normalized, status: 'active' } },
        { upsert: true, new: true }
      );
      userData.companyName = companyName;
      userData.companyId   = company._id;
    }

    const user = await User.create(userData);
    const { password: _pw, ...safe } = user.toObject();
    res.status(201).json(safe);
  } catch (err) {
    console.error('Admin create user error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// ── PATCH /api/admin/users/:id ───────────────────────────────────────────────
router.patch('/users/:id', auth, ADMIN_ONLY, async (req, res) => {
  const { name, email, companyName, role } = req.body;
  const updates = {};
  if (name)  updates.name  = name;
  if (email) updates.email = email;
  if (role)  updates.role  = role;

  try {
    if (companyName) {
      const normalized = companyNormalize(companyName);
      const company = await Company.findOneAndUpdate(
        { normalized },
        { $setOnInsert: { name: companyName, normalized, status: 'active' } },
        { upsert: true, new: true }
      );
      updates.companyName = companyName;
      updates.companyId   = company._id;
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, select: '-password' }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error('Admin PATCH /users/:id error:', err);
    res.status(500).json({ error: 'Failed to update user.' });
  }
});

// ── PATCH /api/admin/users/:id/toggle-status ─────────────────────────────────
router.patch('/users/:id/toggle-status', auth, ADMIN_ONLY, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.status = user.status === 'suspended' ? 'active' : 'suspended';
    await user.save();
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle user status' });
  }
});

// ── GET /api/admin/loads ──────────────────────────────────────────────────────
router.get('/loads', auth, ADMIN_ONLY, async (req, res) => {
  const page  = parseInt(req.query.page,  10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip  = (page - 1) * limit;

  const filter = {};
  if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
  if (req.query.q) {
    filter.$or = [
      { title:       { $regex: req.query.q, $options: 'i' } },
      { origin:      { $regex: req.query.q, $options: 'i' } },
      { destination: { $regex: req.query.q, $options: 'i' } },
    ];
  }
  if (req.query.minAmount) filter.rate = { ...(filter.rate || {}), $gte: Number(req.query.minAmount) };
  if (req.query.maxAmount) filter.rate = { ...(filter.rate || {}), $lte: Number(req.query.maxAmount) };

  const [total, loads] = await Promise.all([
    Load.countDocuments(filter),
    Load.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('postedBy',  'name email companyName')
      .populate('acceptedBy', 'name email companyName'),
  ]);

  res.json({ loads, total, page, totalPages: Math.ceil(total / limit) });
});

// ── GET /api/admin/profile ────────────────────────────────────────────────────
router.get('/profile', auth, ADMIN_ONLY, async (req, res) => {
  const user = await User.findById(req.user.userId).select('-password');
  res.json(user);
});

// ── PUT /api/admin/profile ────────────────────────────────────────────────────
router.put('/profile', auth, ADMIN_ONLY, async (req, res) => {
  const { name, email } = req.body;
  const user = await User.findByIdAndUpdate(
    req.user.userId,
    { name, email },
    { new: true, select: '-password' }
  );
  res.json(user);
});

module.exports = router;
