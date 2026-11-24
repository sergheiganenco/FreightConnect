/**
 * Check Call Monitor
 *
 * Every 10 minutes: for booked ('accepted') and 'in-transit' loads, ask the pure evaluator
 * (services/checkCallService) whether the shipper should hear something now (milestone, periodic
 * position update, or "we don't know where the truck is"). A result is stored on Load.checkCalls (latest 50),
 * the shipper company is notified, ONE system message is posted in the load thread, and an ask_driver also
 * notifies the carrier company (and the assigned driver's login when it can be identified unambiguously).
 * Never cancels, never touches a trust score, never penalises anyone.
 *
 * Bounded + fair: at most MAX_LOADS_PER_RUN loads per run, oldest-evaluated first
 * (Load.checkCallState.evaluatedAt, never-evaluated first), so a large fleet rotates instead of starving.
 *
 * Idempotency: every write is ONE conditional update guarded on the booking (status + acceptedBy + bookedAt) and on
 * the exact idempotency state the evaluator read, so overlapping runs or a re-booking mid-run cannot double-post
 * or write to the wrong carrier. Only the update that actually matched may notify.
 */
const cron = require('node-cron');
const Load = require('../models/Load');
const DwellEvent = require('../models/DwellEvent');
const Message = require('../models/Message');
const User = require('../models/User');
const { evaluateCheckCall } = require('../services/checkCallService');
const { notifyUserSafe } = require('../utils/notifyUser');

const MAX_LOADS_PER_RUN = 500;
const KEEP = 50; // Load.checkCalls cap
const SELECT = 'title status destination originLat originLng destinationLat destinationLng stops carrierLocation pickupRisk.carrierConfirmation checkCallState bookedAt bookedWindow pickupTimeWindow postedBy acceptedBy assignedDriverId';
const DWELL_SELECT = 'load carrier bookedAt closedReason stopType arrivedAt departedAt arrivalAuthenticated departureAuthenticated arrivalManualBy departureManualBy';

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Post one system line in the load thread. Never throws. */
async function postThreadMessage(loadId, text) {
  try {
    await Message.create({ channelType: 'load_thread', channelId: `load_${loadId}`, sender: null, content: `Check call: ${text}`.slice(0, 2000), messageType: 'system', readBy: [] });
  } catch (err) { console.error('[CheckCall] thread message failed:', err.message); }
}

/** The assigned driver's login: the one linked on the roster, else the single driver login with the same name. */
async function assignedDriverLogin(load) {
  if (!load.assignedDriverId) return null;
  try {
    const owner = await User.findById(load.acceptedBy).select('drivers').lean();
    const driver = ((owner && owner.drivers) || []).find((d) => d.driverId === load.assignedDriverId);
    return await require('../services/driverLink').loginForDriver(load.acceptedBy, driver);
  } catch (_) { return null; }
}

/** Notify + thread message for one stored check call (shared with the driver-answer route). */
async function announce(load, entry, { askDriver = false } = {}) {
  const meta = { loadId: String(load._id), checkCallType: entry.type };
  // The shipper is not pinged just because we asked the driver; it stays in the timeline, and they are told if nobody answers.
  if (!askDriver) await notifyUserSafe(load.postedBy, { type: 'load:check_call', title: `Status update: ${load.title}`, body: entry.message, link: '/dashboard/shipper/loads', metadata: meta });
  await postThreadMessage(load._id, entry.message);
  if (askDriver) {
    const body = entry.driverPrompt || 'Check call: please give the shipper a status update.';
    const link = '/dashboard/carrier/my-loads';
    await notifyUserSafe(load.acceptedBy, { type: 'load:check_call_ask', title: `Check call: ${load.title}`, body, link, metadata: meta });
    const login = await assignedDriverLogin(load);
    if (login && String(login) !== String(load.acceptedBy)) {
      await notifyUserSafe(login, { type: 'load:check_call_ask', title: `Check call: ${load.title}`, body, link, metadata: meta });
    }
  }
}

/**
 * Persist one evaluator result with a single conditional update. Returns the stored entry or null when the
 * guard did not match (another run won, the load was re-booked, the state moved on).
 */
async function applyResult(load, r, now) {
  const st = load.checkCallState || {};
  const ask = st.ask || {};
  const guard = { _id: load._id, status: load.status, acceptedBy: load.acceptedBy, bookedAt: load.bookedAt || null };
  const set = {};
  const update = {};
  if (r.state.ask === 'new') {
    guard['checkCallState.ask.askedAt'] = ask.askedAt || null;
    set['checkCallState.ask'] = { askedAt: now };
  } else if (r.state.ask === 'noResponse') {
    guard['checkCallState.ask.askedAt'] = ask.askedAt || null;
    guard['checkCallState.ask.answeredAt'] = ask.answeredAt || null;
    guard['checkCallState.ask.noResponseSentAt'] = null;
    set['checkCallState.ask.noResponseSentAt'] = now;
  } else if (r.state.addMilestones.length) {
    guard['checkCallState.milestones'] = { $ne: r.type };
    update.$addToSet = { 'checkCallState.milestones': { $each: r.state.addMilestones } };
  } else if (r.type === 'position_update') {
    guard['checkCallState.lastPeriodicAt'] = st.lastPeriodicAt || null;
  }
  if (r.state.touchPeriodic) set['checkCallState.lastPeriodicAt'] = now;
  const entry = {
    type: r.type, at: now, message: r.message, etaAt: r.etaAt || null, distanceRemainingMiles: r.distanceRemainingMiles,
    positionAgeMinutes: r.positionAgeMinutes, positionConfirmed: r.positionConfirmed, source: 'auto',
  };
  update.$push = { checkCalls: { $each: [entry], $slice: -KEEP } };
  if (Object.keys(set).length) update.$set = set;
  const w = await Load.updateOne(guard, update);
  return w.modifiedCount === 1 ? entry : null;
}

async function runCheckCallCheck(now = new Date()) {
  const stats = { checked: 0, posted: 0, asked: 0, errors: 0 };
  try {
    const loads = await Load.find({ status: { $in: ['accepted', 'in-transit'] }, acceptedBy: { $ne: null } })
      .sort({ 'checkCallState.evaluatedAt': 1, _id: 1 }).limit(MAX_LOADS_PER_RUN).select(SELECT).lean();
    if (!loads.length) { console.log('[CheckCall] checked=0 posted=0 asked=0 errors=0'); return stats; }
    const dwell = await DwellEvent.find({ load: { $in: loads.map((l) => l._id) } }).select(DWELL_SELECT).lean();
    const byLoad = new Map();
    for (const e of dwell) { const k = String(e.load); if (!byLoad.has(k)) byLoad.set(k, []); byLoad.get(k).push(e); }
    for (const load of loads) {
      try {
        const r = evaluateCheckCall({ load, now, dwellEvents: byLoad.get(String(load._id)) || [] });
        stats.checked++;
        if (!r) continue;
        const entry = await applyResult(load, r, now);
        if (!entry) continue;
        stats.posted++;
        if (r.type === 'ask_driver') stats.asked++;
        await announce(load, { ...entry, driverPrompt: r.driverPrompt }, { askDriver: r.type === 'ask_driver' });
      } catch (err) {
        stats.errors++;
        console.error(`[CheckCall] load ${load._id} failed:`, err.message);
      }
    }
    // Rotate: everything looked at this run goes to the back of the queue.
    await Load.updateMany({ _id: { $in: loads.map((l) => l._id) } }, { $set: { 'checkCallState.evaluatedAt': now } });
  } catch (err) {
    stats.errors++;
    console.error('[CheckCall] run failed:', err.message);
  }
  console.log(`[CheckCall] checked=${stats.checked} posted=${stats.posted} asked=${stats.asked} errors=${stats.errors}`);
  return stats;
}

function start() {
  // Every 10 minutes
  cron.schedule('*/10 * * * *', () => { runCheckCallCheck().catch(() => {}); });
  console.log('[CheckCall] Scheduled — runs every 10 minutes');
}

module.exports = { start, runCheckCallCheck, announce, KEEP, MAX_LOADS_PER_RUN };
