/**
 * tripChainPlanner.js -- PURE "truck autopilot" chain planner (no DB, no clock: `now` is passed in).
 *
 * Given where/when a truck is free, its hours-of-service clock and a pool of open loads, it finds the most
 * profitable chains (up to `maxLoads`) that are FEASIBLE: every pickup/delivery window is met on a simulated
 * timeline that obeys the 11h drive / 14h window / 30-min break / 70h cycle rules. When something is unknown
 * it says so in `warnings` instead of guessing optimistically. All money is integer cents.
 *
 * Every distance is an estimate: deadhead is always straight-line x ROAD_FACTOR; a loaded leg uses the stored road
 * `distanceMiles` when present, else straight-line x ROAD_FACTOR. Planning speed is one conservative constant.
 */
const { haversineMiles } = require('../utils/geo');
const { estimateEconomics } = require('../utils/loadEconomics');
const { CONSTANTS: PICKUP_CONSTANTS } = require('./pickupRiskService');
const { LIMITS } = require('./hosRules');

const ROAD_FACTOR = PICKUP_CONSTANTS.ROAD_FACTOR;      // same road factor as pickup-risk
const PLANNING_MPH = 50;                                // ONE conservative average speed for every leg
const DWELL_MIN = 120;                                  // loading and unloading time, each
const BREAK_MIN = 30;
const RESET_MIN = 600;                                  // 10h off-duty reset
const DEFAULT_MAX_DEADHEAD_MILES = 150;                 // per leg, when the rule is absent
const NO_PICKUP_END_GRACE_MIN = 240;                    // no pickup window end => latest arrival = window start + 4h
const BRANCH_CAP = 15;                                  // feasible options explored per step
// ponytail: depth-first with at most BRANCH_CAP feasible branches per step (15^3 = 3375 chains at maxLoads 3), best-first
// by all-in $/mile. It is a heuristic, not an optimum: a great chain whose first leg ranks below 15 others is not seen.
// Upgrade path: beam search over (time, location) states or an exact DP if pools grow beyond a few hundred loads.
const MIN_MS = 60000;

const toMs = (d) => {
  const t = d == null ? NaN : new Date(d).getTime();
  return Number.isFinite(t) ? t : null;
};
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const iso = (ms) => new Date(ms).toISOString();
const round1 = (n) => Math.round(n * 10) / 10;
const driveMinutes = (miles) => Math.ceil((miles / PLANNING_MPH) * 60);
const sameEquip = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// ── HOS timeline state ───────────────────────────────────────────────────────
function cloneState(s) { return { ...s, rests: s.rests.slice() }; }

function addRest(s, type, minutes) {
  s.rests.push({ type, at: iso(s.t), minutes });
  s.t += minutes * MIN_MS;
}

/** Drive `minutes`, inserting 30-min breaks and 10h resets. Returns false if the 70h cycle would be exceeded. */
function drive(s, minutes) {
  let left = minutes;
  while (left > 0) {
    if (s.cycleLeft <= 0) return false; // no 34h restart modelled: the chain is infeasible
    if (s.driveLeft <= 0 || s.windowLeft <= 0) {
      addRest(s, 'reset', RESET_MIN);
      s.driveLeft = LIMITS.DRIVING_MIN; s.windowLeft = LIMITS.ONDUTY_MIN; s.sinceBreak = 0;
      continue;
    }
    if (s.sinceBreak >= LIMITS.BREAK_AFTER_MIN) {
      addRest(s, 'break', BREAK_MIN);
      s.windowLeft = Math.max(0, s.windowLeft - BREAK_MIN); // the 14h window keeps running during a break
      s.sinceBreak = 0;
      continue;
    }
    const step = Math.min(left, s.driveLeft, s.windowLeft, s.cycleLeft, LIMITS.BREAK_AFTER_MIN - s.sinceBreak);
    s.t += step * MIN_MS;
    s.driveLeft -= step; s.windowLeft -= step; s.cycleLeft -= step; s.sinceBreak += step;
    left -= step;
  }
  return true;
}

/** On duty, not driving (dock dwell/waiting): burns the 14h window and the cycle. >=10h idle is treated as an off-duty reset. */
function idle(s, minutes) {
  if (minutes <= 0) return true;
  if (minutes >= RESET_MIN) {
    s.rests.push({ type: 'reset', at: iso(s.t), minutes });
    s.t += minutes * MIN_MS;
    s.driveLeft = LIMITS.DRIVING_MIN; s.windowLeft = LIMITS.ONDUTY_MIN; s.sinceBreak = 0;
    return true;
  }
  s.t += minutes * MIN_MS;
  s.windowLeft = Math.max(0, s.windowLeft - minutes); // on duty past the window is allowed; driving is not
  s.cycleLeft -= minutes;
  if (minutes >= BREAK_MIN) s.sinceBreak = 0;         // 30+ min non-driving satisfies the break rule (395.3(a)(3)(ii))
  return s.cycleLeft >= 0;
}

// ── One leg: deadhead -> wait -> load -> loaded drive -> wait -> unload ───────
function simulateLeg(s0, c) {
  const s = cloneState(s0);
  const restFrom = s.rests.length;
  const deadheadMiles = haversineMiles(s.lat, s.lng, c.originLat, c.originLng) * ROAD_FACTOR;
  const dhMin = driveMinutes(deadheadMiles);
  const departAt = s.t;

  if (!drive(s, dhMin)) return { reason: 'hos' };
  const arrivePickupAt = s.t;
  if (arrivePickupAt > c.pickupLatest) {
    // Late only because of rest rules => 'hos'; late even driving non-stop => the window itself can't be met.
    return { reason: departAt + dhMin * MIN_MS <= c.pickupLatest ? 'hos' : 'windowCantBeMet' };
  }
  if (c.pickupStart != null && s.t < c.pickupStart && !idle(s, Math.ceil((c.pickupStart - s.t) / MIN_MS))) return { reason: 'hos' };
  if (!idle(s, DWELL_MIN)) return { reason: 'hos' };
  const departPickupAt = s.t;

  const loadedMin = driveMinutes(c.loadedMiles);
  if (!drive(s, loadedMin)) return { reason: 'hos' };
  const arriveDeliveryAt = s.t;
  if (c.deliveryEnd != null && arriveDeliveryAt > c.deliveryEnd) {
    return { reason: departPickupAt + loadedMin * MIN_MS <= c.deliveryEnd ? 'hos' : 'windowCantBeMet' };
  }
  if (c.deliveryStart != null && s.t < c.deliveryStart && !idle(s, Math.ceil((c.deliveryStart - s.t) / MIN_MS))) return { reason: 'hos' };
  if (!idle(s, DWELL_MIN)) return { reason: 'hos' };

  s.lat = c.destinationLat; s.lng = c.destinationLng;
  return {
    state: s,
    leg: {
      loadId: c.id,
      deadheadMiles: round1(deadheadMiles),
      loadedMiles: round1(c.loadedMiles),
      departAt: iso(departAt),
      arrivePickupAt: iso(arrivePickupAt),
      departPickupAt: iso(departPickupAt),
      arriveDeliveryAt: iso(arriveDeliveryAt),
      doneAt: iso(s.t),
      rateCents: c.rateCents,
      restStops: s.rests.slice(restFrom),
      milesAreEstimated: !c.roadMiles,
    },
    deadheadRaw: deadheadMiles,
  };
}

// ── Candidate preparation (static filters) ───────────────────────────────────
function prepare(raw, rules, excluded) {
  const out = [];
  const eq = Array.isArray(rules.equipmentTypes) ? rules.equipmentTypes.filter(Boolean) : [];
  for (const l of raw || []) {
    const coords = [l.originLat, l.originLng, l.destinationLat, l.destinationLng];
    if (!coords.every(isNum)) { excluded.noCoordinates++; continue; }
    const ps = toMs(l.pickupWindow && l.pickupWindow.start);
    const pe = toMs(l.pickupWindow && l.pickupWindow.end);
    if (ps == null && pe == null) { excluded.noWindow++; continue; }
    if (!Number.isInteger(l.rateCents) || l.rateCents <= 0) { excluded.noRate++; continue; }
    if (eq.length && !eq.some((e) => sameEquip(e, l.equipmentType))) { excluded.wrongEquipment++; continue; }
    if (isNum(rules.maxWeightLbs) && isNum(l.loadWeight) && l.loadWeight > rules.maxWeightLbs) { excluded.overweight++; continue; }
    if (l.hazardousMaterial && !rules.allowHazmat) { excluded.hazmat++; continue; }
    const roadMiles = isNum(l.distanceMiles) && l.distanceMiles > 0;
    const straight = haversineMiles(l.originLat, l.originLng, l.destinationLat, l.destinationLng);
    out.push({
      id: String(l.id), originLat: l.originLat, originLng: l.originLng,
      destinationLat: l.destinationLat, destinationLng: l.destinationLng,
      rateCents: l.rateCents, roadMiles,
      loadedMiles: roadMiles ? l.distanceMiles : straight * ROAD_FACTOR,
      pickupStart: ps,
      pickupLatest: pe != null ? pe : ps + NO_PICKUP_END_GRACE_MIN * MIN_MS,
      deliveryStart: toMs(l.deliveryWindow && l.deliveryWindow.start),
      deliveryEnd: toMs(l.deliveryWindow && l.deliveryWindow.end),
    });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────
function planChains({ start, hos = null, rules = {}, candidates = [], now, maxLoads = 3, maxPlans = 3 } = {}) {
  const nowMs = toMs(now);
  if (nowMs == null) throw new Error('planChains requires `now`');
  if (!start || !isNum(start.lat) || !isNum(start.lng)) throw new Error('planChains requires start.lat/lng');
  rules = rules || {};
  const depthMax = Math.max(1, Math.min(3, Math.floor(maxLoads) || 3));
  const startMs = Math.max(nowMs, toMs(start.availableAt) ?? nowMs);

  const hosKnown = !!hos && [hos.driveMinLeft, hos.dutyWindowMinLeft, hos.cycleMinLeft, hos.minSinceLastBreak].every(isNum);
  const state0 = {
    t: startMs, lat: start.lat, lng: start.lng, rests: [],
    driveLeft: hosKnown ? hos.driveMinLeft : LIMITS.DRIVING_MIN,
    windowLeft: hosKnown ? hos.dutyWindowMinLeft : LIMITS.ONDUTY_MIN,
    cycleLeft: hosKnown ? hos.cycleMinLeft : LIMITS.CYCLE_MIN,
    sinceBreak: hosKnown ? hos.minSinceLastBreak : 0,
  };

  const excluded = {
    tooFar: 0, wrongEquipment: 0, windowCantBeMet: 0, noWindow: 0, belowMinRate: 0, hos: 0,
    noCoordinates: 0, noRate: 0, overweight: 0, hazmat: 0, unprofitable: 0, homeBy: 0,
  };
  const pool = prepare(candidates, rules, excluded);

  const maxDeadhead = isNum(rules.maxDeadheadMiles) ? rules.maxDeadheadMiles : DEFAULT_MAX_DEADHEAD_MILES;
  const minRpm = isNum(rules.minRatePerMileCents) ? rules.minRatePerMileCents : null;
  const costPerMile = Number.isInteger(rules.costPerMileCents) && rules.costPerMileCents > 0 ? rules.costPerMileCents : null;
  const homeBase = rules.homeBase && isNum(rules.homeBase.lat) && isNum(rules.homeBase.lng) ? rules.homeBase : null;
  const homeByMs = toMs(rules.homeBy);
  const homeActive = homeByMs != null && homeBase != null;

  const found = [];
  const record = (chain, state) => {
    let home = null;
    if (homeActive) {
      const miles = haversineMiles(state.lat, state.lng, homeBase.lat, homeBase.lng) * ROAD_FACTOR;
      const hs = cloneState(state);
      if (!drive(hs, driveMinutes(miles)) || hs.t > homeByMs) { excluded.homeBy++; return; }
      home = { miles, arriveAt: iso(hs.t) };
    }
    found.push(buildPlan(chain, state, home));
  };

  const dfs = (state, chain, used, depth) => {
    const options = [];
    for (const c of pool) {
      if (used.has(c.id)) continue;
      const dh = haversineMiles(state.lat, state.lng, c.originLat, c.originLng) * ROAD_FACTOR;
      if (dh > maxDeadhead) { if (depth === 0) excluded.tooFar++; continue; }
      const allIn = dh + c.loadedMiles;
      const rpm = allIn > 0 ? c.rateCents / allIn : 0;
      if (minRpm != null && rpm < minRpm) { if (depth === 0) excluded.belowMinRate++; continue; }
      options.push({ c, rpm });
    }
    options.sort((a, b) => b.rpm - a.rpm || (a.c.id < b.c.id ? -1 : 1));
    let taken = 0;
    for (const { c } of options) {
      if (taken >= BRANCH_CAP) break;
      const res = simulateLeg(state, c);
      if (res.reason) { if (depth === 0) excluded[res.reason]++; continue; }
      taken++;
      const nextChain = chain.concat([{ leg: res.leg, deadheadRaw: res.deadheadRaw, loadedRaw: c.loadedMiles, est: !c.roadMiles }]);
      record(nextChain, res.state);
      if (depth + 1 < depthMax) dfs(res.state, nextChain, new Set([...used, c.id]), depth + 1);
    }
  };

  function buildPlan(chain, state, home) {
    const legs = chain.map((x) => x.leg);
    const revenueCents = legs.reduce((a, l) => a + l.rateCents, 0);
    const loaded = chain.reduce((a, x) => a + x.loadedRaw, 0);
    const deadhead = chain.reduce((a, x) => a + x.deadheadRaw, 0) + (home ? home.miles : 0);
    const totalMiles = loaded + deadhead;
    // Money is only costed when cost/mile is known (estimateEconomics returns null otherwise -- never a made-up cost).
    const econ = costPerMile ? estimateEconomics({ rateCents: revenueCents, tripMiles: loaded, deadheadMiles: deadhead, costPerMileCents: costPerMile }) : null;
    const ratePerMileCents = Math.round(revenueCents / totalMiles);
    const warnings = [];
    if (!hosKnown) warnings.push('Hours-of-service clock unknown -- assumed a fresh 11/14-hour day and a full 70-hour cycle');
    warnings.push('Deadhead distances are straight-line estimates x ' + ROAD_FACTOR + (chain.some((x) => x.est) ? '; loads without a stored road distance are too' : ''));
    warnings.push(`Assumes ${PLANNING_MPH} mph average and ${DWELL_MIN / 60} hours each for loading and unloading`);
    if (costPerMile == null) warnings.push('Cost per mile is not set -- estimated net profit is not shown');
    if (!(Array.isArray(rules.equipmentTypes) && rules.equipmentTypes.length)) warnings.push('No equipment type set -- loads of any equipment type were considered');
    if (!isNum(rules.maxDeadheadMiles)) warnings.push(`No empty-miles limit set -- using ${DEFAULT_MAX_DEADHEAD_MILES} miles per leg`);
    if (homeByMs != null && !homeBase) warnings.push('"Be home by" was ignored because no home base is set');
    return {
      loadIds: legs.map((l) => l.loadId),
      legs,
      totals: {
        revenueCents,
        totalMiles: round1(totalMiles),
        loadedMiles: round1(loaded),
        deadheadMiles: round1(deadhead),
        deadheadPct: totalMiles > 0 ? round1((deadhead / totalMiles) * 100) : 0,
        ratePerMileCents,
        costCents: econ ? econ.costCents : null,
        netCents: econ ? econ.profitCents : null,
      },
      endsAt: legs[legs.length - 1].doneAt,
      endLocation: { lat: state.lat, lng: state.lng },
      returnHome: home ? { miles: round1(home.miles), arriveAt: home.arriveAt } : null,
      hosAssumed: !hosKnown,
      warnings,
    };
  }

  dfs(state0, [], new Set(), 0);

  // Ranking: with a known cost, by estimated net profit (what the carrier keeps). Without one, by all-in $/mile x total
  // revenue -- rate alone would favour tiny high-rate hops, revenue alone would favour long low-rate chains; the product
  // rewards both. A longer chain only outranks a shorter one when it scores strictly higher (ties -> fewer legs, then ids).
  const score = (p) => (p.totals.netCents != null ? p.totals.netCents : p.totals.ratePerMileCents * p.totals.revenueCents);
  const viable = found.filter((p) => {
    if (p.totals.netCents != null && p.totals.netCents <= 0) { excluded.unprofitable++; return false; }
    return true;
  });
  viable.sort((a, b) => score(b) - score(a) || a.legs.length - b.legs.length || (a.loadIds.join() < b.loadIds.join() ? -1 : 1));

  return {
    plans: viable.slice(0, Math.max(1, maxPlans)),
    excluded,
    considered: (candidates || []).length,
    assumptions: { planningMph: PLANNING_MPH, roadFactor: ROAD_FACTOR, dwellMinutes: DWELL_MIN, maxDeadheadMiles: maxDeadhead },
  };
}

module.exports = { planChains, PLANNING_MPH, DWELL_MIN, ROAD_FACTOR, DEFAULT_MAX_DEADHEAD_MILES };
