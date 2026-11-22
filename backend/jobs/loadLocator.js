/**
 * Load Locator
 *
 * Runs every 10 minutes. Loads posted while the geocoder was down (or outside a bulk request's time budget) are saved
 * without coordinates and hidden from carriers (services/loadVisibility). This fills them in through the same geocoder
 * the posting path uses, then stores road miles. Open loads only, created in the last 14 days, max 20 a run (at most 5 per
 * shipper, picked round-robin from the 200 best candidates so one tenant cannot starve the rest), one shared geocode
 * budget (~25 s, 1.1 s spacing) per run.
 *
 * - found: coordinates set with a targeted updateOne guarded on status 'open' and the coordinate still missing.
 * - not found (geocoder answered, no match): Load.locationProblem is set (so it is not retried) and the shipper is
 *   notified once. A shipper cannot edit origin/destination on an open load, so the message says cancel and re-post.
 * - outage (429/5xx/network): the attempt is counted and the load backs off min(10 min x 2^attempts, 6 h); after 8 failed
 *   attempts it gets locationProblem (reason 'unreachable') and the shipper is notified, so nothing is retried forever.
 * - budget spent before the load was reached: not an attempt; it stays eligible.
 * Never throws; one summary line per run, nothing logged when there was nothing to do.
 */
const cron = require('node-cron');
const Load = require('../models/Load');
const { geocode, makeGeocodeBudget } = require('../services/loadPostingService');
const { loadDistanceFields } = require('../services/routingService');
const { notifyUserSafe } = require('../utils/notifyUser');

const MAX_PER_RUN = 20;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const BUDGET_MS = 25000;
const MAX_PER_SHIPPER = 5;
const CANDIDATES = 200;        // bound on documents read per run
const MAX_ATTEMPTS = 8;
const BACKOFF_BASE_MS = 10 * 60 * 1000;
const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;
const missing = { $not: { $type: 'number' } };
const coordsMissing = [{ originLat: missing }, { originLng: missing }, { destinationLat: missing }, { destinationLng: missing }];
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

// Marks the load (once) and tells the shipper. Returns true if this call set it.
async function flagProblem(load, field, reason, stats) {
  const place = load[field];
  const w = await Load.updateOne({ _id: load._id, status: 'open', 'locationProblem.at': { $exists: false } },
    { $set: { locationProblem: { field, place, reason, at: new Date() } } });
  if (!w.modifiedCount) return;
  const label = field === 'origin' ? 'pickup' : 'delivery';
  await notifyUserSafe(load.postedBy, {
    type: 'load:location_problem',
    title: 'We could not find a load location',
    body: `We couldn't find the ${label} location "${place}" for load "${load.title}". Carriers can't see this load until it is corrected. Cancel it and re-post it with the location as City, ST.`,
    link: '/dashboard/shipper/loads', metadata: { loadId: String(load._id), field },
  });
  stats.notFound++;
}

// The geocoder was tried and failed (outage): count it and back off; give up after MAX_ATTEMPTS.
async function recordFailure(load, field, stats) {
  const attempts = (load.locationAttempts || 0) + 1;
  if (attempts >= MAX_ATTEMPTS) return flagProblem(load, field, 'unreachable', stats);
  const nextAt = new Date(Date.now() + Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_MAX_MS));
  await Load.updateOne({ _id: load._id, status: 'open', $or: coordsMissing },
    { $set: { locationAttempts: attempts, locationNextAttemptAt: nextAt } });
}

// At most `perShipper` per postedBy, round-robin across shippers (candidates arrive in priority order), `max` overall.
function pickFairly(candidates, max, perShipper) {
  const queues = new Map();
  for (const c of candidates) {
    const k = String(c.postedBy);
    if (!queues.has(k)) queues.set(k, []);
    if (queues.get(k).length < perShipper) queues.get(k).push(c);
  }
  const out = [];
  for (let round = 0; out.length < max; round++) {
    let any = false;
    for (const q of queues.values()) {
      if (round < q.length && out.length < max) { out.push(q[round]); any = true; }
    }
    if (!any) break;
  }
  return out;
}

async function locateOne(load, budget, stats) {
  let failedField = null;
  const set = {};
  const guard = {};
  for (const [field, place, latK, lngK] of [
    ['origin', load.origin, 'originLat', 'originLng'], ['destination', load.destination, 'destinationLat', 'destinationLng'],
  ]) {
    if (isNum(load[latK]) && isNum(load[lngK])) continue;
    const r = await geocode(place, budget);
    if (r?.skipped) return 'budget';
    if (r?.notFound) {
      await flagProblem(load, field, 'not_found', stats);
      return 'notFound';
    }
    if (r && Number.isFinite(r.lat) && Number.isFinite(r.lng)) {
      set[latK] = r.lat; set[lngK] = r.lng; guard[latK] = missing;
    } else failedField = failedField || field;
  }
  if (!Object.keys(set).length) { await recordFailure(load, failedField || 'origin', stats); return 'retry'; }
  Object.assign(set, { locationAttempts: 0, locationNextAttemptAt: null });
  const w = await Load.updateOne({ _id: load._id, status: 'open', ...guard }, { $set: set });
  if (!w.modifiedCount) return 'skipped';
  const full = { ...load, ...set };
  if (['originLat', 'originLng', 'destinationLat', 'destinationLng'].every((k) => isNum(full[k]))) {
    const dist = await loadDistanceFields({ ...full, stops: load.stops });
    if (dist.distanceMiles != null) await Load.updateOne({ _id: load._id, status: 'open' }, { $set: dist });
  }
  stats.located++;
  return 'located';
}

async function runLoadLocator() {
  try {
    const now = new Date();
    // Ascending sort puts null/missing locationNextAttemptAt before any date in MongoDB, so never-attempted loads
    // come first (oldest first), then the ones whose back-off expired longest ago.
    const candidates = await Load.find({
      status: 'open',
      createdAt: { $gte: new Date(now.getTime() - MAX_AGE_MS) },
      'locationProblem.at': { $exists: false },
      $and: [{ $or: coordsMissing }, { $or: [{ locationNextAttemptAt: null }, { locationNextAttemptAt: { $lte: now } }] }],
    }).sort({ locationNextAttemptAt: 1, createdAt: 1 }).limit(CANDIDATES).lean();
    const loads = pickFairly(candidates, MAX_PER_RUN, MAX_PER_SHIPPER);
    if (!loads.length) return;
    const budget = makeGeocodeBudget(BUDGET_MS);
    const stats = { located: 0, notFound: 0 };
    for (const load of loads) {
      try {
        if (await locateOne(load, budget, stats) === 'budget') break;
      } catch (e) {
        console.error(`[LoadLocator] Failed for load ${load._id}:`, e.message);
      }
    }
    console.log(`[LoadLocator] ${loads.length} checked, ${stats.located} located, ${stats.notFound} not found.`);
  } catch (err) {
    console.error('[LoadLocator] Fatal:', err.message);
  }
}

function start() {
  cron.schedule('*/10 * * * *', runLoadLocator);
  console.log('[LoadLocator] Scheduled — runs every 10 min');
}

module.exports = { start, runLoadLocator };
