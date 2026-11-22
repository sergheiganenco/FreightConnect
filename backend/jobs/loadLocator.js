/**
 * Load Locator
 *
 * Runs every 10 minutes. Loads posted while the geocoder was down (or outside a bulk request's time budget) are saved
 * without coordinates and hidden from carriers (services/loadVisibility). This fills them in through the same geocoder
 * the posting path uses, then stores road miles. Open loads only, created in the last 14 days, max 20 a run, one shared
 * geocode budget (~25 s, 1.1 s spacing) per run. Fairness is applied in the database (see pickCandidates): at most 5 loads
 * per shipper BEFORE the global limit, shippers ranked by how long their longest-waiting load has been eligible.
 *
 * - found: coordinates set with a targeted updateOne guarded on status 'open' and the coordinate still missing.
 * - not found (geocoder answered, no match / refused the query string): Load.locationProblem is set (so it is not retried)
 *   and the shipper is notified once. The message tells the shipper to edit the load (PUT /loads/:id re-resolves the place
 *   and clears the flag). Safety valve: if MORE than half of the loads attempted in one run (and at least 3) come back not found, the
 *   run is suspect (a geocoder that started refusing everything): nothing is marked, each counts as a failed attempt with
 *   backoff, and one warning is logged; they can be marked on a later run when the pattern is not systemic.
 * - outage (401/403/408/429/5xx/network, anything that is not about the query string): the attempt is counted and the load backs off min(10 min x 2^attempts, 6 h); after 8 failed
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
const MAX_ATTEMPTS = 8;
const BACKOFF_BASE_MS = 10 * 60 * 1000;
const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;
const missing = { $not: { $type: 'number' } };
const coordsMissing = [{ originLat: missing }, { originLng: missing }, { destinationLat: missing }, { destinationLng: missing }];
const SUSPECT_MIN = 3;          // safety valve: at least this many not-found AND more than half of the attempted loads
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
    body: `We couldn't find the ${label} location "${place}" for load "${load.title}". Carriers can't see this load until it is corrected. Edit the load and correct the location as City, ST.`,
    // The shipper fixes it from the load's Edit screen (PUT /loads/:id), which clears this flag and looks the place up again.
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

// The per-shipper cap is applied in the database, before the global limit, so one shipper's backlog can never fill the window.
// eligibleAt = locationNextAttemptAt if set (back-off expiry) else createdAt, so waiting time decides, not novelty.
// Within a shipper: longest-eligible first (rank 1..5). Across shippers: round-robin by rank, shippers with the
// longest-waiting load first within a rank. Needs $setWindowFields ($documentNumber): MongoDB 5.0+ (tests run 8.2; Atlas 5.0+).
function pickCandidates(now) {
  return Load.aggregate([
    { $match: {
      status: 'open',
      createdAt: { $gte: new Date(now.getTime() - MAX_AGE_MS) },
      'locationProblem.at': { $exists: false },
      $and: [{ $or: coordsMissing }, { $or: [{ locationNextAttemptAt: null }, { locationNextAttemptAt: { $lte: now } }] }],
    } },
    { $addFields: { eligibleAt: { $ifNull: ['$locationNextAttemptAt', '$createdAt'] } } },
    { $setWindowFields: {
      partitionBy: '$postedBy',
      sortBy: { eligibleAt: 1 }, // $documentNumber allows exactly one sort key; ties (same eligibility instant) are arbitrary
      output: {
        shipperRank: { $documentNumber: {} },
        shipperWaitingSince: { $min: '$eligibleAt', window: { documents: ['unbounded', 'unbounded'] } },
      },
    } },
    { $match: { shipperRank: { $lte: MAX_PER_SHIPPER } } },
    { $sort: { shipperRank: 1, shipperWaitingSince: 1, postedBy: 1 } },
    { $limit: MAX_PER_RUN },
  ]);
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
      stats.rejected.push({ load, field }); // marked (or not) after the run, once we know whether the pattern is systemic
      return 'notFound';
    }
    if (r && Number.isFinite(r.lat) && Number.isFinite(r.lng)) {
      set[latK] = r.lat; set[lngK] = r.lng; guard[latK] = missing;
    } else failedField = failedField || field;
  }
  if (!Object.keys(set).length) { await recordFailure(load, failedField || 'origin', stats); return 'retry'; }
  Object.assign(set, { locationAttempts: 0, locationNextAttemptAt: null });
  // origin/destination in the filter: if the shipper edited the place while we were looking it up, these coordinates are stale.
  const w = await Load.updateOne({ _id: load._id, status: 'open', origin: load.origin, destination: load.destination, ...guard }, { $set: set });
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
    const loads = await pickCandidates(now);
    if (!loads.length) return;
    const budget = makeGeocodeBudget(BUDGET_MS);
    const stats = { located: 0, notFound: 0, rejected: [] };
    let attempted = 0;
    for (const load of loads) {
      try {
        const r = await locateOne(load, budget, stats);
        if (r === 'budget') break;
        attempted++;
      } catch (e) {
        console.error(`[LoadLocator] Failed for load ${load._id}:`, e.message);
      }
    }
    const suspect = stats.rejected.length >= SUSPECT_MIN && stats.rejected.length > attempted / 2;
    if (suspect) {
      console.warn(`[LoadLocator] ${stats.rejected.length} of ${attempted} loads came back "not found" in one run: looks like a geocoder problem, not marking them (counted as failed attempts).`);
    }
    for (const { load, field } of stats.rejected) {
      try {
        if (suspect) await recordFailure(load, field, stats); else await flagProblem(load, field, 'not_found', stats);
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
