/**
 * trackingService.js — Unified location ingest core
 *
 * Single chokepoint for EVERY location ping regardless of origin (browser
 * socket, mobile app, ELD webhook/poll, OwnTracks/Traccar, generic API).
 * Centralizing here guarantees all ingest paths get identical behavior:
 *   1. validate coordinates
 *   2. update Load.carrierLocation (the live "latest point")
 *   3. append a durable TrackingEvent breadcrumb (skipping near-duplicate
 *      "parked truck" pings to bound history volume)
 *   4. run the unified geofence/dwell auto check-in/out
 *   5. emit 'carrierLocationUpdate' to the shipper + carrier rooms
 *
 * This mirrors EXACTLY what the legacy app.js 'updateCarrierLocation' socket
 * handler did, so that handler can delegate here without behavior drift.
 *
 * Contract:
 *   recordLocation({ loadId, latitude, longitude, speed, heading, accuracy, source })
 *     -> { ok: boolean, code?: number, error?: string }
 *   Never throws to the caller.
 */

const Load          = require('../models/Load');
const TrackingEvent = require('../models/TrackingEvent');
const { getIO }     = require('../utils/socket');

// ── Tuning ───────────────────────────────────────────────────────────────────
// ~0.0003 deg latitude ≈ 33m. If a ping is inside this box of the last stored
// point AND the last point is recent, treat it as a stationary/parked duplicate
// and skip the breadcrumb (still update the live point + geofence + emit).
const DEDUPE_DEGREES_DELTA = 0.0003;
// ...unless the previous point is older than this, in which case we always store
// a breadcrumb so a parked truck still leaves an occasional heartbeat trail.
const HEARTBEAT_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

// Load.carrierLocation has a narrower enum than TrackingEvent. Map any source
// the Load sub-doc doesn't recognize to 'api' for the live point write, while
// keeping the original (richer) source on the durable breadcrumb.
const LOAD_LOCATION_SOURCES = new Set(['browser', 'mobile_app', 'eld', 'api']);

/**
 * Decide whether this point is materially different from the last stored point
 * (or whether enough time elapsed to warrant a heartbeat breadcrumb).
 */
function shouldStoreBreadcrumb(prev, latitude, longitude) {
  // No prior point at all → always store the first breadcrumb.
  if (!prev || prev.latitude == null || prev.longitude == null) return true;

  const movedFar =
    Math.abs(latitude - prev.latitude) >= DEDUPE_DEGREES_DELTA ||
    Math.abs(longitude - prev.longitude) >= DEDUPE_DEGREES_DELTA;

  if (movedFar) return true;

  // Essentially the same spot — only store if the last point is stale enough
  // to deserve a heartbeat.
  const prevTs = prev.updatedAt ? new Date(prev.updatedAt).getTime() : 0;
  if (!prevTs) return true; // unknown age → be safe and store
  return Date.now() - prevTs >= HEARTBEAT_MAX_AGE_MS;
}

/**
 * Ingest a single location ping.
 *
 * @param {Object}  args
 * @param {string}  args.loadId
 * @param {number}  args.latitude
 * @param {number}  args.longitude
 * @param {number}  [args.speed=null]    km/h
 * @param {number}  [args.heading=null]  degrees 0-360
 * @param {number}  [args.accuracy=null] meters
 * @param {string}  [args.source='api']
 * @returns {Promise<{ ok: boolean, code?: number, error?: string }>}
 */
async function recordLocation({
  loadId,
  latitude,
  longitude,
  speed = null,
  heading = null,
  accuracy = null,
  source = 'api',
} = {}) {
  try {
    // ── 1. Validate coordinates ───────────────────────────────────────────────
    if (!loadId) {
      return { ok: false, code: 400, error: 'loadId is required' };
    }

    const lat = Number(latitude);
    const lng = Number(longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { ok: false, code: 400, error: 'latitude and longitude must be numbers' };
    }
    if (lat < -90 || lat > 90) {
      return { ok: false, code: 400, error: 'latitude out of range [-90, 90]' };
    }
    if (lng < -180 || lng > 180) {
      return { ok: false, code: 400, error: 'longitude out of range [-180, 180]' };
    }

    // Normalize optional telemetry to numbers-or-null.
    const speedN    = speed    == null || speed    === '' ? null : Number(speed);
    const headingN  = heading  == null || heading  === '' ? null : Number(heading);
    const accuracyN = accuracy == null || accuracy === '' ? null : Number(accuracy);

    const safeSpeed    = Number.isFinite(speedN)    ? speedN    : null;
    const safeHeading  = Number.isFinite(headingN)  ? headingN  : null;
    const safeAccuracy = Number.isFinite(accuracyN) ? accuracyN : null;

    const breadcrumbSource = source || 'api';
    const liveSource = LOAD_LOCATION_SOURCES.has(breadcrumbSource)
      ? breadcrumbSource
      : 'api';

    // ── 2. Find Load (lightweight projection) ─────────────────────────────────
    let load;
    try {
      load = await Load.findById(loadId).select('postedBy acceptedBy carrierLocation status');
    } catch (findErr) {
      // Bad ObjectId / cast error → treat as not found rather than 500.
      return { ok: false, code: 404, error: 'Load not found' };
    }
    if (!load) {
      return { ok: false, code: 404, error: 'Load not found' };
    }

    const prev = load.carrierLocation || null;
    const now = new Date();

    // ── 3. Decide whether to append a breadcrumb (before mutating prev) ────────
    const storeBreadcrumb = shouldStoreBreadcrumb(prev, lat, lng);

    // ── 4. ALWAYS update the live "latest point" on the Load ──────────────────
    const liveLocation = {
      latitude:  lat,
      longitude: lng,
      speed:     safeSpeed,
      heading:   safeHeading,
      accuracy:  safeAccuracy,
      source:    liveSource,
      updatedAt: now,
    };
    // Use a targeted update (no full-doc validation, mirrors app.js behavior).
    await Load.updateOne({ _id: load._id }, { $set: { carrierLocation: liveLocation } });

    // ── 5. Append durable breadcrumb (non-fatal on failure) ───────────────────
    if (storeBreadcrumb) {
      try {
        await TrackingEvent.create({
          load:       load._id,
          carrier:    load.acceptedBy || null,
          latitude:   lat,
          longitude:  lng,
          speed:      safeSpeed,
          heading:    safeHeading,
          accuracy:   safeAccuracy,
          source:     breadcrumbSource,
          recordedAt: now,
        });
      } catch (historyErr) {
        // History must never break the live update.
        console.error('[trackingService] breadcrumb insert failed (non-fatal):', historyErr.message);
      }
    }

    // ── 6. Unified geofence/dwell check (mirrors app.js call exactly) ──────────
    // app.js calls: checkGeofence(carrierId, latitude, longitude). The carrier
    // here is load.acceptedBy.
    if (load.acceptedBy) {
      try {
        const { checkGeofence } = require('./geofenceService');
        await checkGeofence(load.acceptedBy, lat, lng);
      } catch (geoErr) {
        // Non-fatal — dwell tracking is secondary to location updates.
        if (geoErr && geoErr.message !== 'Cannot read properties of undefined') {
          console.error('[trackingService] geofence check failed (non-fatal):', geoErr.message);
        }
      }
    }

    // ── 6b. Predictive delivery-delay alert (non-fatal) ───────────────────────
    try {
      const { checkPredictedDelay } = require('./delayService');
      await checkPredictedDelay({ loadId: load._id, latitude: lat, longitude: lng, speed: safeSpeed });
    } catch (delayErr) {
      console.error('[trackingService] delay check failed (non-fatal):', delayErr.message);
    }

    // ── 7. Emit real-time update to shipper + carrier rooms ───────────────────
    try {
      const io = getIO();
      if (io) {
        const payload = {
          loadId:    String(load._id),
          latitude:  lat,
          longitude: lng,
          speed:     safeSpeed,
          heading:   safeHeading,
          accuracy:  safeAccuracy,
          source:    breadcrumbSource,
          updatedAt: now,
        };
        if (load.postedBy)   io.to(`user_${load.postedBy}`).emit('carrierLocationUpdate', payload);
        if (load.acceptedBy) io.to(`user_${load.acceptedBy}`).emit('carrierLocationUpdate', payload);
      }
    } catch (emitErr) {
      console.error('[trackingService] socket emit failed (non-fatal):', emitErr.message);
    }

    return { ok: true };
  } catch (err) {
    // Absolute backstop — never throw to the caller.
    console.error('[trackingService] recordLocation failed:', err && err.message);
    return { ok: false, code: 500, error: 'Failed to record location' };
  }
}

module.exports = { recordLocation };
