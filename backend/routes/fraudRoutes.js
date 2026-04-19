/**
 * fraudRoutes.js — Admin fraud alert management
 *
 * GET    /api/fraud/alerts              — paginated, filterable list (admin only)
 * PATCH  /api/fraud/alerts/:id          — update alert status (admin only)
 * GET    /api/fraud/alerts/user/:userId — alerts for a specific user (admin only)
 * GET    /api/fraud/score/:userId       — fraud risk score for a user (admin only)
 */

const express = require('express');
const router  = express.Router();
const { param, query, body, validationResult } = require('express-validator');
const mongoose = require('mongoose');

const auth       = require('../middlewares/authMiddleware');
const FraudAlert = require('../models/FraudAlert');
const { calculateFraudScore } = require('../services/fraudDetectionService');

// ── Helper: validate request ─────────────────────────────────────────────────
function checkValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: 'Validation failed', details: errors.array() });
    return false;
  }
  return true;
}

// ── Helper: admin guard ──────────────────────────────────────────────────────
function requireAdmin(req, res) {
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden — admin only' });
    return false;
  }
  return true;
}

// ── GET /alerts — paginated, filterable list ─────────────────────────────────
router.get(
  '/alerts',
  auth,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn(['open', 'investigating', 'confirmed', 'dismissed']),
    query('type').optional().isIn([
      'double_brokering', 'identity_fraud', 'price_manipulation',
      'unusual_activity', 'velocity_abuse',
    ]),
    query('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
  ],
  async (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      if (!checkValidation(req, res)) return;

      const page  = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip  = (page - 1) * limit;

      const filter = {};
      if (req.query.status)   filter.status   = req.query.status;
      if (req.query.type)     filter.type     = req.query.type;
      if (req.query.severity) filter.severity = req.query.severity;

      const [alerts, total] = await Promise.all([
        FraudAlert.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('user', 'name email role companyName')
          .populate('reviewedBy', 'name email'),
        FraudAlert.countDocuments(filter),
      ]);

      res.json({
        alerts,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      console.error('[fraudRoutes] GET /alerts failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ── GET /alerts/user/:userId — alerts for a specific user ────────────────────
router.get(
  '/alerts/user/:userId',
  auth,
  [param('userId').isMongoId()],
  async (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      if (!checkValidation(req, res)) return;

      const alerts = await FraudAlert.find({ user: req.params.userId })
        .sort({ createdAt: -1 })
        .populate('reviewedBy', 'name email');

      res.json({ alerts });
    } catch (err) {
      console.error('[fraudRoutes] GET /alerts/user failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ── PATCH /alerts/:id — update alert status ──────────────────────────────────
router.patch(
  '/alerts/:id',
  auth,
  [
    param('id').isMongoId(),
    body('status').isIn(['investigating', 'confirmed', 'dismissed']),
  ],
  async (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      if (!checkValidation(req, res)) return;

      const alert = await FraudAlert.findById(req.params.id);
      if (!alert) return res.status(404).json({ error: 'Alert not found' });

      alert.status     = req.body.status;
      alert.reviewedBy = req.user.userId;
      alert.reviewedAt = new Date();
      await alert.save();

      res.json({ alert });
    } catch (err) {
      console.error('[fraudRoutes] PATCH /alerts/:id failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ── GET /score/:userId — fraud risk score ────────────────────────────────────
router.get(
  '/score/:userId',
  auth,
  [param('userId').isMongoId()],
  async (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      if (!checkValidation(req, res)) return;

      const result = await calculateFraudScore(req.params.userId);
      res.json(result);
    } catch (err) {
      console.error('[fraudRoutes] GET /score failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

module.exports = router;
