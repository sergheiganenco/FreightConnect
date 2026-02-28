/**
 * Trip Routes — Multi-Load Route Planning for Carriers
 *
 * POST   /api/trips                            — Create trip
 * GET    /api/trips                            — List carrier's trips
 * GET    /api/trips/:id                        — Trip detail
 * PUT    /api/trips/:id                        — Update trip (planned only)
 * POST   /api/trips/:id/start                  — Start trip (planned → active)
 * POST   /api/trips/:id/complete               — Complete trip (active → completed)
 * DELETE /api/trips/:id                        — Cancel trip
 * PATCH  /api/trips/:id/waypoints/:waypointId  — Update waypoint status
 * POST   /api/trips/:id/fuel                   — Log a fuel stop
 * GET    /api/trips/:id/route                  — Get/refresh route geometry from ORS
 */

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const auth    = require('../middlewares/authMiddleware');
const Trip    = require('../models/Trip');
const Load    = require('../models/Load');

const CARRIER_ONLY = (req, res, next) => {
  if (req.user.role !== 'carrier' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Carriers only' });
  }
  next();
};

// ── POST / — create trip ──────────────────────────────────────────────────────
router.post('/', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const { name, loadIds = [], truck, plannedDepartureAt, plannedArrivalAt, notes, route } = req.body;
    if (!name) return res.status(400).json({ error: 'Trip name is required' });

    // Validate loads belong to this carrier
    let loads = [];
    if (loadIds.length > 0) {
      loads = await Load.find({
        _id:        { $in: loadIds },
        acceptedBy: req.user.userId,
        status:     { $in: ['accepted', 'in-transit'] },
      }).lean();
    }

    // Build waypoints from loads
    const waypoints = [];
    for (const load of loads) {
      waypoints.push({
        type:      'origin',
        name:      load.title + ' — Pickup',
        address:   load.origin,
        latitude:  load.originLat,
        longitude: load.originLng,
        load:      load._id,
      });
      waypoints.push({
        type:      'delivery',
        name:      load.title + ' — Delivery',
        address:   load.destination,
        latitude:  load.destinationLat,
        longitude: load.destinationLng,
        load:      load._id,
      });
    }

    // Allow custom waypoints (fuel/rest stops) from req.body.waypoints
    if (Array.isArray(req.body.waypoints)) {
      for (const wp of req.body.waypoints) {
        if (wp.type && !['origin', 'delivery'].includes(wp.type)) {
          waypoints.push(wp);
        }
      }
    }

    const trip = await Trip.create({
      carrier: req.user.userId,
      name,
      truck,
      loads: loads.map(l => l._id),
      waypoints,
      plannedDepartureAt,
      plannedArrivalAt,
      notes,
      route: route || {},
      history: [{ action: 'created', performedBy: req.user.userId, details: 'Trip created' }],
    });

    const populated = await Trip.findById(trip._id).populate('loads', 'title origin destination rate status');
    res.status(201).json(populated);
  } catch (err) {
    console.error('Trip create error:', err);
    res.status(500).json({ error: 'Failed to create trip' });
  }
});

// ── GET / — list trips ────────────────────────────────────────────────────────
router.get('/', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { carrier: req.user.userId };
    if (status && status !== 'all') filter.status = status;

    const trips = await Trip.find(filter)
      .populate('loads', 'title origin destination rate status')
      .sort({ plannedDepartureAt: -1, createdAt: -1 });

    res.json(trips);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch trips' });
  }
});

// ── GET /:id — trip detail ────────────────────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id)
      .populate('loads',           'title origin destination rate status originLat originLng destinationLat destinationLng')
      .populate('history.performedBy', 'name role');
    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    const uid = req.user.userId;
    if (req.user.role !== 'admin' && trip.carrier.toString() !== uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(trip);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch trip' });
  }
});

// ── PUT /:id — update trip ────────────────────────────────────────────────────
router.put('/:id', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    if (trip.carrier.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (trip.status !== 'planned') {
      return res.status(409).json({ error: 'Only planned trips can be edited' });
    }

    const allowed = ['name', 'truck', 'plannedDepartureAt', 'plannedArrivalAt', 'notes', 'route', 'waypoints'];
    allowed.forEach(k => { if (req.body[k] !== undefined) trip[k] = req.body[k]; });
    trip.history.push({ action: 'updated', performedBy: req.user.userId });
    await trip.save();

    const populated = await Trip.findById(trip._id).populate('loads', 'title origin destination rate status');
    res.json(populated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update trip' });
  }
});

// ── POST /:id/start — start trip ──────────────────────────────────────────────
router.post('/:id/start', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    if (trip.carrier.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (trip.status !== 'planned') {
      return res.status(409).json({ error: 'Only planned trips can be started' });
    }

    trip.status            = 'active';
    trip.actualDepartureAt = new Date();
    if (req.body.startOdometer) trip.startOdometer = req.body.startOdometer;
    trip.history.push({ action: 'started', performedBy: req.user.userId });
    await trip.save();
    res.json(trip);
  } catch (err) {
    res.status(500).json({ error: 'Failed to start trip' });
  }
});

// ── POST /:id/complete — complete trip ────────────────────────────────────────
router.post('/:id/complete', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    if (trip.carrier.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (trip.status !== 'active') {
      return res.status(409).json({ error: 'Only active trips can be completed' });
    }

    trip.status          = 'completed';
    trip.actualArrivalAt = new Date();
    if (req.body.endOdometer) trip.endOdometer = req.body.endOdometer;
    trip.history.push({ action: 'completed', performedBy: req.user.userId });
    await trip.save();
    res.json(trip);
  } catch (err) {
    res.status(500).json({ error: 'Failed to complete trip' });
  }
});

// ── DELETE /:id — cancel trip ─────────────────────────────────────────────────
router.delete('/:id', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    if (trip.carrier.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (trip.status === 'completed') {
      return res.status(409).json({ error: 'Cannot cancel a completed trip' });
    }

    trip.status = 'cancelled';
    trip.history.push({ action: 'cancelled', performedBy: req.user.userId });
    await trip.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel trip' });
  }
});

// ── PATCH /:id/waypoints/:waypointId — update waypoint status ────────────────
router.patch('/:id/waypoints/:waypointId', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    if (trip.carrier.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const wp = trip.waypoints.id(req.params.waypointId);
    if (!wp) return res.status(404).json({ error: 'Waypoint not found' });

    if (req.body.status) wp.status = req.body.status;
    if (req.body.status === 'arrived' && !wp.scheduledAt) wp.scheduledAt = new Date();
    if (req.body.status === 'completed') wp.completedAt = new Date();
    if (req.body.notes) wp.notes = req.body.notes;

    await trip.save();
    res.json(trip);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update waypoint' });
  }
});

// ── POST /:id/fuel — log a fuel stop ─────────────────────────────────────────
router.post('/:id/fuel', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    if (trip.carrier.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { location, gallons, pricePerGallon } = req.body;
    if (!gallons || !pricePerGallon) {
      return res.status(400).json({ error: 'gallons and pricePerGallon are required' });
    }

    const totalCost = Math.round(parseFloat(gallons) * parseFloat(pricePerGallon) * 100); // cents
    trip.fuelStops.push({ location, gallons, pricePerGallon, totalCost: totalCost / 100 });
    trip.totalFuelCostCents += totalCost;
    await trip.save();
    res.json(trip);
  } catch (err) {
    res.status(500).json({ error: 'Failed to log fuel stop' });
  }
});

// ── GET /:id/route — fetch route geometry from OpenRouteService ───────────────
router.get('/:id/route', auth, async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id).populate('loads', 'originLat originLng destinationLat destinationLng');
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    if (trip.carrier.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Collect coordinate waypoints that have lat/lng
    const coords = trip.waypoints
      .filter(wp => wp.longitude && wp.latitude && wp.status !== 'skipped')
      .map(wp => [wp.longitude, wp.latitude]);

    if (coords.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 waypoints with coordinates' });
    }

    const apiKey = process.env.ORS_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'Route service not configured' });

    const orsRes = await axios.post(
      'https://api.openrouteservice.org/v2/directions/driving-hgv/geojson',
      { coordinates: coords },
      { headers: { Authorization: apiKey, 'Content-Type': 'application/json' } }
    );

    const feature  = orsRes.data.features?.[0];
    const summary  = feature?.properties?.summary || {};
    const distance = summary.distance ? Math.round(summary.distance / 1609.344) : null; // meters → miles
    const duration = summary.duration ? Math.round(summary.duration / 3600 * 10) / 10 : null; // seconds → hours

    // Persist summary back to trip
    if (distance) {
      trip.route.totalDistanceMiles   = distance;
      trip.route.estimatedDurationHours = duration;
      if (trip.route.mpg) trip.route.estimatedFuelGallons = Math.round(distance / trip.route.mpg);
      await trip.save();
    }

    res.json({ geometry: feature?.geometry, summary: { distanceMiles: distance, durationHours: duration }, trip });
  } catch (err) {
    console.error('Route fetch error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch route' });
  }
});

module.exports = router;
