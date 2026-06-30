/**
 * trackingIngestRoutes — receive background GPS from FREE third-party tracker apps
 * (OwnTracks, Traccar Client) so iPhone carriers can stream location with the
 * screen off, at no cost, without a custom iOS build.
 *
 * These ingest endpoints are NOT JWT-authenticated (the tracker apps can't log in).
 * Instead each load has a stateless per-load token (HMAC of the loadId) embedded in
 * the configured URL. Feeds the SAME carrierLocation + socket pipeline the app uses.
 *
 * Mounted at /api/tracking/ingest
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const auth = require('../middlewares/authMiddleware');
const Load = require('../models/Load');
const trackingService = require('../services/trackingService');

// ── Stateless per-load tracking token (HMAC of loadId with the server secret) ──
// The HMAC key MUST come from real configured secret material. There is NO
// hardcoded fallback: a guessable key would let anyone forge tokens and inject
// fake GPS via these unauthenticated ingest endpoints. Fails closed if unset.
function getTrackingSecret() {
  const secret = process.env.TRACKING_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('TRACKING_TOKEN_SECRET or JWT_SECRET must be configured for tracking ingest tokens');
  }
  return secret;
}

function tokenForLoad(loadId) {
  return crypto
    .createHmac('sha256', getTrackingSecret())
    .update(String(loadId))
    .digest('hex')
    .slice(0, 24);
}

function verifyToken(loadId, token) {
  if (!loadId || !token) return false;
  let expected;
  try {
    expected = tokenForLoad(loadId);
  } catch (_) {
    return false; // no secret configured → reject (fail closed), never accept
  }
  const a = Buffer.from(String(token));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Shared: delegate to trackingService (single source of truth) ──────────────
// Thin wrapper — carrierLocation write, breadcrumb, geofence check, and socket
// broadcast all live in services/trackingService.recordLocation. No duplicated
// write logic here; the ingest endpoints only verify the token and normalize the
// tracker-specific payload before handing off.
async function ingestLocation({ loadId, latitude, longitude, speed, heading, accuracy, source }) {
  return trackingService.recordLocation({
    loadId,
    latitude,
    longitude,
    speed: speed != null ? speed : null,
    heading: heading != null ? heading : null,
    accuracy: accuracy != null ? accuracy : null,
    source: source || 'external_tracker',
  });
}

// ── OwnTracks (HTTP mode) — POST JSON ─────────────────────────────────────────
// URL to configure in OwnTracks: /api/tracking/ingest/owntracks?loadId=<id>&token=<token>
// OwnTracks expects a (possibly empty) JSON array response.
router.post('/owntracks', async (req, res) => {
  try {
    const { loadId, token } = req.query;
    if (!verifyToken(loadId, token)) return res.status(401).json([]);

    const b = req.body || {};
    if (b._type && b._type !== 'location') return res.json([]); // ignore transition/etc.
    const lat = Number(b.lat);
    const lon = Number(b.lon);
    if (!isFinite(lat) || !isFinite(lon)) return res.json([]);

    await ingestLocation({
      loadId,
      latitude: lat,
      longitude: lon,
      speed: b.vel != null ? Number(b.vel) : null,    // OwnTracks: km/h
      heading: b.cog != null ? Number(b.cog) : null,   // course over ground
      accuracy: b.acc != null ? Number(b.acc) : null,  // meters
      source: 'owntracks',
    });
    res.json([]);
  } catch (err) {
    console.error('[ingest/owntracks]', err.message);
    res.status(200).json([]); // never make the tracker retry-storm
  }
});

// ── Traccar Client / OsmAnd protocol — GET query params ───────────────────────
// Server URL to configure in Traccar Client: /api/tracking/ingest/osmand?loadId=<id>&token=<token>
// Traccar appends &lat=..&lon=..&speed=..&bearing=..&accuracy=..&timestamp=..
router.get('/osmand', async (req, res) => {
  try {
    const q = req.query;
    const loadId = q.loadId;
    if (!verifyToken(loadId, q.token)) return res.status(401).send('unauthorized');

    const lat = Number(q.lat != null ? q.lat : q.latitude);
    const lon = Number(q.lon != null ? q.lon : q.longitude);
    if (!isFinite(lat) || !isFinite(lon)) return res.status(400).send('bad coords');

    let speed = q.speed != null ? Number(q.speed) : null;
    if (speed != null && isFinite(speed)) speed = Math.round(speed * 1.852); // knots → km/h
    const heading = (q.bearing != null ? q.bearing : q.heading);
    const accuracy = (q.accuracy != null ? q.accuracy : q.hdop);

    await ingestLocation({
      loadId,
      latitude: lat,
      longitude: lon,
      speed,
      heading: heading != null ? Number(heading) : null,
      accuracy: accuracy != null ? Number(accuracy) : null,
      source: 'traccar',
    });
    res.status(200).send('OK');
  } catch (err) {
    console.error('[ingest/osmand]', err.message);
    res.status(200).send('OK');
  }
});

// ── GET /link/:loadId — return the tracker config for a load (carrier/shipper/admin) ──
router.get('/link/:loadId', auth, async (req, res) => {
  try {
    const load = await Load.findById(req.params.loadId).select('postedBy acceptedBy title');
    if (!load) return res.status(404).json({ error: 'Load not found' });

    const uid = String(req.user.userId);
    const allowed =
      uid === String(load.postedBy) ||
      uid === String(load.acceptedBy) ||
      req.user.role === 'admin';
    if (!allowed) return res.status(403).json({ error: 'Not authorized' });

    // Prefer an explicit public base (tunnel / prod URL); fall back to the request host.
    const base = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const token = tokenForLoad(load._id);

    res.json({
      loadId: String(load._id),
      title: load.title,
      token,
      owntracksUrl: `${base}/api/tracking/ingest/owntracks?loadId=${load._id}&token=${token}`,
      traccarUrl: `${base}/api/tracking/ingest/osmand?loadId=${load._id}&token=${token}`,
      instructions: {
        owntracks: [
          'Install "OwnTracks" (free, App Store)',
          'Open it → Settings (i) → Mode: HTTP',
          'Paste the OwnTracks URL above into the URL field',
          'Set reporting Mode to "Move" for live updates (or "Significant" to save battery)',
          'Allow Location access: "Always"',
        ],
        traccar: [
          'Install "Traccar Client" (free, App Store)',
          'Paste the Traccar URL above into "Server URL"',
          'Device identifier: any value',
          'Frequency: 30 seconds',
          'Allow Location access: "Always", then toggle the service ON',
        ],
      },
    });
  } catch (err) {
    console.error('[ingest/link]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.tokenForLoad = tokenForLoad;
