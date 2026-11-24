/**
 * Next-load proposals.
 *
 * When a truck is close to delivering, the planner is run from the delivery point and the best
 * next loads are sent to the office (owner and dispatchers, who can book) and to the driver (who can
 * ask the office to book one). Nothing is booked here.
 *
 * "Close" is within NEAR_MILES of the destination by a recent location, or, with no recent
 * location, within NEAR_MS of the end of the delivery window. A load is proposed for once, and
 * again only when the best option has changed.
 */
const cron = require('node-cron');
const Load = require('../models/Load');
const User = require('../models/User');
const { haversineMiles } = require('../utils/geo');
const { planForTruck, driverForTruck, AutopilotError } = require('../services/autopilotService');
const { loginForDriver } = require('../services/driverLink');
const { notifyUserSafe } = require('../utils/notifyUser');

const NEAR_MILES = 120;
const NEAR_MS = 3 * 3600000;
const LOCATION_FRESH_MS = 30 * 60000;
const RETRY_MS = 30 * 60000;
const fin = Number.isFinite;

function nearDelivery(load, now) {
  const loc = load.carrierLocation;
  if (loc && loc.updatedAt && now - new Date(loc.updatedAt) <= LOCATION_FRESH_MS
      && fin(loc.latitude) && fin(loc.longitude) && fin(load.destinationLat) && fin(load.destinationLng)) {
    return haversineMiles(loc.latitude, loc.longitude, load.destinationLat, load.destinationLng) <= NEAR_MILES;
  }
  const end = load.deliveryTimeWindow && load.deliveryTimeWindow.end;
  return !!end && new Date(end) - now <= NEAR_MS;
}

const money = (cents) => `$${Math.round((cents || 0) / 100).toLocaleString('en-US')}`;
const describe = (leg, withRate) => `"${leg.load.title}" ${leg.load.origin} to ${leg.load.destination}${withRate ? `, ${money(leg.rateCents)}` : ''}`;

async function runNextLoadProposals(now = new Date()) {
  const stats = { near: 0, proposed: 0, errors: 0 };
  const loads = await Load.find({
    status: 'in-transit',
    assignedTruckId: { $ne: null },
    $or: [{ 'nextLoadProposal.at': null }, { 'nextLoadProposal.at': { $lte: new Date(now.getTime() - RETRY_MS) } }],
  }).select('title acceptedBy assignedTruckId carrierLocation destinationLat destinationLng deliveryTimeWindow nextLoadProposal')
    .limit(200).lean(); // ponytail: 200 trucks near delivery per pass; page through when the fleet count gets there

  for (const load of loads) {
    if (!nearDelivery(load, now)) continue;
    stats.near++;
    const companyId = String(load.acceptedBy);
    let ids = [];
    try {
      const plan = await planForTruck({
        companyId, caller: { userId: companyId, companyRole: 'owner' }, truckId: load.assignedTruckId, overrides: { maxLoads: 1 }, now,
      });
      const top = plan.plans.slice(0, 3);
      ids = top.map((p) => String(p.loadIds[0]));
      const before = (load.nextLoadProposal && load.nextLoadProposal.loadIds) || [];
      if (ids.length && ids[0] !== before[0]) {
        const link = `/dashboard/carrier/autopilot?truckId=${encodeURIComponent(load.assignedTruckId)}`;
        const more = top.length > 1 ? ` ${top.length - 1} more option${top.length > 2 ? 's' : ''} ready.` : '';
        const note = (userId, forDriver) => notifyUserSafe(String(userId), {
          type: 'autopilot:next_load',
          title: `Next load for truck ${load.assignedTruckId}`,
          body: `"${load.title}" is close to delivery. Best next load: ${describe(top[0].legs[0], !forDriver)}.${more}${forDriver ? ' Open it to ask dispatch to book it.' : ' Open it to book.'}`,
          link,
          metadata: { loadId: load._id, truckId: load.assignedTruckId, nextLoadIds: ids },
        });
        const owner = await User.findById(companyId).select('fleet drivers').lean();
        const dispatchers = await User.find({ parentAccountId: companyId, companyRole: 'dispatcher', active: { $ne: false } }).select('_id').lean();
        const office = [companyId, ...dispatchers.map((d) => String(d._id))];
        for (const id of office) note(id, false);
        const truck = owner && (owner.fleet || []).find((t) => t.truckId === load.assignedTruckId);
        const driver = truck ? driverForTruck(owner, truck) : null;
        const login = driver ? await loginForDriver(companyId, driver) : null;
        if (login && !office.includes(String(login))) note(login, true);
        stats.proposed++;
      }
    } catch (err) {
      // A truck the planner cannot place (removed, unverified company, no window) is expected; anything else is logged.
      if (!(err instanceof AutopilotError)) { stats.errors++; console.error('[NextLoadProposer] load', String(load._id), 'failed:', err.message); }
    }
    await Load.updateOne({ _id: load._id }, { $set: { nextLoadProposal: { at: now, loadIds: ids } } });
  }
  if (stats.proposed || stats.errors) console.log(`[NextLoadProposer] near=${stats.near} proposed=${stats.proposed} errors=${stats.errors}`);
  return stats;
}

function start() {
  cron.schedule('*/10 * * * *', () => { runNextLoadProposals().catch((e) => console.error('[NextLoadProposer] run failed:', e.message)); });
  console.log('[NextLoadProposer] Scheduled — runs every 10 minutes');
}

module.exports = { start, runNextLoadProposals, nearDelivery };
