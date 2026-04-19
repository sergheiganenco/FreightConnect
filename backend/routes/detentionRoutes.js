/**
 * detentionRoutes.js — Dwell Time & Detention Management
 *
 * POST   /api/detention/check-in/:loadId    — driver arrives at facility
 * PATCH  /api/detention/dock-in/:eventId    — loading/unloading starts
 * PATCH  /api/detention/dock-out/:eventId   — loading/unloading complete
 * PATCH  /api/detention/depart/:eventId     — driver leaves facility
 * GET    /api/detention/load/:loadId        — all dwell events for a load
 * GET    /api/detention/active              — carrier's currently active check-ins
 * GET    /api/detention/summary             — carrier's detention summary (totals, fees)
 * GET    /api/detention/facility/:name      — facility reputation stats
 * GET    /api/detention/cascade/:loadId     — cascade impact preview for a load
 */

const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/authMiddleware');
const DwellEvent = require('../models/DwellEvent');
const Load    = require('../models/Load');
const {
  recalculateDwellEvent,
  assessCascadeImpact,
  getFacilityStats,
  getDetentionRates,
} = require('../services/detentionService');

// ── POST /check-in/:loadId — driver arrives at facility ─────────────────────
router.post('/check-in/:loadId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });

    const load = await Load.findById(req.params.loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });
    if (String(load.acceptedBy) !== req.user.userId) {
      return res.status(403).json({ error: 'Not your load' });
    }

    const { stopType, stopIndex, facilityName, facilityAddress, notes } = req.body;
    if (!stopType || !['pickup', 'delivery'].includes(stopType)) {
      return res.status(400).json({ error: 'stopType must be pickup or delivery' });
    }

    // Prevent duplicate active check-ins for same stop
    const existing = await DwellEvent.findOne({
      load: load._id,
      carrier: req.user.userId,
      stopType,
      stopIndex: stopIndex || 0,
      departedAt: null,
    });
    if (existing) {
      return res.status(409).json({ error: 'Already checked in at this stop', event: existing });
    }

    // Get detention rates (from contract or defaults)
    const rates = await getDetentionRates(load._id);

    const event = await DwellEvent.create({
      load: load._id,
      carrier: req.user.userId,
      shipper: load.postedBy,
      stopType,
      stopIndex: stopIndex || 0,
      facilityName: facilityName || (stopType === 'pickup' ? load.pickupFacilityName : load.deliveryFacilityName) || '',
      facilityAddress: facilityAddress || (stopType === 'pickup' ? load.pickupAddress : load.deliveryAddress) || '',
      arrivedAt: new Date(),
      freeMinutes: rates.freeMinutes,
      detentionRateCents: rates.rateCentsPerHour,
      contractId: load.contractId || null,
      notes: notes || '',
    });

    res.status(201).json(event);
  } catch (err) {
    console.error('Error checking in:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PATCH /dock-in/:eventId — loading/unloading starts ──────────────────────
router.patch('/dock-in/:eventId', auth, async (req, res) => {
  try {
    const event = await DwellEvent.findOne({ _id: req.params.eventId, carrier: req.user.userId });
    if (!event) return res.status(404).json({ error: 'Dwell event not found' });
    if (event.dockInAt) return res.status(409).json({ error: 'Already docked in' });

    event.dockInAt = new Date();
    await event.save();

    // Recalculate detention (dwell is ticking)
    const updated = await recalculateDwellEvent(event._id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PATCH /dock-out/:eventId — loading/unloading complete ───────────────────
router.patch('/dock-out/:eventId', auth, async (req, res) => {
  try {
    const event = await DwellEvent.findOne({ _id: req.params.eventId, carrier: req.user.userId });
    if (!event) return res.status(404).json({ error: 'Dwell event not found' });

    event.dockOutAt = new Date();
    await event.save();

    const updated = await recalculateDwellEvent(event._id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PATCH /depart/:eventId — driver leaves facility ─────────────────────────
router.patch('/depart/:eventId', auth, async (req, res) => {
  try {
    const event = await DwellEvent.findOne({ _id: req.params.eventId, carrier: req.user.userId });
    if (!event) return res.status(404).json({ error: 'Dwell event not found' });
    if (event.departedAt) return res.status(409).json({ error: 'Already departed' });

    event.departedAt = new Date();
    if (req.body.notes) event.notes = req.body.notes;
    await event.save();

    // Final recalculation + cascade assessment
    const updated = await recalculateDwellEvent(event._id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /load/:loadId — all dwell events for a load ─────────────────────────
router.get('/load/:loadId', auth, async (req, res) => {
  try {
    const events = await DwellEvent.find({ load: req.params.loadId })
      .sort({ arrivedAt: 1 })
      .populate('nextLoadId', 'title origin pickupTimeWindow');
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /active — carrier's active (not departed) check-ins ─────────────────
router.get('/active', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
    const events = await DwellEvent.find({ carrier: req.user.userId, departedAt: null })
      .populate('load', 'title origin destination status')
      .sort({ arrivedAt: -1 });
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /summary — carrier detention summary (for tax/expense integration) ──
router.get('/summary', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });

    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const start = new Date(`${year}-01-01T00:00:00.000Z`);
    const end   = new Date(`${year}-12-31T23:59:59.999Z`);

    const mongoose = require('mongoose');
    const carrierId = new mongoose.Types.ObjectId(req.user.userId);

    const pipeline = [
      { $match: { carrier: carrierId, arrivedAt: { $gte: start, $lte: end }, departedAt: { $ne: null } } },
      {
        $group: {
          _id: null,
          totalEvents:        { $sum: 1 },
          totalDwellMin:      { $sum: '$dwellMinutes' },
          totalDetentionMin:  { $sum: '$detentionMinutes' },
          totalDetentionFee:  { $sum: '$detentionFeeCents' },
          avgDwellMin:        { $avg: '$dwellMinutes' },
          detentionEvents:    { $sum: { $cond: [{ $gt: ['$detentionMinutes', 0] }, 1, 0] } },
        },
      },
    ];

    const [result] = await DwellEvent.aggregate(pipeline);

    res.json({
      year,
      totalEvents:          result?.totalEvents || 0,
      totalDwellMinutes:    result?.totalDwellMin || 0,
      totalDetentionMinutes: result?.totalDetentionMin || 0,
      totalDetentionFeeCents: result?.totalDetentionFee || 0,
      avgDwellMinutes:      Math.round(result?.avgDwellMin || 0),
      detentionFrequency:   result?.totalEvents ? Math.round((result.detentionEvents / result.totalEvents) * 100) : 0,
    });
  } catch (err) {
    console.error('Error fetching detention summary:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /facility/:name — facility reputation ───────────────────────────────
// Carriers can check this BEFORE accepting a load to see if a facility is known
// for long waits. This builds trust: "our platform warns you about bad facilities."
router.get('/facility/:name', auth, async (req, res) => {
  try {
    const stats = await getFacilityStats(decodeURIComponent(req.params.name));
    if (!stats) return res.status(404).json({ error: 'No data for this facility' });
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /cascade/:loadId — preview cascade impact before accepting ──────────
router.get('/cascade/:loadId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });

    // Simulate: if the carrier were to accept this load, what's the schedule like?
    const load = await Load.findById(req.params.loadId).select('deliveryTimeWindow');
    if (!load) return res.status(404).json({ error: 'Load not found' });

    const estimatedDeparture = load.deliveryTimeWindow?.end || new Date();
    const cascade = await assessCascadeImpact(req.user.userId, estimatedDeparture);

    res.json(cascade);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
