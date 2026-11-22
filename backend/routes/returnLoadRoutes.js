/**
 * Return Load Routes — Deadhead reduction suggestions for carriers.
 *
 * GET  /api/return-loads/:loadId        — Suggestions from a load's destination
 * GET  /api/return-loads/from-location  — Suggestions from arbitrary lat/lng
 */

const express = require('express');
const router = express.Router();
const { query, param } = require('express-validator');
const auth = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validate');
const Load = require('../models/Load');
const { findReturnLoads, findReturnLoadsForLoad } = require('../services/returnLoadService');

// ── GET /from-location — find loads near a lat/lng ────────────────────────────
// Must be defined BEFORE /:loadId to avoid "from-location" being matched as a loadId
router.get(
  '/from-location',
  auth,
  [
    query('lat').isFloat({ min: -90, max: 90 }).withMessage('lat must be a valid latitude'),
    query('lng').isFloat({ min: -180, max: 180 }).withMessage('lng must be a valid longitude'),
    query('equipmentType').optional().isString().trim().isLength({ max: 50 }),
    query('radius').optional().isInt({ min: 1, max: 500 }).withMessage('radius must be 1-500 miles'),
  ],
  validate,
  async (req, res) => {
    try {
      if (req.user.role !== 'carrier') {
        return res.status(403).json({ error: 'Only carriers can view return load suggestions' });
      }

      const lat = parseFloat(req.query.lat);
      const lng = parseFloat(req.query.lng);
      const radiusMiles = req.query.radius ? parseInt(req.query.radius, 10) : 50;
      const equipmentTypes = req.query.equipmentType ? [req.query.equipmentType] : [];

      const suggestions = await findReturnLoads({
        lat,
        lng,
        carrierId: req.user.companyOwnerId,
        equipmentTypes,
        radiusMiles,
      });

      res.json({
        success: true,
        distanceMethod: 'straight-line',
        location: { lat, lng },
        radiusMiles,
        count: suggestions.length,
        suggestions,
      });
    } catch (err) {
      console.error('[returnLoads/from-location] failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ── GET /:loadId — find return loads from a load's destination ────────────────
router.get(
  '/:loadId',
  auth,
  [
    param('loadId').isMongoId().withMessage('Invalid load ID'),
    query('radius').optional().isInt({ min: 1, max: 500 }).withMessage('radius must be 1-500 miles'),
  ],
  validate,
  async (req, res) => {
    try {
      if (req.user.role !== 'carrier') {
        return res.status(403).json({ error: 'Only carriers can view return load suggestions' });
      }

      const load = await Load.findById(req.params.loadId).lean();
      if (!load) {
        return res.status(404).json({ error: 'Load not found' });
      }

      // The load must belong to the caller's company (owner id; dispatchers/drivers act for it)
      if (String(load.acceptedBy) !== String(req.user.companyOwnerId)) {
        return res.status(403).json({ error: 'You can only get return load suggestions for your own loads' });
      }

      if (!['accepted', 'in-transit', 'delivered'].includes(load.status)) {
        return res.status(400).json({ error: 'Return load suggestions are only available for accepted, in-transit, or delivered loads' });
      }

      if (load.destinationLat == null || load.destinationLng == null) {
        return res.status(422).json({ error: 'This load has no destination coordinates, so nearby loads cannot be searched' });
      }

      const radius = req.query.radius ? parseInt(req.query.radius, 10) : undefined;
      const suggestions = await findReturnLoadsForLoad(load, req.user.companyOwnerId, radius);

      res.json({
        success: true,
        distanceMethod: 'straight-line',
        sourceLoad: {
          _id: load._id,
          title: load.title,
          destination: load.destination,
          destinationLat: load.destinationLat,
          destinationLng: load.destinationLng,
          deliveryEnd: load.deliveryTimeWindow?.end || null,
        },
        count: suggestions.length,
        suggestions,
      });
    } catch (err) {
      console.error('[returnLoads/:loadId] failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

module.exports = router;
