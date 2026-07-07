const express = require('express');
const router = express.Router();
const auth = require('../middlewares/authMiddleware');
const Load = require('../models/Load');
const User = require('../models/User');
const TrackingEvent = require('../models/TrackingEvent');
const trackingService = require('../services/trackingService');

const VALID_SOURCES = ['browser', 'mobile_app', 'eld', 'api'];
const GPS_CONSENT_VERSION = 'v1';

// ── Haversine distance in miles ───────────────────────────────────────────────
function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.7613; // mean Earth radius in miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// POST /api/tracking/location — source-agnostic location ingest
// Works for browser, mobile app, ELD webhook, or any external tracker.
// All writes (carrierLocation, breadcrumb, geofence, socket emit) go through
// trackingService.recordLocation — the single source of truth.
router.post('/location', auth, async (req, res) => {
  try {
    const { loadId, latitude, longitude, speed, heading, accuracy, source } = req.body;

    if (!loadId || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'loadId, latitude, and longitude are required' });
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }

    // Authorization: only the assigned carrier company (or admin) can push location —
    // a driver/dispatcher sub-account counts as its company.
    const load = await Load.findById(loadId).select('acceptedBy');
    if (!load) return res.status(404).json({ error: 'Load not found' });
    const companyId = req.user.companyOwnerId || req.user.userId;
    if (String(load.acceptedBy) !== String(companyId) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to update this load\'s location' });
    }

    // Privacy gate: the PERSON pushing location (the acting driver) must have
    // granted GPS consent — per-driver, not company-wide.
    const consentUser = await User.findById(req.user.userId).select('tracking');
    if (!consentUser || !consentUser.tracking || !consentUser.tracking.gpsConsent || !consentUser.tracking.gpsConsent.granted) {
      return res.status(403).json({ error: 'GPS tracking consent is required before location can be recorded', code: 'gps_consent_required' });
    }

    const r = await trackingService.recordLocation({
      loadId,
      latitude,
      longitude,
      speed,
      heading,
      accuracy,
      // Honor a valid client-declared source; otherwise mark as mobile_app.
      source: VALID_SOURCES.includes(source) ? source : 'mobile_app',
      // Gate on the acting driver's own consent.
      consentUserId: req.user.userId,
    });
    if (!r.ok) return res.status(r.code || 500).json({ error: r.error || 'Failed' });

    res.json({ ok: true });
  } catch (err) {
    console.error('Tracking location error:', err);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// ── GPS consent (privacy) ───────────────────────────────────────────────────
// Each user records consent for THEIR OWN background location tracking. Purpose
// is limited to load tracking, detention documentation, and ETA. Revocable.
// NOTE: declared BEFORE GET /:loadId so the literal path is not parsed as a loadId.

// POST /api/tracking/consent — grant or revoke GPS tracking consent
router.post('/consent', auth, async (req, res) => {
  try {
    const granted = req.body && req.body.granted === true;
    const gpsConsent = granted
      ? {
          granted: true,
          grantedAt: new Date(),
          version: (req.body && req.body.version) || GPS_CONSENT_VERSION,
          ip: req.ip || (req.headers && req.headers['x-forwarded-for']) || null,
          revokedAt: null,
        }
      : {
          granted: false,
          grantedAt: null,
          version: (req.body && req.body.version) || GPS_CONSENT_VERSION,
          ip: req.ip || null,
          revokedAt: new Date(),
        };

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { 'tracking.gpsConsent': gpsConsent },
      { new: true }
    ).select('tracking');

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ gpsConsent: user.tracking.gpsConsent });
  } catch (err) {
    console.error('GPS consent error:', err.message);
    res.status(500).json({ error: 'Failed to record consent' });
  }
});

// GET /api/tracking/consent — current consent status for the calling user
router.get('/consent', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('tracking');
    const gpsConsent = (user && user.tracking && user.tracking.gpsConsent) || { granted: false };
    res.json({ gpsConsent, currentVersion: GPS_CONSENT_VERSION });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get consent' });
  }
});

// GET /api/tracking/:loadId — get current carrier location for a load
router.get('/:loadId', auth, async (req, res) => {
  try {
    const load = await Load.findById(req.params.loadId).select('carrierLocation postedBy acceptedBy status');
    if (!load) return res.status(404).json({ error: 'Load not found' });

    // Only shipper, assigned carrier, or admin can view
    const userId = String(req.user.companyOwnerId || req.user.userId);
    const allowed = userId === String(load.postedBy) || userId === String(load.acceptedBy) || req.user.role === 'admin';
    if (!allowed) return res.status(403).json({ error: 'Not authorized' });

    res.json({
      carrierLocation: load.carrierLocation || null,
      status: load.status,
    });
  } catch (err) {
    console.error('Get tracking error:', err);
    res.status(500).json({ error: 'Failed to get location' });
  }
});

// GET /api/tracking/:loadId/history — breadcrumb trail for route replay
// Query: ?limit (default 200, max 2000), ?from, ?to (ISO dates)
// Returns points sorted recordedAt ascending so the client can draw the path.
router.get('/:loadId/history', auth, async (req, res) => {
  try {
    const load = await Load.findById(req.params.loadId).select('postedBy acceptedBy');
    if (!load) return res.status(404).json({ error: 'Load not found' });

    const userId = String(req.user.companyOwnerId || req.user.userId);
    const allowed = userId === String(load.postedBy) || userId === String(load.acceptedBy) || req.user.role === 'admin';
    if (!allowed) return res.status(403).json({ error: 'Not authorized' });

    // limit: default 200, clamp to [1, 2000]
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 200;
    if (limit > 2000) limit = 2000;

    // Time-window filter on recordedAt
    const recordedAt = {};
    if (req.query.from) {
      const from = new Date(req.query.from);
      if (!isNaN(from.getTime())) recordedAt.$gte = from;
    }
    if (req.query.to) {
      const to = new Date(req.query.to);
      if (!isNaN(to.getTime())) recordedAt.$lte = to;
    }

    const query = { load: load._id };
    if (Object.keys(recordedAt).length) query.recordedAt = recordedAt;

    // Pull the most recent `limit` events, then return ascending for replay.
    const events = await TrackingEvent.find(query)
      .sort({ recordedAt: -1 })
      .limit(limit)
      .lean();

    const points = events
      .reverse()
      .map((e) => ({
        lat: e.latitude != null ? e.latitude : e.lat,
        lng: e.longitude != null ? e.longitude : e.lng,
        speed: e.speed != null ? e.speed : null,
        heading: e.heading != null ? e.heading : null,
        source: e.source || null,
        at: e.recordedAt,
      }));

    res.json({ loadId: String(load._id), points });
  } catch (err) {
    console.error('Tracking history error:', err);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

// GET /api/tracking/:loadId/eta — remaining distance + ETA to destination
// Haversine straight-line distance (miles) from current carrierLocation to
// the load destination. Speed basis: current GPS speed if moving (> 5 km/h),
// else a 50 mph highway average.
router.get('/:loadId/eta', auth, async (req, res) => {
  try {
    const load = await Load.findById(req.params.loadId)
      .select('carrierLocation destination destinationLat destinationLng postedBy acceptedBy');
    if (!load) return res.status(404).json({ error: 'Load not found' });

    const userId = String(req.user.companyOwnerId || req.user.userId);
    const allowed = userId === String(load.postedBy) || userId === String(load.acceptedBy) || req.user.role === 'admin';
    if (!allowed) return res.status(403).json({ error: 'Not authorized' });

    const loc = load.carrierLocation;
    if (!loc || loc.latitude == null || loc.longitude == null) {
      return res.json({ etaHours: null, message: 'No location yet' });
    }

    if (load.destinationLat == null || load.destinationLng == null) {
      return res.json({ etaHours: null, message: 'Destination not geocoded' });
    }

    const distanceRemainingMiles = haversineMiles(
      loc.latitude,
      loc.longitude,
      load.destinationLat,
      load.destinationLng
    );

    // carrierLocation.speed is km/h. Use it only when genuinely moving.
    let mph = 50;
    let basis = 'avg_50mph';
    if (loc.speed != null && loc.speed > 5) {
      mph = loc.speed * 0.621371; // km/h → mph
      basis = 'current_speed';
    }

    const etaHours = mph > 0 ? distanceRemainingMiles / mph : null;
    const etaAt = etaHours != null ? new Date(Date.now() + etaHours * 3600 * 1000) : null;

    res.json({
      distanceRemainingMiles: Math.round(distanceRemainingMiles * 10) / 10,
      etaHours: etaHours != null ? Math.round(etaHours * 100) / 100 : null,
      etaAt,
      basis,
    });
  } catch (err) {
    console.error('Tracking ETA error:', err);
    res.status(500).json({ error: 'Failed to compute ETA' });
  }
});

module.exports = router;
