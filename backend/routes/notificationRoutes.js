/**
 * Notification Routes
 *
 * GET    /api/notifications              — list own notifications (paginated, unread first)
 * GET    /api/notifications/unread-count — fast unread badge count
 * PATCH  /api/notifications/:id/read    — mark single notification read
 * PATCH  /api/notifications/read-all    — mark all as read
 * DELETE /api/notifications/:id         — dismiss single notification
 */

const express = require('express');
const router = express.Router();
const auth = require('../middlewares/authMiddleware');
const Notification = require('../models/Notification');

const PAGE_SIZE = 20;

// ── GET /api/notifications ──────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const uid = req.user.userId;
    const page = Math.max(1, Number(req.query.page) || 1);
    const unreadOnly = req.query.unread === 'true';

    const filter = { userId: uid };
    if (unreadOnly) filter.read = false;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ read: 1, createdAt: -1 })  // unread first, then newest
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ userId: uid, read: false }),
    ]);

    res.json({
      notifications,
      total,
      unreadCount,
      page,
      pages: Math.ceil(total / PAGE_SIZE),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// ── GET /api/notifications/unread-count ────────────────────────────────────
router.get('/unread-count', auth, async (req, res) => {
  try {
    const count = await Notification.countDocuments({ userId: req.user.userId, read: false });
    res.json({ count });
  } catch {
    res.status(500).json({ error: 'Failed to fetch count' });
  }
});

// ── PATCH /api/notifications/read-all ──────────────────────────────────────
// Must be defined BEFORE /:id routes to prevent route shadowing
router.patch('/read-all', auth, async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user.userId, read: false }, { read: true });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to mark all read' });
  }
});

// ── PATCH /api/notifications/:id/read ─────────────────────────────────────
router.patch('/:id/read', auth, async (req, res) => {
  try {
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.userId },
      { read: true },
      { new: true }
    );
    if (!n) return res.status(404).json({ error: 'Notification not found' });
    res.json(n);
  } catch {
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

// ── DELETE /api/notifications/:id ──────────────────────────────────────────
router.delete('/:id', auth, async (req, res) => {
  try {
    await Notification.findOneAndDelete({ _id: req.params.id, userId: req.user.userId });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

module.exports = router;
