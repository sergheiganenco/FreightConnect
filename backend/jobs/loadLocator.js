/**
 * Load Locator
 *
 * Runs every 10 minutes. Loads posted while the geocoder was down (or outside a bulk request's time budget) are saved
 * without coordinates and hidden from carriers (services/loadVisibility). This fills them in through the same geocoder
 * the posting path uses, then stores road miles. Open loads only, created in the last 14 days, oldest first, max 20 a run,
 * one shared geocode budget (~25 s, 1.1 s spacing) per run.
 *
 * - found: coordinates set with a targeted updateOne guarded on status 'open' and the coordinate still missing.
 * - not found (geocoder answered, no match): Load.locationProblem is set (so it is not retried) and the shipper is
 *   notified once. A shipper cannot edit origin/destination on an open load, so the message says cancel and re-post.
 * - outage / budget spent: untouched, retried next run.
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
const missing = { $not: { $type: 'number' } };
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

async function locateOne(load, budget, stats) {
  const set = {};
  const guard = {};
  for (const [field, place, latK, lngK] of [
    ['origin', load.origin, 'originLat', 'originLng'], ['destination', load.destination, 'destinationLat', 'destinationLng'],
  ]) {
    if (isNum(load[latK]) && isNum(load[lngK])) continue;
    const r = await geocode(place, budget);
    if (r?.skipped) return 'budget';
    if (r?.notFound) {
      const w = await Load.updateOne({ _id: load._id, status: 'open', 'locationProblem.at': { $exists: false } },
        { $set: { locationProblem: { field, place, at: new Date() } } });
      if (w.modifiedCount) {
        const label = field === 'origin' ? 'pickup' : 'delivery';
        await notifyUserSafe(load.postedBy, {
          type: 'load:location_problem',
          title: 'We could not find a load location',
          body: `We couldn't find the ${label} location "${place}" for load "${load.title}". Carriers can't see this load until it is corrected. Cancel it and re-post it with the location as City, ST.`,
          link: '/dashboard/shipper/loads', metadata: { loadId: String(load._id), field },
        });
        stats.notFound++;
      }
      return 'notFound';
    }
    if (r && Number.isFinite(r.lat) && Number.isFinite(r.lng)) {
      set[latK] = r.lat; set[lngK] = r.lng; guard[latK] = missing;
    }
  }
  if (!Object.keys(set).length) return 'retry';
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
    const loads = await Load.find({
      status: 'open',
      createdAt: { $gte: new Date(Date.now() - MAX_AGE_MS) },
      'locationProblem.at': { $exists: false },
      $or: [{ originLat: missing }, { originLng: missing }, { destinationLat: missing }, { destinationLng: missing }],
    }).sort({ createdAt: 1 }).limit(MAX_PER_RUN).lean();
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
