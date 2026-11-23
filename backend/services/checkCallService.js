/**
 * checkCallService.js — pure "automatic check call" evaluator (no DB, no Date.now()).
 *
 * Replaces the dispatcher's phone call: for one booked load it decides what the shipper should be told NOW,
 * or null. Accuracy rule: a position is "confirmed" only when it is FRESH and AUTHENTICATED (Load.carrierLocation.
 * lastAuthenticated). Anything else is reported as unconfirmed / how old it is. An ETA is only ever computed from a
 * fresh confirmed position (the same maths as delayService); otherwise etaAt is null. A driver's own answer is
 * stored by the route as the DRIVER'S statement and never feeds this evaluator's position or ETA.
 *
 * Returns ONE result per call (priority order below); the job runs every 10 minutes so anything else due follows.
 * `state` tells the writer which idempotency fields to set: { addMilestones, touchPeriodic, ask }.
 */
const { haversineMiles } = require('../utils/geo');
const { travelMs } = require('./delayService');
const { CONSTANTS: { FRESH_LOCATION_MS, STALE_LOCATION_MS, WATCH_WINDOW_MS } } = require('./pickupRiskService');

const MIN = 60 * 1000;
const PERIODIC_MS = 4 * 60 * MIN;          // one position_update per this while in transit
const ASK_WINDOW_MS = 4 * 60 * MIN;        // at most one driver ask per this
const NO_RESPONSE_MS = 30 * MIN;           // an unanswered ask becomes no_response after this
const ONE_HOUR_OUT_MIN = 60;               // one_hour_out fires when the ETA is within this
const PICKUP_LOOKBACK_MS = 24 * 60 * MIN;  // accepted loads whose pickup start is further in the past are not asked about (same range as pickupRiskMonitor)

const CHECK_CALL_TYPES = ['en_route_to_pickup', 'at_pickup', 'departed_pickup', 'at_delivery', 'halfway', 'one_hour_out',
  'position_update', 'ask_driver', 'no_response', 'driver_update'];
const MILESTONES = ['en_route_to_pickup', 'at_pickup', 'departed_pickup', 'at_delivery', 'halfway', 'one_hour_out'];

const ms = (d) => { const t = d == null ? NaN : new Date(d).getTime(); return Number.isFinite(t) ? t : null; };
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const miles0 = (m) => Math.round(m);
const minutes = (x) => Math.round(x / MIN);
function ageText(min) {
  if (min < 90) return `${min} min`;
  const h = Math.round(min / 6) / 10; // one decimal hour
  return `${h} h`;
}
const etaText = (etaMs, nowMs) => { const m = Math.max(0, minutes(etaMs - nowMs)); return m < 90 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

/**
 * @param {{ load: object, now: Date, dwellEvents?: object[] }} args
 *   load: lean Load (status, acceptedBy, bookedAt, bookedWindow/pickupTimeWindow, originLat/Lng, destinationLat/Lng,
 *         destination, stops, carrierLocation, pickupRisk.carrierConfirmation, checkCallState)
 *   dwellEvents: DwellEvents for this load (any booking; filtered here to the current booking + carrier)
 */
function evaluateCheckCall({ load, now, dwellEvents = [] } = {}) {
  const nowMs = ms(now);
  if (!load || nowMs == null || !['accepted', 'in-transit'].includes(load.status) || !load.acceptedBy) return null;
  const inTransit = load.status === 'in-transit';
  const st = load.checkCallState || {};
  const done = new Set(st.milestones || []);
  const dest = load.destination || 'the destination';
  const multiStop = Array.isArray(load.stops) && load.stops.length > 0;

  // ── Position facts ────────────────────────────────────────────────────────
  const cl = load.carrierLocation || {};
  const auth = cl.lastAuthenticated || {};
  const authAt = ms(auth.updatedAt);
  const authOk = authAt != null && num(auth.latitude) != null && num(auth.longitude) != null;
  const anyAt = ms(cl.updatedAt);
  const anyOk = anyAt != null && num(cl.latitude) != null && num(cl.longitude) != null;
  const authAgeMs = authOk ? nowMs - authAt : null;
  const fresh = authOk && authAgeMs <= FRESH_LOCATION_MS;          // confirmed + current
  const newestAt = Math.max(authOk ? authAt : -Infinity, anyOk ? anyAt : -Infinity);
  const positionAgeMinutes = Number.isFinite(newestAt) ? minutes(nowMs - newestAt) : null;
  const newestIsUnauth = anyOk && (!authOk || anyAt > authAt) && cl.authenticated !== true;
  const dLat = num(load.destinationLat), dLng = num(load.destinationLng);
  const oLat = num(load.originLat), oLng = num(load.originLng);
  const milesToDest = fresh && dLat != null && dLng != null ? haversineMiles(auth.latitude, auth.longitude, dLat, dLng) : null;
  const milesToOrigin = fresh && oLat != null && oLng != null ? haversineMiles(auth.latitude, auth.longitude, oLat, oLng) : null;
  const etaMs = milesToDest != null ? nowMs + travelMs(milesToDest, num(auth.speed)) : null;
  const etaNote = '(estimate from straight-line distance and the last speed)';

  const result = (type, message, extra = {}) => ({
    type, message, driverPrompt: null, etaAt: null, distanceRemainingMiles: null,
    positionAgeMinutes, positionConfirmed: false, ...extra,
    state: { addMilestones: [], touchPeriodic: false, ask: null, ...(extra.state || {}) },
  });
  // A result built on a fresh confirmed position (resets the 4-hour periodic clock: the shipper has a current status).
  const confirmed = (type, message, extra = {}) => result(type, message, {
    positionConfirmed: true, ...extra,
    state: { addMilestones: [], ...(extra.state || {}), touchPeriodic: true },
  });

  // ── Dwell / geofence evidence for THIS booking and carrier ────────────────
  const bookedMs = ms(load.bookedAt);
  const mine = (dwellEvents || []).filter((e) => String(e.carrier) === String(load.acceptedBy) && !e.closedReason
    && ms(e.bookedAt) === bookedMs);
  const first = (stopType) => mine.find((e) => e.stopType === stopType && e.arrivedAt);
  const pu = multiStop ? null : first('pickup');
  const dl = multiStop ? null : first('delivery');
  const auto = (e, key) => e[key] === true && !e[key === 'arrivalAuthenticated' ? 'arrivalManualBy' : 'departureManualBy'];
  const evidence = (e, atKey, authKey) => {
    const confirmedEv = auto(e, authKey);
    return { positionConfirmed: confirmedEv, positionAgeMinutes: minutes(nowMs - ms(e[atKey])) };
  };
  const via = (ok) => (ok ? 'detected by GPS' : 'recorded by a check-in that GPS has not confirmed');

  // ── 1. Milestones (priority: latest stage first) ──────────────────────────
  if (inTransit && dl && !done.has('at_delivery')) {
    const ev = evidence(dl, 'arrivedAt', 'arrivalAuthenticated');
    return result('at_delivery', `The truck has arrived at ${dest} (${via(ev.positionConfirmed)}).`,
      { ...ev, state: { addMilestones: ['at_delivery', 'one_hour_out', 'halfway'], touchPeriodic: ev.positionConfirmed } });
  }
  if (inTransit && pu && pu.departedAt && !done.has('departed_pickup')) {
    const ev = evidence({ ...pu, departedAt: pu.departedAt }, 'departedAt', 'departureAuthenticated');
    return result('departed_pickup', `The truck has left pickup (${via(ev.positionConfirmed)}).`,
      { ...ev, state: { addMilestones: ['departed_pickup', 'at_pickup', 'en_route_to_pickup'], touchPeriodic: ev.positionConfirmed } });
  }
  if (inTransit && etaMs != null && !(dl) && !done.has('one_hour_out') && minutes(etaMs - nowMs) <= ONE_HOUR_OUT_MIN) {
    return confirmed('one_hour_out', `About an hour from ${dest}: ${miles0(milesToDest)} miles to go, arriving in about ${etaText(etaMs, nowMs)} ${etaNote}.`,
      { etaAt: new Date(etaMs), distanceRemainingMiles: miles0(milesToDest), state: { addMilestones: ['one_hour_out', 'halfway'] } });
  }
  if (inTransit && milesToDest != null && !done.has('halfway') && !multiStop && oLat != null && oLng != null) {
    const total = haversineMiles(oLat, oLng, dLat, dLng);
    if (total > 0 && milesToDest <= total / 2) {
      return confirmed('halfway', `About halfway: ${miles0(milesToDest)} miles from ${dest}, arriving in about ${etaText(etaMs, nowMs)} ${etaNote}.`,
        { etaAt: new Date(etaMs), distanceRemainingMiles: miles0(milesToDest), state: { addMilestones: ['halfway'] } });
    }
  }
  if (!inTransit && pu && !done.has('at_pickup')) {
    const ev = evidence(pu, 'arrivedAt', 'arrivalAuthenticated');
    return result('at_pickup', `The truck has arrived at pickup (${via(ev.positionConfirmed)}).`,
      { ...ev, state: { addMilestones: ['at_pickup', 'en_route_to_pickup'], touchPeriodic: ev.positionConfirmed } });
  }
  if (!inTransit && !pu && !done.has('en_route_to_pickup')) {
    const conf = load.pickupRisk && load.pickupRisk.carrierConfirmation;
    const liveFix = fresh && (bookedMs == null || authAt >= bookedMs);
    if (liveFix) {
      return confirmed('en_route_to_pickup',
        milesToOrigin != null
          ? `Live tracking has started. The truck's confirmed position is about ${miles0(milesToOrigin)} miles from pickup (${minutes(authAgeMs)} min old).`
          : 'Live tracking has started (confirmed position).',
        { distanceRemainingMiles: milesToOrigin != null ? miles0(milesToOrigin) : null, state: { addMilestones: ['en_route_to_pickup'] } });
    }
    if (conf && conf.status === 'on_my_way') {
      return result('en_route_to_pickup', 'The driver reports being on the way to pickup (driver-reported; not confirmed by GPS).',
        { state: { addMilestones: ['en_route_to_pickup'] } });
    }
  }

  // ── 2. Unknown position: ask the driver, then say plainly nobody answered ──
  const startMs = ms((load.bookedWindow && load.bookedWindow.start) || (load.pickupTimeWindow && load.pickupTimeWindow.start));
  const watching = inTransit || (startMs != null && startMs - nowMs <= WATCH_WINDOW_MS && nowMs - startMs <= PICKUP_LOOKBACK_MS);
  const onSite = inTransit ? !!dl : !!(pu && !pu.departedAt);
  const noPosition = !authOk || authAgeMs > STALE_LOCATION_MS;
  if (watching && !onSite && noPosition) {
    const ask = st.ask || {};
    const askedMs = ms(ask.askedAt);
    const answeredMs = ms(ask.answeredAt);
    const lastKnown = positionAgeMinutes == null
      ? 'No position has been received for this load'
      : newestIsUnauth
        ? `No confirmed position for ${ageText(minutes(authAgeMs != null ? authAgeMs : nowMs - newestAt))}; the latest fix (${ageText(positionAgeMinutes)} old) came from a tracker link and is unconfirmed`
        : `No position update for ${ageText(positionAgeMinutes)}`;
    if (askedMs == null || nowMs - askedMs >= ASK_WINDOW_MS) {
      return result('ask_driver', `${lastKnown}. The driver has been asked for a status update.`, {
        driverPrompt: inTransit ? 'Check call: where are you and are you on schedule? Tap to answer.' : 'Check call: are you on schedule for pickup? Tap to answer.',
        state: { ask: 'new' },
      });
    }
    const unanswered = answeredMs == null || answeredMs < askedMs;
    if (unanswered && !ms(ask.noResponseSentAt) && nowMs - askedMs >= NO_RESPONSE_MS) {
      const gap = positionAgeMinutes == null ? 'No position has been received for this load' : newestIsUnauth ? lastKnown : `No position update for ${ageText(positionAgeMinutes)}`;
      return result('no_response', `${gap} and the driver has not responded yet.`, { state: { ask: 'noResponse' } });
    }
    return null;
  }

  // ── 3. Periodic update (in transit, fresh confirmed position) ──────────────
  if (inTransit && fresh) {
    const lastP = ms(st.lastPeriodicAt);
    const anchor = lastP != null ? lastP : (pu && ms(pu.departedAt)) || null;
    if (anchor == null || nowMs - anchor >= PERIODIC_MS) {
      return confirmed('position_update',
        milesToDest != null
          ? `Confirmed position: about ${miles0(milesToDest)} miles from ${dest} (${minutes(authAgeMs)} min old), arriving in about ${etaText(etaMs, nowMs)} ${etaNote}.`
          : `Confirmed position received ${minutes(authAgeMs)} min ago.`,
        { etaAt: etaMs != null ? new Date(etaMs) : null, distanceRemainingMiles: milesToDest != null ? miles0(milesToDest) : null });
    }
  }
  return null;
}

module.exports = {
  evaluateCheckCall, CHECK_CALL_TYPES, MILESTONES,
  CONSTANTS: { PERIODIC_MS, ASK_WINDOW_MS, NO_RESPONSE_MS, ONE_HOUR_OUT_MIN, PICKUP_LOOKBACK_MS },
};
