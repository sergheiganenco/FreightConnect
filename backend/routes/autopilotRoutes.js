/**
 * Truck Autopilot -- proposes the most profitable FEASIBLE chain of open loads for one truck.
 *
 * GET /api/autopilot/plan   -- plan chains for a truck (read-only; booking stays on PUT /api/loads/:id/accept)
 * GET /api/autopilot/rules  -- saved autopilot defaults (owner/dispatcher)
 * PUT /api/autopilot/rules  -- save autopilot defaults (owner/dispatcher)
 * POST /api/autopilot/request -- a driver asks the office to book a plan (drivers cannot book)
 */
const express = require('express');
const { query, body } = require('express-validator');
const auth = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validate');
const { managerOnly } = require('../middlewares/companyRoles');
const { makeLimiter } = require('../middlewares/rateLimiter');
const User = require('../models/User');
const { planForTruck, getRules, AutopilotError } = require('../services/autopilotService');

const router = express.Router();

// Planning scans up to 300 loads: capped per COMPANY (a fleet office shares one IP), on top of the general API limiter.
const planLimiter = makeLimiter({
  windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.companyOwnerId || req.user?.userId || 'anon'),
  message: { error: 'Too many plan requests, please try again shortly' },
}, 'rl:autopilot:');

const carrierOnly = (req, res, next) => {
  if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Only carriers can use Autopilot' });
  next();
};

router.get('/plan', auth, carrierOnly, planLimiter,
  [
    query('truckId').isString().trim().isLength({ min: 1, max: 50 }).withMessage('truckId is required'),
    query('lat').optional().isFloat({ min: -90, max: 90 }).withMessage('lat must be a valid latitude'),
    query('lng').optional().isFloat({ min: -180, max: 180 }).withMessage('lng must be a valid longitude'),
    query('lat').custom((v, { req }) => (v === undefined) === (req.query.lng === undefined)).withMessage('lat and lng must be given together'),
    query('minRatePerMileCents').optional().isInt({ min: 0, max: 5000 }).withMessage('minRatePerMileCents must be 0-5000'),
    query('maxDeadheadMiles').optional().isInt({ min: 1, max: 500 }).withMessage('maxDeadheadMiles must be 1-500'),
    query('homeBy').optional().isISO8601().withMessage('homeBy must be an ISO date'),
    query('maxLoads').optional().isInt({ min: 1, max: 3 }).withMessage('maxLoads must be 1-3'),
  ],
  validate,
  async (req, res) => {
    try {
      const q = req.query;
      const plan = await planForTruck({
        companyId: req.user.companyOwnerId,
        caller: req.user,
        truckId: q.truckId,
        overrides: {
          lat: q.lat !== undefined ? parseFloat(q.lat) : null,
          lng: q.lng !== undefined ? parseFloat(q.lng) : null,
          minRatePerMileCents: q.minRatePerMileCents !== undefined ? parseInt(q.minRatePerMileCents, 10) : null,
          maxDeadheadMiles: q.maxDeadheadMiles !== undefined ? parseInt(q.maxDeadheadMiles, 10) : null,
          homeBy: q.homeBy ? new Date(q.homeBy) : null,
          maxLoads: q.maxLoads !== undefined ? parseInt(q.maxLoads, 10) : 3,
        },
        now: new Date(),
      });
      res.json({ success: true, data: plan });
    } catch (err) {
      if (err instanceof AutopilotError) return res.status(err.status).json({ error: err.message });
      console.error('[autopilot/plan] failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

router.get('/rules', auth, carrierOnly, managerOnly, async (req, res) => {
  try {
    res.json({ success: true, data: await getRules(req.user.companyOwnerId) });
  } catch (err) {
    console.error('[autopilot/rules] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// A driver cannot book. They can ask the office to book a plan the planner offers for their truck.
router.post('/request', auth, carrierOnly, planLimiter,
  [
    body('truckId').isString().trim().isLength({ min: 1, max: 50 }).withMessage('truckId is required'),
    body('loadIds').isArray({ min: 1, max: 3 }).withMessage('loadIds must list 1 to 3 loads'),
    body('loadIds.*').isMongoId().withMessage('loadIds must be load ids'),
  ],
  validate,
  async (req, res) => {
    try {
      const companyId = String(req.user.companyOwnerId || req.user.userId);
      const wanted = req.body.loadIds.map(String).join(',');
      // The planner decides what this person may see and what the truck can run: only a plan it offers can be requested.
      const plan = await planForTruck({ companyId, caller: req.user, truckId: req.body.truckId, overrides: { maxLoads: 3 }, now: new Date() });
      const hit = plan.plans.find((p) => p.loadIds.map(String).join(',') === wanted);
      if (!hit) return res.status(404).json({ error: 'That plan is no longer available for this truck. Plan again.' });

      const Notification = require('../models/Notification');
      const key = `${req.user.userId}:${req.body.truckId}:${wanted}`;
      const asked = await Notification.exists({ type: 'autopilot:driver_request', 'metadata.key': key, createdAt: { $gte: new Date(Date.now() - 3600000) } });
      if (!asked) {
        const me = await User.findById(req.user.userId).select('name').lean();
        const dispatchers = await User.find({ parentAccountId: companyId, companyRole: 'dispatcher', active: { $ne: false } }).select('_id').lean();
        const { notifyUserSafe } = require('../utils/notifyUser');
        const loads = hit.legs.map((l) => `"${l.load.title}" ${l.load.origin} to ${l.load.destination}`).join(', then ');
        for (const id of [companyId, ...dispatchers.map((d) => String(d._id))]) {
          if (id === String(req.user.userId)) continue;
          await notifyUserSafe(id, {
            type: 'autopilot:driver_request',
            title: `${(me && me.name) || 'A driver'} asks for a next load (truck ${req.body.truckId})`,
            body: `${loads}. Open the planner to book it.`,
            link: `/dashboard/carrier/autopilot?truckId=${encodeURIComponent(req.body.truckId)}`,
            metadata: { key, truckId: req.body.truckId, loadIds: req.body.loadIds, priority: 'high' },
          });
        }
      }
      res.json({ success: true, data: { requested: true, alreadyAsked: !!asked } });
    } catch (err) {
      if (err instanceof AutopilotError) return res.status(err.status).json({ error: err.message });
      console.error('[autopilot/request] failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

const nullableInt = (name, min, max) => body(name).optional({ nullable: true }).isInt({ min, max }).withMessage(`${name} must be ${min}-${max}`).toInt();

router.put('/rules', auth, carrierOnly, managerOnly,
  [
    nullableInt('minRatePerMileCents', 0, 5000),
    nullableInt('maxDeadheadMiles', 1, 500),
    nullableInt('maxWeightLbs', 1, 200000),
    body('allowHazmat').optional().isBoolean().withMessage('allowHazmat must be true or false').toBoolean(),
    body('homeBy').optional({ nullable: true }).isISO8601().withMessage('homeBy must be an ISO date'),
  ],
  validate,
  async (req, res) => {
    try {
      const $set = {};
      for (const k of ['minRatePerMileCents', 'maxDeadheadMiles', 'maxWeightLbs', 'allowHazmat']) {
        if (req.body[k] !== undefined) $set[`preferences.autopilot.${k}`] = req.body[k];
      }
      if (req.body.homeBy !== undefined) $set['preferences.autopilot.homeBy'] = req.body.homeBy ? new Date(req.body.homeBy) : null;
      if (Object.keys($set).length) {
        const r = await User.updateOne({ _id: req.user.companyOwnerId }, { $set });
        if (!r.matchedCount) return res.status(404).json({ error: 'Account not found' });
      }
      res.json({ success: true, data: await getRules(req.user.companyOwnerId) });
    } catch (err) {
      console.error('[autopilot/rules] save failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

module.exports = router;
