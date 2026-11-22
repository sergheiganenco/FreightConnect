/**
 * pickupRiskService.js — pure pickup no-show / lateness evaluator (no DB access).
 *
 * Every number here is an ESTIMATE: distance is straight-line x a road factor and
 * speed is an assumption. Every `detail` carries the numbers used so UI/notification
 * text can say so honestly. Conservative by design: it only raises a flag from fresh
 * GPS evidence, or from the absence of ANY location very close to the pickup time.
 * `pickupStart`/`pickupEnd` must be the AGREED (booked) window. `lastLocation` is the latest fix of ANY kind (live
 * map, at_risk prompt); `lastAuthenticatedLocation` is the latest fix proven to come from the booked carrier and is
 * the ONLY input that can produce late_certain, so a later bearer-token ping can neither forge nor mask it.
 */
const { haversineMiles } = require('../utils/geo');

const MIN = 60 * 1000;
const WATCH_WINDOW_MS = 12 * 60 * MIN;   // ignore loads whose pickup start is further away than this
const FRESH_LOCATION_MS = 30 * MIN;      // a GPS fix newer than this counts as "current"
const STALE_LOCATION_MS = 2 * 60 * MIN;  // a fix older than this is treated like "no location"
const NO_GPS_ALERT_MS = 2 * 60 * MIN;    // "no GPS" only matters when pickup start is this close
const MARGIN_MS = 30 * MIN;              // safety margin subtracted from the time remaining
const NO_SHOW_GRACE_MS = 30 * MIN;       // grace after the latest arrival before calling a no-show
const FALLBACK_WINDOW_MS = 2 * 60 * MIN; // latest arrival = pickup start + this when no window end is set
const ROAD_FACTOR = 1.25;                // road miles ~= straight-line miles x this
const NORMAL_MPH = 45;                   // normal drive-time estimate speed
const FAST_MPH = 60;                     // "cannot possibly arrive" speed
// A pickup window set on a booked load must start at least this far out, and a shipper's pending proposal
// lapses after PROPOSAL_TTL_MS: nobody can be handed a window that is already (nearly) over.
const MIN_EDIT_LEAD_MS = 2 * 60 * MIN;
const PROPOSAL_TTL_MS = 24 * 60 * MIN;
const NEAR_PICKUP_MILES = 1;             // inside this we assume the geofence check-in is imminent, never alert

const validDate = (d) => {
  const t = d == null ? NaN : new Date(d).getTime();
  return Number.isFinite(t) ? t : null;
};
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const minutes = (ms) => Math.round(ms / MIN);

function evaluatePickupRisk({
  now = new Date(), pickupStart, pickupEnd, origin, lastLocation = null, lastAuthenticatedLocation = null,
  arrivedAtPickup = false, carrierConfirmation = null, status = 'accepted',
} = {}) {
  const nowMs = validDate(now);
  const startMs = validDate(pickupStart);
  const oLat = num(origin && origin.lat);
  const oLng = num(origin && origin.lng);
  if (startMs == null || oLat == null || oLng == null) return { level: 'not_evaluated', reason: 'missing_pickup_time_or_origin', detail: null };
  if (status !== 'accepted') return { level: 'on_track', reason: 'not_awaiting_pickup', detail: null };
  if (arrivedAtPickup) return { level: 'on_track', reason: 'arrived', detail: null };

  const endMs = validDate(pickupEnd);
  const latestMs = endMs != null && endMs >= startMs ? endMs : startMs + FALLBACK_WINDOW_MS;
  const remainingMs = latestMs - nowMs;
  const detail = {
    latestArrivalAt: new Date(latestMs).toISOString(),
    latestArrivalBasis: endMs != null && endMs >= startMs ? 'pickup window end' : 'pickup start + 2h (no window end set)',
    minutesRemaining: minutes(remainingMs),
    marginMinutes: minutes(MARGIN_MS),
  };

  // Late beyond grace and never arrived: needs no GPS at all.
  if (-remainingMs > NO_SHOW_GRACE_MS) {
    return { level: 'no_show', reason: 'no_arrival_after_window', detail: { ...detail, graceMinutes: minutes(NO_SHOW_GRACE_MS) } };
  }
  // The carrier's own "can't make it" holds at any time before pickup.
  if (carrierConfirmation === 'cannot_make_it') return { level: 'at_risk', reason: 'carrier_declined', detail };
  if (startMs - nowMs > WATCH_WINDOW_MS) return { level: 'on_track', reason: 'outside_watch_window', detail: null };

  // Straight-line distance, drive-time estimates and the detail block for one fix.
  const measure = (lat, lng, ageMs) => {
    const straight = haversineMiles(lat, lng, oLat, oLng);
    const road = straight * ROAD_FACTOR;
    const normalMs = (road / NORMAL_MPH) * 60 * MIN;
    const fastMs = (road / FAST_MPH) * 60 * MIN;
    return {
      straight, normalMs, fastMs,
      d: {
        ...detail,
        distanceBasis: 'estimated from straight-line distance x ' + ROAD_FACTOR,
        distanceMilesStraight: Math.round(straight * 10) / 10,
        distanceMilesRoadEstimate: Math.round(road * 10) / 10,
        assumedMph: NORMAL_MPH,
        driveMinutesEstimate: minutes(normalMs),
        locationAgeMinutes: minutes(ageMs),
      },
    };
  };

  // late_certain: a position-based verdict from the last AUTHENTICATED fix only, and only while it is fresh.
  const aAt = validDate(lastAuthenticatedLocation && lastAuthenticatedLocation.updatedAt);
  const aLat = num(lastAuthenticatedLocation && lastAuthenticatedLocation.lat);
  const aLng = num(lastAuthenticatedLocation && lastAuthenticatedLocation.lng);
  if (aAt != null && aLat != null && aLng != null && nowMs - aAt <= FRESH_LOCATION_MS) {
    const m = measure(aLat, aLng, nowMs - aAt);
    if (m.straight >= NEAR_PICKUP_MILES && m.fastMs > remainingMs) {
      return {
        level: 'late_certain', reason: 'cannot_arrive_in_time',
        detail: { ...m.d, fastestMph: FAST_MPH, minutesLateAtLeast: Math.max(1, minutes(m.fastMs - remainingMs)), minutesLateEstimate: Math.max(1, minutes(m.normalMs - remainingMs)) },
      };
    }
  }

  const locAt = validDate(lastLocation && lastLocation.updatedAt);
  const lLat = num(lastLocation && lastLocation.lat);
  const lLng = num(lastLocation && lastLocation.lng);
  const hasLoc = locAt != null && lLat != null && lLng != null;
  const ageMs = hasLoc ? nowMs - locAt : null;

  if (hasLoc && ageMs <= FRESH_LOCATION_MS) {
    const { straight, normalMs, fastMs, d } = measure(lLat, lLng, ageMs);
    if (straight < NEAR_PICKUP_MILES) return { level: 'on_track', reason: 'near_pickup', detail: d };
    if (normalMs > remainingMs - MARGIN_MS || fastMs > remainingMs) {
      return { level: 'at_risk', reason: 'drive_time_exceeds_time_remaining', detail: { ...d, minutesLateEstimate: Math.max(0, minutes(normalMs - remainingMs)) } };
    }
    return { level: 'on_track', reason: 'gps_on_track', detail: d };
  }

  const noRecentGps = !hasLoc || ageMs > STALE_LOCATION_MS;
  if (noRecentGps && startMs - nowMs <= NO_GPS_ALERT_MS && carrierConfirmation !== 'on_my_way') {
    return { level: 'at_risk', reason: 'no_gps', detail: { ...detail, locationAgeMinutes: hasLoc ? minutes(ageMs) : null } };
  }
  return { level: 'on_track', reason: noRecentGps ? 'no_gps_but_early_or_confirmed' : 'location_not_current', detail: null };
}

module.exports = {
  evaluatePickupRisk,
  RISK_LEVELS: ['not_evaluated', 'on_track', 'at_risk', 'late_certain', 'no_show'],
  CONSTANTS: { WATCH_WINDOW_MS, FRESH_LOCATION_MS, STALE_LOCATION_MS, NO_GPS_ALERT_MS, MARGIN_MS, NO_SHOW_GRACE_MS, FALLBACK_WINDOW_MS, ROAD_FACTOR, NORMAL_MPH, FAST_MPH, MIN_EDIT_LEAD_MS, PROPOSAL_TTL_MS },
};
