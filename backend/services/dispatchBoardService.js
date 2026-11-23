/**
 * dispatchBoardService.js -- one-screen fleet view for dispatchers. Read-only aggregation.
 *
 * Cost is constant in fleet size: ONE read of the owner doc, ONE query for the company's active loads, everything else
 * is in-memory. HOS is intentionally NOT included: the fleet HOS summary (eldRoutes GET /fleet) is built per ELD log and
 * keyed to login accounts, so showing it per truck would need a per-driver query loop.
 */
const User = require('../models/User');
const Load = require('../models/Load');
const { CONSTANTS: RISK } = require('./pickupRiskService');
const { CONSTANTS: CHECK } = require('./checkCallService');
const { haversineMiles, travelMs } = require('./delayService');
const { driverForTruck, NOT_AVAILABLE_STATUSES } = require('./autopilotService');

const MIN = 60000;
const LOAD_CAP = 2000;
const UNASSIGNED_CAP = 50;
const RISKY_LEVELS = ['at_risk', 'late_certain', 'no_show']; // the levels jobs/pickupRiskMonitor notifies on
const STATES = ['needs_attention', 'in_transit', 'booked', 'idle', 'out_of_service'];
const STATE_RANK = Object.fromEntries(STATES.map((s, i) => [s, i]));

const LOAD_SELECT = 'title origin destination status assignedTruckId pickupTimeWindow deliveryTimeWindow bookedWindow '
  + 'destinationLat destinationLng pickupRisk.level pickupRisk.reason pickupRisk.detail pickupRisk.carrierConfirmation.status '
  + 'carrierLocation checkCallState.ask';

const ms = (d) => { const t = d ? new Date(d).getTime() : NaN; return Number.isFinite(t) ? t : null; };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const ageText = (min) => (min >= 120 ? `${Math.round(min / 60)} h` : `${min} min`);
const day = (d) => new Date(d).toISOString().slice(0, 10);

// When this load needs the truck next: delivery deadline once rolling, else pickup deadline (window end, else start).
function nextEvent(l) {
  if (l.status === 'in-transit') {
    const t = ms(l.deliveryTimeWindow && (l.deliveryTimeWindow.end || l.deliveryTimeWindow.start));
    return { type: 'delivery', at: t };
  }
  const w = l.bookedWindow && (l.bookedWindow.end || l.bookedWindow.start) ? l.bookedWindow : l.pickupTimeWindow;
  return { type: 'pickup', at: ms(w && (w.end || w.start)) };
}

// Newest position we hold for a truck: the load's live fix (any source / last authenticated) or the truck's own.
function positionOf(truck, load, nowMs) {
  const cl = (load && load.carrierLocation) || {};
  const auth = cl.lastAuthenticated || {};
  const authAt = isNum(auth.latitude) ? ms(auth.updatedAt) : null;
  const anyAt = isNum(cl.latitude) ? ms(cl.updatedAt) : null;
  const tl = truck.location || {};
  const truckAt = isNum(tl.latitude) ? ms(tl.updatedAt) : null;
  const newest = Math.max(authAt ?? -Infinity, anyAt ?? -Infinity, truckAt ?? -Infinity);
  if (!Number.isFinite(newest)) return null;
  return {
    ageMinutes: Math.max(0, Math.round((nowMs - newest) / MIN)),
    confirmed: authAt != null && nowMs - authAt <= RISK.FRESH_LOCATION_MS,
    _fix: anyAt != null && anyAt >= (authAt ?? -Infinity) ? cl : (authAt != null ? auth : null),
  };
}

function pickupReason(l) {
  const r = l.pickupRisk || {};
  const d = r.detail || {};
  if (r.level === 'no_show') return `Pickup missed: no arrival recorded for "${l.title}"`;
  if (r.level === 'late_certain') return `Pickup late: at least ${d.minutesLateAtLeast || 1} min behind for "${l.title}"`;
  if (r.reason === 'carrier_declined' || (r.carrierConfirmation && r.carrierConfirmation.status === 'cannot_make_it')) {
    return `Driver said they cannot make pickup for "${l.title}"`;
  }
  if (r.reason === 'no_gps') return `Pickup at risk: no GPS position for "${l.title}"`;
  if (d.minutesLateEstimate > 0) return `Pickup at risk: ${d.minutesLateEstimate} min late by current position`;
  return `Pickup at risk for "${l.title}"`;
}

/**
 * PURE: one truck's board row from already-loaded data. `loads` = this truck's accepted/in-transit loads.
 * Priority: needs_attention > in_transit > booked > idle; an unusable truck with no loads is out_of_service.
 */
function deriveTruckRow({ truck, driver, loads, now }) {
  const nowMs = now.getTime();
  const sorted = [...loads].sort((a, b) => (nextEvent(a).at ?? Infinity) - (nextEvent(b).at ?? Infinity));
  const current = sorted.find((l) => l.status === 'in-transit') || sorted[0] || null;
  const outOfService = truck.available === false || NOT_AVAILABLE_STATUSES.includes(truck.status);
  const pos = positionOf(truck, current, nowMs);
  const reasons = [];

  if (outOfService && current) reasons.push(`Truck is marked ${truck.available === false && !NOT_AVAILABLE_STATUSES.includes(truck.status) ? 'unavailable' : truck.status} but has a booked load`);

  for (const l of sorted) {
    if (l.status === 'accepted' && l.pickupRisk && RISKY_LEVELS.includes(l.pickupRisk.level)) reasons.push(pickupReason(l));
    else if (l.status === 'accepted') {
      // Independent of the risk monitor: a booked load still not picked up after its agreed latest pickup time.
      const w = (l.bookedWindow && l.bookedWindow.start ? l.bookedWindow : l.pickupTimeWindow) || {};
      const latest = ms(w.end) ?? ms(w.start);
      if (latest != null && latest < nowMs) reasons.push(`Pickup deadline passed ${ageText(Math.round((nowMs - latest) / MIN))} ago and the load is not picked up`);
    }
    const ask = l.checkCallState && l.checkCallState.ask;
    const askedAt = ms(ask && ask.askedAt);
    if (askedAt != null && nowMs - askedAt <= CHECK.PICKUP_LOOKBACK_MS && !(ms(ask.answeredAt) >= askedAt)) {
      reasons.push('Driver has not answered a check call');
    }
  }

  if (current && current.status === 'in-transit') {
    const fix = pos && pos._fix;
    if (!pos || pos.ageMinutes * MIN > RISK.STALE_LOCATION_MS) {
      reasons.push(pos ? `No position for ${ageText(pos.ageMinutes)}` : 'No position received');
    } else if (fix && isNum(fix.latitude) && isNum(fix.longitude) && isNum(current.destinationLat) && isNum(current.destinationLng)) {
      const due = ms(current.deliveryTimeWindow && current.deliveryTimeWindow.end);
      if (due != null) {
        const miles = haversineMiles(fix.latitude, fix.longitude, current.destinationLat, current.destinationLng);
        const late = Math.round((nowMs + travelMs(miles, isNum(fix.speed) ? fix.speed : null) - due) / MIN);
        if (late > 0) reasons.push(`Running late: about ${late} min past the delivery window by current position`);
      }
    }
  }

  // Expired documents matter when the truck is working or about to (not while it is parked out of service).
  if (driver && driver.status !== 'inactive' && !(outOfService && !current)) {
    if (ms(driver.licenseExpiry) != null && ms(driver.licenseExpiry) < nowMs) reasons.push(`License expired ${day(driver.licenseExpiry)}`);
    if (ms(driver.medicalCardExpiry) != null && ms(driver.medicalCardExpiry) < nowMs) reasons.push(`Medical card expired ${day(driver.medicalCardExpiry)}`);
  }

  let state;
  if (reasons.length) state = 'needs_attention';
  else if (current && current.status === 'in-transit') state = 'in_transit';
  else if (current) state = 'booked';
  else if (outOfService) state = 'out_of_service';
  else state = 'idle';

  const ev = current ? nextEvent(current) : null;
  return {
    truckId: truck.truckId,
    driverName: (driver && driver.name) || truck.driverName || null,
    truckStatus: truck.status || 'Available',
    state,
    reasons,
    currentLoad: current ? {
      _id: String(current._id), title: current.title, origin: current.origin, destination: current.destination,
      status: current.status,
      nextEvent: ev.at != null ? { type: ev.type, at: new Date(ev.at).toISOString() } : null,
    } : null,
    nextLoads: Math.max(0, sorted.length - 1),
    position: pos ? { ageMinutes: pos.ageMinutes, confirmed: pos.confirmed } : null,
  };
}

const sortKey = (r) => (r.currentLoad && r.currentLoad.nextEvent ? Date.parse(r.currentLoad.nextEvent.at) : Infinity);
const compareRows = (a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || sortKey(a) - sortKey(b)
  || (a.truckId < b.truckId ? -1 : a.truckId > b.truckId ? 1 : 0);

// PURE: in-memory text filter (never reaches Mongo).
function matchesSearch(row, q) {
  const c = row.currentLoad || {};
  return [row.truckId, row.driverName, c.title, c.origin, c.destination].some((v) => v && String(v).toLowerCase().includes(q));
}

async function buildBoard({ companyId, now = new Date(), filter, search, page = 1, pageSize = 25 }) {
  const [owner, loads] = await Promise.all([
    User.findById(companyId).select('fleet drivers preferences.homeBase').lean(),
    Load.find({ acceptedBy: companyId, status: { $in: ['accepted', 'in-transit'] } })
      .select(LOAD_SELECT).sort({ 'pickupTimeWindow.start': 1, _id: 1 }).limit(LOAD_CAP + 1).lean(),
  ]);
  const truncated = loads.length > LOAD_CAP;
  if (truncated) loads.length = LOAD_CAP;

  const fleet = (owner && owner.fleet) || [];
  const byTruck = new Map();
  const known = new Set(fleet.map((t) => t.truckId));
  const unassigned = [];
  for (const l of loads) {
    if (l.assignedTruckId && known.has(l.assignedTruckId)) {
      if (!byTruck.has(l.assignedTruckId)) byTruck.set(l.assignedTruckId, []);
      byTruck.get(l.assignedTruckId).push(l);
    } else unassigned.push(l);
  }

  const rows = fleet.map((t) => deriveTruckRow({ truck: t, driver: driverForTruck(owner, t), loads: byTruck.get(t.truckId) || [], now }));
  const summary = Object.fromEntries(STATES.map((s) => [s, 0]));
  for (const r of rows) summary[r.state]++;
  summary.unassigned = unassigned.length;

  const q = search ? search.trim().toLowerCase() : '';
  const shown = rows.filter((r) => (!filter || r.state === filter) && (!q || matchesSearch(r, q))).sort(compareRows);
  const start = (page - 1) * pageSize;

  unassigned.sort((a, b) => (nextEvent(a).at ?? Infinity) - (nextEvent(b).at ?? Infinity));
  return {
    generatedAt: now.toISOString(),
    summary,
    totalTrucks: rows.length,
    trucks: shown.slice(start, start + pageSize),
    page, pageSize, totalRows: shown.length, totalPages: Math.max(1, Math.ceil(shown.length / pageSize)),
    unassigned: {
      total: unassigned.length,
      loads: unassigned.slice(0, UNASSIGNED_CAP).map((l) => {
        const ev = nextEvent(l);
        return {
          _id: String(l._id), title: l.title, origin: l.origin, destination: l.destination, status: l.status,
          nextEvent: ev.at != null ? { type: ev.type, at: new Date(ev.at).toISOString() } : null,
        };
      }),
    },
    truncated,
    hosIncluded: false,
  };
}

module.exports = { buildBoard, deriveTruckRow, matchesSearch, STATES, LOAD_CAP };
