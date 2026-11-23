/**
 * tenderMonitor.js — moves auto-tender loads along (services/tenderService).
 *
 * Every minute: an open tender load whose offer ran out (or was never started: the load had no coordinates at posting)
 * is offered to the next carrier in line, or falls back to the visibility the shipper chose.
 */
const cron = require('node-cron');
const Load = require('../models/Load');
const { advance } = require('../services/tenderService');

const MAX_LOADS_PER_RUN = 200;
const LOCATED = { originLat: { $type: 'number' }, originLng: { $type: 'number' }, destinationLat: { $type: 'number' }, destinationLng: { $type: 'number' } };

async function runTenderCheck(now = new Date()) {
  const stats = { checked: 0, moved: 0, errors: 0 };
  try {
    const loads = await Load.find({
      loadVisibility: 'tender', status: 'open', ...LOCATED,
      $or: [{ 'tender.expiresAt': { $lte: now } }, { 'tender.expiresAt': null }],
    }).sort({ 'tender.expiresAt': 1 }).limit(MAX_LOADS_PER_RUN).select('+tenderPlan bookedAt').lean();
    for (const load of loads) {
      stats.checked++;
      try {
        const plan = load.tenderPlan || {};
        // An offer that was accepted and then un-booked ended because the carrier gave the load back, not because time ran out.
        const gaveBack = load.bookedAt && plan.offeredAt && new Date(load.bookedAt) >= new Date(plan.offeredAt);
        const moved = await advance(load._id, { outcome: gaveBack ? 'cancelled' : 'expired', expectPosition: plan.position, now });
        if (moved) stats.moved++;
      } catch (err) {
        stats.errors++;
        console.error(`[Tender] load ${load._id} failed:`, err.message);
      }
    }
  } catch (err) {
    stats.errors++;
    console.error('[Tender] run failed:', err.message);
  }
  if (stats.checked || stats.errors) console.log(`[Tender] checked=${stats.checked} moved=${stats.moved} errors=${stats.errors}`);
  return stats;
}

function start() {
  cron.schedule('* * * * *', () => { runTenderCheck().catch(() => {}); });
  console.log('[Tender] Scheduled — runs every minute');
}

module.exports = { start, runTenderCheck };
