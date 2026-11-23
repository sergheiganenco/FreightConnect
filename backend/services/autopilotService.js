/**
 * autopilotService.js -- gathers the inputs for tripChainPlanner (truck, start, HOS, rules, visible loads) and runs it.
 * Read-only: it never books anything. Booking stays on PUT /loads/:id/accept so every existing gate applies.
 */
const User = require('../models/User');
const Load = require('../models/Load');
const ELDLog = require('../models/ELDLog');
const { haversineMiles, boundingBox } = require('../utils/geo');
const { carrierOpenVisibleConditions } = require('./loadVisibility');
const { checkLoadEligibility } = require('./loadEligibility');
const { PUBLIC_PARTY_SELECT } = require('./trustScoreService');
const { computeShiftStatus, sumOnDutyMinutes, LIMITS } = require('./hosRules');
const { planChains, ROAD_FACTOR, PLANNING_MPH, DWELL_MIN } = require('./tripChainPlanner');

const MIN_MS = 60000;
const HOUR_MS = 3600000;
const CANDIDATE_RADIUS_MILES = 400;
const CANDIDATE_LIMIT = 300;
const LOCATION_FRESH_MS = 12 * HOUR_MS;   // a stored truck position older than this is not trusted
const ELD_FRESH_MS = 24 * HOUR_MS;        // ELD logs older than this say nothing about the clock right now
const HOS_PROJECTION_LIMIT_MS = HOUR_MS;  // a start further out than this can't use today's clock
const NOT_AVAILABLE_STATUSES = ['Maintenance', 'Offline', 'Unavailable'];

class AutopilotError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const norm = (s) => String(s || '').trim().toLowerCase();
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ── Truck + driver resolution ────────────────────────────────────────────────
// Honest limits of the data model: roster drivers (User.drivers[]) are NOT linked to login accounts by id. A truck's
// driver is found via roster.assignedTruckId (or truck.driverName); a driver's LOGIN is matched to that person by NAME
// (case-insensitive, and only if exactly one active driver sub-account carries it). Anything ambiguous => unknown.
function driverForTruck(owner, truck) {
  const roster = owner.drivers || [];
  return roster.find((d) => d.assignedTruckId === truck.truckId && d.status !== 'inactive')
    || (truck.driverName ? roster.find((d) => norm(d.name) === norm(truck.driverName)) : null)
    || null;
}

async function assertTruckAccess({ owner, truck, caller }) {
  if (caller.companyRole !== 'driver') return;
  const me = await User.findById(caller.userId).select('name').lean();
  const mine = driverForTruck(owner, truck);
  const myName = norm(me && me.name);
  if (!myName || !mine || norm(mine.name) !== myName) {
    throw new AutopilotError(403, 'Drivers can only view a plan for the truck assigned to them');
  }
}

async function driverLoginId(owner, driver) {
  const companyId = owner._id;
  if (driver) {
    const logins = await User.find({
      parentAccountId: companyId, companyRole: 'driver', active: { $ne: false },
    }).select('name').lean();
    const hits = logins.filter((u) => norm(u.name) === norm(driver.name));
    return hits.length === 1 ? hits[0]._id : null;
  }
  // No driver assigned: an owner-operator with a single truck drives it themselves, so their own log applies.
  return (owner.fleet || []).length === 1 ? companyId : null;
}

// ── Hours of service from ELD logs (null => unknown) ─────────────────────────
// Logs are keyed per logged-in PERSON (ELDLog.carrier), so this is only as good as the login match above.
async function hosFromEld(loginId, now) {
  if (!loginId) return null;
  const from = new Date(now.getTime() - 7 * 24 * HOUR_MS).toISOString().slice(0, 10);
  const logs = await ELDLog.find({ carrier: loginId, date: { $gte: from } }).select('date events totals').lean();
  const events = logs.flatMap((l) => l.events || []).filter((e) => e && e.startTime);
  if (!events.length) return null;

  const nowMs = now.getTime();
  const endOf = (e) => (e.endTime ? new Date(e.endTime).getTime() : nowMs);
  const lastTouch = Math.max(...events.map(endOf));
  if (nowMs - lastTouch > ELD_FRESH_MS) return null;

  // Cycle: stored day totals + the still-open event (day totals only update on a status change).
  let cycleUsed = sumOnDutyMinutes(logs);
  for (const e of events) {
    if (!e.endTime && (e.status === 'DRIVING' || e.status === 'ON_DUTY_NOT_DRIVING')) {
      cycleUsed += Math.max(0, Math.round((nowMs - new Date(e.startTime).getTime()) / MIN_MS));
    }
  }
  const cycleMinLeft = Math.max(0, LIMITS.CYCLE_MIN - cycleUsed);

  // 10h+ off duty since the last on-duty time => a fresh shift is available.
  const onDutyEnds = events.filter((e) => e.status === 'DRIVING' || e.status === 'ON_DUTY_NOT_DRIVING').map(endOf);
  const restedMin = onDutyEnds.length ? (nowMs - Math.max(...onDutyEnds)) / MIN_MS : Infinity;
  if (restedMin >= 600) {
    return { driveMinLeft: LIMITS.DRIVING_MIN, dutyWindowMinLeft: LIMITS.ONDUTY_MIN, cycleMinLeft, minSinceLastBreak: 0 };
  }
  const shift = computeShiftStatus(events, now);
  return {
    driveMinLeft: shift.driveRemaining,
    dutyWindowMinLeft: shift.windowRemaining,
    cycleMinLeft,
    minSinceLastBreak: shift.breakDriveMinutes,
  };
}

// ── Where/when is the truck free? ────────────────────────────────────────────
function bookedFreeAt(l, now) {
  const end = l.deliveryTimeWindow && l.deliveryTimeWindow.end ? new Date(l.deliveryTimeWindow.end).getTime() : null;
  if (end != null) return { at: Math.max(end, now.getTime()), assumed: false };
  // No delivery window: estimate from the pickup window + drive + both dwells, never earlier than now.
  const pickup = l.pickupTimeWindow && (l.pickupTimeWindow.end || l.pickupTimeWindow.start);
  if (!pickup) return null;
  const miles = num(l.distanceMiles) > 0 ? l.distanceMiles
    : haversineMiles(l.originLat, l.originLng, l.destinationLat, l.destinationLng) * ROAD_FACTOR;
  const at = new Date(pickup).getTime() + (2 * DWELL_MIN + (miles / PLANNING_MPH) * 60) * MIN_MS;
  return { at: Math.max(at, now.getTime()), assumed: true };
}

async function resolveStart({ owner, truck, companyId, overrides, now, notes }) {
  const booked = await Load.find({
    acceptedBy: companyId, assignedTruckId: truck.truckId, status: { $in: ['accepted', 'in-transit'] },
  }).select('title destination destinationLat destinationLng originLat originLng distanceMiles pickupTimeWindow deliveryTimeWindow').lean();

  if (booked.length) {
    let last = null;
    for (const l of booked) {
      if (!Number.isFinite(l.destinationLat) || !Number.isFinite(l.destinationLng)) continue;
      const f = bookedFreeAt(l, now);
      if (!f) throw new AutopilotError(422, `Booked load "${l.title}" has no pickup or delivery window, so we cannot tell when this truck is free`);
      if (!last || f.at > last.f.at) last = { l, f };
    }
    if (last) {
      notes.push(`Truck is booked until "${last.l.title}" is delivered; plan starts at its destination${last.f.assumed ? ' (delivery time estimated: no delivery window)' : ' at the end of its delivery window'}.`);
      return { lat: last.l.destinationLat, lng: last.l.destinationLng, availableAt: new Date(last.f.at), source: 'booked_load' };
    }
  }

  if (truck.available === false || NOT_AVAILABLE_STATUSES.includes(truck.status)) {
    throw new AutopilotError(409, `Truck ${truck.truckId} is marked ${truck.available === false && !NOT_AVAILABLE_STATUSES.includes(truck.status) ? 'unavailable' : truck.status}`);
  }
  const loc = truck.location;
  if (loc && num(loc.latitude) != null && num(loc.longitude) != null && loc.updatedAt
      && now.getTime() - new Date(loc.updatedAt).getTime() <= LOCATION_FRESH_MS) {
    return { lat: loc.latitude, lng: loc.longitude, availableAt: now, source: 'truck_location' };
  }
  const hb = owner.preferences && owner.preferences.homeBase;
  if (hb && num(hb.latitude) != null && num(hb.longitude) != null) {
    return { lat: hb.latitude, lng: hb.longitude, availableAt: now, source: 'home_base' };
  }
  if (overrides.lat != null && overrides.lng != null) {
    return { lat: overrides.lat, lng: overrides.lng, availableAt: now, source: 'request' };
  }
  throw new AutopilotError(400, 'A starting location is needed: the truck has no recent location and no home base is set. Pass lat and lng or set a home base.');
}

// ── Rules ────────────────────────────────────────────────────────────────────
function effectiveRules({ owner, driver, overrides, now, notes, driverCaller }) {
  const p = owner.preferences || {};
  const a = p.autopilot || {};
  const pick = (override, saved) => (override != null ? override : (saved != null ? saved : undefined));
  const hb = p.homeBase;

  let homeBy = overrides.homeBy != null ? overrides.homeBy : a.homeBy;
  if (homeBy && new Date(homeBy).getTime() <= now.getTime()) {
    notes.push('The "be home by" time is in the past, so it was ignored.');
    homeBy = undefined;
  }
  const hazmatValid = !!(driver && (driver.endorsements || []).includes('hazmat')
    && driver.hazmatExpiry && new Date(driver.hazmatExpiry).getTime() > now.getTime());

  return {
    equipmentTypes: p.equipmentTypes || [],
    minRatePerMileCents: pick(overrides.minRatePerMileCents, a.minRatePerMileCents),
    maxDeadheadMiles: pick(overrides.maxDeadheadMiles, a.maxDeadheadMiles),
    maxWeightLbs: a.maxWeightLbs != null ? a.maxWeightLbs : undefined,
    allowHazmat: !!a.allowHazmat && hazmatValid,
    // Cost per mile is owner/dispatcher data: a driver's plan is ranked without it and shows no cost or net.
    costPerMileCents: !driverCaller && Number.isInteger(p.costPerMileCents) ? p.costPerMileCents : undefined,
    homeBase: hb && num(hb.latitude) != null && num(hb.longitude) != null ? { lat: hb.latitude, lng: hb.longitude } : undefined,
    homeBy: homeBy ? new Date(homeBy) : undefined,
    _hazmatSaved: !!a.allowHazmat, _hazmatValid: hazmatValid,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function planForTruck({ companyId, caller, truckId, overrides = {}, now = new Date() }) {
  const owner = await User.findById(companyId)
    .select('fleet drivers preferences carrierEndorsements verification.status active').lean();
  const truck = owner && (owner.fleet || []).find((t) => t.truckId === truckId);
  if (!owner || !truck) throw new AutopilotError(404, 'Truck not found');
  await assertTruckAccess({ owner, truck, caller });

  const vstatus = owner.verification && owner.verification.status;
  if (owner.active === false || vstatus === 'suspended' || vstatus === 'rejected') {
    throw new AutopilotError(403, 'This carrier account cannot book loads right now');
  }

  const notes = [];
  if (vstatus !== 'verified') notes.push('Your carrier account is not verified yet; booking will be refused until verification completes.');
  const driver = driverForTruck(owner, truck);
  const start = await resolveStart({ owner, truck, companyId, overrides, now, notes });
  const rules = effectiveRules({ owner, driver, overrides, now, notes, driverCaller: caller.companyRole === 'driver' });
  if (rules._hazmatSaved && !rules._hazmatValid) notes.push('Hazmat loads are excluded: the assigned driver has no current hazmat endorsement on file.');

  // HOS: only meaningful for "now"; a start further out (truck still on a booked load) can't use today's clock.
  let hos = null;
  if (start.availableAt.getTime() - now.getTime() <= HOS_PROJECTION_LIMIT_MS) {
    hos = await hosFromEld(await driverLoginId({ ...owner, _id: companyId }, driver), now);
    if (!hos) notes.push('No recent ELD log found for this truck\'s driver, so hours of service are assumed fresh.');
  } else {
    notes.push('The truck is busy until later, so hours of service after that are assumed fresh.');
  }

  // Candidates: same visibility as the board / return loads. A private or preferred load this carrier may not see never appears.
  const box = boundingBox(start.lat, start.lng, CANDIDATE_RADIUS_MILES);
  const earliestStart = new Date(now.getTime() - 4 * HOUR_MS);
  const visible = { $or: await carrierOpenVisibleConditions(companyId) };
  const base = {
    status: 'open',
    postedBy: { $ne: companyId },
    originLat: { $gte: box.latMin, $lte: box.latMax },
    originLng: { $gte: box.lngMin, $lte: box.lngMax },
  };
  const docs = await Load.find({
    ...base,
    $and: [visible, { $or: [
      { 'pickupTimeWindow.end': { $gte: now } },
      { 'pickupTimeWindow.end': null, 'pickupTimeWindow.start': { $gte: earliestStart } },
    ] }],
  })
    .select('title origin originLat originLng destination destinationLat destinationLng distanceMiles rate rateCents equipmentType loadWeight hazardousMaterial requiredEndorsements commodityType pickupTimeWindow deliveryTimeWindow termsVersion postedBy')
    .sort({ 'pickupTimeWindow.start': 1, _id: 1 })
    .limit(CANDIDATE_LIMIT)
    .lean();
  // Loads with no pickup window at all can't be auto-planned; count them (not fetch them) so the UI can say so.
  const noWindow = await Load.countDocuments({
    ...base, $and: [visible, { 'pickupTimeWindow.end': null, 'pickupTimeWindow.start': null }],
  });

  let ineligible = 0;
  const byId = new Map();
  const candidates = [];
  for (const l of docs) {
    if (!checkLoadEligibility({ load: l, carrier: owner, driver }).eligible) { ineligible++; continue; }
    byId.set(String(l._id), l);
    candidates.push({
      id: String(l._id),
      originLat: l.originLat, originLng: l.originLng, destinationLat: l.destinationLat, destinationLng: l.destinationLng,
      distanceMiles: l.distanceMiles,
      rateCents: Number.isInteger(l.rateCents) ? l.rateCents : (Number.isFinite(l.rate) ? Math.round(l.rate * 100) : null),
      equipmentType: l.equipmentType, loadWeight: l.loadWeight, hazardousMaterial: !!l.hazardousMaterial,
      pickupWindow: l.pickupTimeWindow, deliveryWindow: l.deliveryTimeWindow,
    });
  }

  const { _hazmatSaved, _hazmatValid, ...plannerRules } = rules;
  const result = planChains({
    start: { lat: start.lat, lng: start.lng, availableAt: start.availableAt },
    hos, rules: plannerRules, candidates, now,
    maxLoads: overrides.maxLoads || 3,
  });
  result.excluded.ineligible = ineligible;
  result.excluded.noWindow += noWindow;

  // Public load summary per leg (what the board already shows) + the public party fields only.
  const posterIds = [...new Set(result.plans.flatMap((p) => p.loadIds).map((id) => String(byId.get(id).postedBy)))];
  const posters = posterIds.length ? await User.find({ _id: { $in: posterIds } }).select(PUBLIC_PARTY_SELECT).lean() : [];
  const posterMap = new Map(posters.map((u) => [String(u._id), u]));
  for (const plan of result.plans) {
    for (const leg of plan.legs) {
      const l = byId.get(leg.loadId);
      leg.load = {
        _id: l._id, title: l.title, origin: l.origin, destination: l.destination,
        originLat: l.originLat, originLng: l.originLng, destinationLat: l.destinationLat, destinationLng: l.destinationLng,
        equipmentType: l.equipmentType, loadWeight: l.loadWeight, commodityType: l.commodityType,
        hazardousMaterial: !!l.hazardousMaterial,
        pickupTimeWindow: l.pickupTimeWindow, deliveryTimeWindow: l.deliveryTimeWindow,
        rateCents: leg.rateCents, termsVersion: l.termsVersion || 1,
        postedBy: posterMap.get(String(l.postedBy)) || null,
      };
    }
  }

  return {
    truck: { truckId: truck.truckId, driverName: (driver && driver.name) || truck.driverName || null },
    start: { lat: start.lat, lng: start.lng, availableAt: start.availableAt.toISOString() },
    startSource: start.source,
    hosAssumed: !hos,
    rules: { ...plannerRules, homeBase: plannerRules.homeBase || null, homeBy: plannerRules.homeBy ? plannerRules.homeBy.toISOString() : null },
    notes,
    ...result,
  };
}

// Saved defaults + the inputs that complete them (read-only view for the rules form).
async function getRules(companyId) {
  const owner = await User.findById(companyId).select('preferences').lean();
  const p = (owner && owner.preferences) || {};
  const a = p.autopilot || {};
  return {
    minRatePerMileCents: a.minRatePerMileCents ?? null,
    maxDeadheadMiles: a.maxDeadheadMiles ?? null,
    maxWeightLbs: a.maxWeightLbs ?? null,
    allowHazmat: !!a.allowHazmat,
    homeBy: a.homeBy || null,
    costPerMileCents: Number.isInteger(p.costPerMileCents) ? p.costPerMileCents : null,
    homeBase: p.homeBase && p.homeBase.latitude != null ? { city: p.homeBase.city, state: p.homeBase.state } : null,
    equipmentTypes: p.equipmentTypes || [],
  };
}

module.exports = { planForTruck, getRules, AutopilotError };
