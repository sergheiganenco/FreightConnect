/**
 * Pickup Risk Monitor
 *
 * Every 5 minutes: for booked ('accepted') loads whose pickup starts between 24h ago and
 * 12h from now, evaluate the pickup no-show risk (services/pickupRiskService, pure) and
 * store the result on Load.pickupRisk. Notifies carrier + shipper ONCE per level per
 * booking. Never cancels, never touches a trust score, never re-tenders: the shipper decides.
 *
 * Idempotency: the notify decision is the atomic update itself. The update that adds the
 * level to `pickupRisk.notified` is filtered on "level not yet in notified" and guarded on
 * status:'accepted' + the same acceptedBy, so overlapping runs cannot double-notify and a
 * load re-booked mid-run is never written.
 */
const cron = require('node-cron');
const Load = require('../models/Load');
const DwellEvent = require('../models/DwellEvent');
const { evaluatePickupRisk, CONSTANTS: { PROPOSAL_TTL_MS } } = require('../services/pickupRiskService');
const { notifyUserSafe } = require('../utils/notifyUser');

const DAY_MS = 24 * 60 * 60 * 1000;
const LOOKAHEAD_MS = 12 * 60 * 60 * 1000;
const NEAR_PHOTO_MILES = 1;
const NOTIFY_LEVELS = ['at_risk', 'late_certain', 'no_show'];
const SELECT = 'title origin pickupFacilityName pickupAddress originLat originLng pickupTimeWindow bookedWindow carrierLocation postedBy acceptedBy assignedDriverName pickupRisk.notified pickupRisk.carrierConfirmation bookedAt pickupVerification.verifiedAt pickupSignature.signedAt';

const fmt = (d) => `${new Date(d).toUTCString().replace(' GMT', '')} UTC`;
// The window the carrier agreed to at booking. pickupTimeWindow is only a fallback for loads booked before
// bookedWindow existed; a shipper-edited pickupTimeWindow can never judge the carrier.
const agreedWindow = (l) => (l.bookedWindow && l.bookedWindow.start ? l.bookedWindow : l.pickupTimeWindow) || {};
const place = (l) => l.pickupFacilityName || l.pickupAddress || l.origin;

/** Plain-language messages for one result. `estimate` wording is mandatory: these are not measurements. */
function messages(load, r) {
  const d = r.detail || {};
  const where = place(load);
  const due = fmt(d.latestArrivalAt);
  const basis = `${d.latestArrivalBasis ? `Latest arrival is the ${d.latestArrivalBasis}: ${due}. ` : ''}`;
  const est = d.distanceMilesStraight != null
    ? `Last GPS fix was about ${d.distanceMilesStraight} straight-line miles away (estimate: x1.25 road factor at ${d.assumedMph} mph, about ${d.driveMinutesEstimate} min of driving; ${d.minutesRemaining} min remaining).`
    : '';
  const wantsConfirm = `Pickup at ${where} is due ${fmt(agreedWindow(load).start)}. Confirm you're on the way.`;
  if (r.reason === 'carrier_declined') {
    return {
      carrier: { type: 'pickup:at_risk', title: 'Pickup: you told the shipper you cannot make it', body: `The shipper was told you can't make pickup at ${where}. They may release the load.` },
      shipper: { type: 'pickup:carrier_declined', title: 'Carrier cannot make pickup', body: `The carrier says it can't make this pickup at ${where} (due ${fmt(agreedWindow(load).start)}). The booking stays in place until you act; you can release the load to standby carriers.` },
    };
  }
  if (r.level === 'at_risk') {
    return {
      carrier: { type: 'pickup:at_risk', title: 'Are you on the way to pickup?', body: wantsConfirm },
      shipper: {
        type: 'pickup:at_risk', title: 'Pickup may be missed',
        body: r.reason === 'no_gps'
          ? `We are not receiving the carrier's location and pickup at ${where} is due ${fmt(agreedWindow(load).start)}. This is not a confirmed problem. ${basis}`.trim()
          : `Pickup at ${where} may be missed. ${est} ${basis}These are estimates, not confirmed delays.`.trim(),
      },
    };
  }
  if (r.level === 'late_certain') {
    const msg = `Estimated about ${d.minutesLateEstimate} min late (at least ${d.minutesLateAtLeast} min even at ${d.fastestMph} mph). ${est} ${basis}`.trim();
    return {
      carrier: { type: 'pickup:late', title: 'You will likely miss pickup', body: `Pickup at ${where}: ${msg} Tell the shipper if you can't make it.` },
      shipper: { type: 'pickup:late', title: 'Carrier cannot reach pickup in time', body: `Pickup at ${where}: ${msg} You can release the load to standby carriers.` },
    };
  }
  return {
    carrier: { type: 'pickup:no_show', title: 'Pickup missed', body: `No arrival at ${where} was recorded and the pickup window plus ${d.graceMinutes} min grace has passed. The shipper may release the load.` },
    shipper: { type: 'pickup:no_show', title: 'Carrier did not arrive at pickup', body: `No arrival at ${where} was recorded; the pickup window plus ${d.graceMinutes} min grace has passed. You can release the load to standby carriers.` },
  };
}

async function sendNotices(load, r, skip = {}) {
  const m = messages(load, r);
  const meta = { loadId: String(load._id), level: r.level, reason: r.reason };
  if (!skip.carrier) await notifyUserSafe(load.acceptedBy, { ...m.carrier, link: '/dashboard/carrier/my-loads', metadata: meta });
  if (!skip.shipper) await notifyUserSafe(load.postedBy, { ...m.shipper, link: '/dashboard/shipper/loads', metadata: meta });
}

/**
 * Evaluate + persist one load (lean doc with SELECT fields). `arrived` = a pickup DwellEvent exists.
 * `skip` suppresses a side's notification (carrier/shipper) while still recording the level as announced;
 * `skip.all` writes state only and never touches `notified`.
 * Returns { result, notified }.
 */
async function applyEvaluation(load, arrived, now, skip = {}) {
  const loc = load.carrierLocation && load.carrierLocation.updatedAt && load.carrierLocation.latitude != null
    ? { lat: load.carrierLocation.latitude, lng: load.carrierLocation.longitude, updatedAt: load.carrierLocation.updatedAt, authenticated: load.carrierLocation.authenticated === true }
    : null;
  const win = agreedWindow(load);
  const result = evaluatePickupRisk({
    now,
    pickupStart: win.start,
    pickupEnd: win.end,
    origin: { lat: load.originLat, lng: load.originLng },
    lastLocation: loc,
    arrivedAtPickup: arrived,
    carrierConfirmation: load.pickupRisk && load.pickupRisk.carrierConfirmation && load.pickupRisk.carrierConfirmation.status,
    status: 'accepted',
  });
  const guard = { _id: load._id, status: 'accepted', acceptedBy: load.acceptedBy };
  const set = {
    'pickupRisk.level': result.level, 'pickupRisk.reason': result.reason,
    'pickupRisk.detail': result.detail, 'pickupRisk.evaluatedAt': now,
  };
  let notified = false;
  if (!skip.all && NOTIFY_LEVELS.includes(result.level) && !((load.pickupRisk && load.pickupRisk.notified) || []).includes(result.level)) {
    const r = await Load.updateOne(
      { ...guard, 'pickupRisk.notified': { $ne: result.level } },
      { $set: set, $addToSet: { 'pickupRisk.notified': result.level } }
    );
    notified = r.modifiedCount === 1; // only the update that actually added the level may notify
    if (notified) { await sendNotices(load, result, skip); return { result, notified }; }
  }
  await Load.updateOne(guard, { $set: set });
  return { result, notified };
}

async function pickupArrivals(loads) {
  const events = await DwellEvent.find({ load: { $in: loads.map((l) => l._id) }, stopType: 'pickup', arrivedAt: { $ne: null } })
    .select('load carrier arrivedAt').lean();
  // Bind to the CURRENT booking: an arrival from an earlier booking by the same carrier does not count.
  // (Loads booked before bookedAt existed have none: every arrival counts, as before.)
  const booked = new Map(loads.map((l) => [String(l._id), l.bookedAt]));
  const during = (id, at) => { const b = booked.get(String(id)); return !b || new Date(at) >= new Date(b); };
  const out = new Set(events.filter((e) => during(e.load, e.arrivedAt)).map((e) => `${e.load}:${e.carrier}`));
  // Other arrival evidence, all of it from THIS booking: a verified pickup code, a pickup signature, or a live
  // pickup photo from the booked carrier taken within 1 mile of the facility. Any of them means the truck got there.
  for (const l of loads) {
    const v = l.pickupVerification && l.pickupVerification.verifiedAt;
    const sg = l.pickupSignature && l.pickupSignature.signedAt;
    if ((v && during(l._id, v)) || (sg && during(l._id, sg))) out.add(`${l._id}:${l.acceptedBy}`);
  }
  const photos = await Load.find({
    _id: { $in: loads.map((l) => l._id) },
    evidence: { $elemMatch: { stage: 'pickup', archived: { $ne: true }, facilityDistanceMiles: { $lte: NEAR_PHOTO_MILES } } },
  }).select('acceptedBy +evidence').lean(); // evidence is select:false
  for (const p of photos) {
    if ((p.evidence || []).some((e) => e.stage === 'pickup' && !e.archived && e.facilityDistanceMiles != null && e.facilityDistanceMiles <= NEAR_PHOTO_MILES
      && String(e.companyId) === String(p.acceptedBy))) out.add(`${p._id}:${p.acceptedBy}`);
  }
  return out;
}

/** Re-evaluate a single load now (used by the carrier-response route). */
async function refreshLoad(loadId, skip = {}, now = new Date()) {
  const load = await Load.findOne({ _id: loadId, status: 'accepted', acceptedBy: { $ne: null } }).select(SELECT).lean();
  if (!load) return null;
  const arrivals = await pickupArrivals([load]);
  return applyEvaluation(load, arrivals.has(`${load._id}:${load.acceptedBy}`), now, skip);
}

async function runPickupRiskCheck(now = new Date()) {
  const stats = { checked: 0, notified: 0, atRisk: 0, lateCertain: 0, noShow: 0, errors: 0 };
  try {
    await Load.updateMany({ 'pickupWindowChange.status': 'pending', 'pickupWindowChange.proposedAt': { $lt: new Date(now.getTime() - PROPOSAL_TTL_MS) } },
      { $set: { 'pickupWindowChange.status': 'expired' } }); // unanswered proposals lapse after 24h
    const range = { $gte: new Date(now.getTime() - DAY_MS), $lte: new Date(now.getTime() + LOOKAHEAD_MS) };
    const loads = await Load.find({
      status: 'accepted', acceptedBy: { $ne: null },
      $or: [
        { 'bookedWindow.start': range },
        { 'bookedWindow.start': { $exists: false }, 'pickupTimeWindow.start': range }, // booked before bookedWindow existed
      ],
    }).select(SELECT).lean();
    const arrivals = loads.length ? await pickupArrivals(loads) : new Set();
    for (const load of loads) {
      try {
        const { result, notified } = await applyEvaluation(load, arrivals.has(`${load._id}:${load.acceptedBy}`), now);
        stats.checked++;
        if (notified) stats.notified++;
        if (result.level === 'at_risk') stats.atRisk++;
        else if (result.level === 'late_certain') stats.lateCertain++;
        else if (result.level === 'no_show') stats.noShow++;
      } catch (err) {
        stats.errors++;
        console.error(`[PickupRisk] load ${load._id} failed:`, err.message);
      }
    }
  } catch (err) {
    stats.errors++;
    console.error('[PickupRisk] run failed:', err.message);
  }
  console.log(`[PickupRisk] checked=${stats.checked} at_risk=${stats.atRisk} late=${stats.lateCertain} no_show=${stats.noShow} notified=${stats.notified} errors=${stats.errors}`);
  return stats;
}

function start() {
  // Every 5 minutes
  cron.schedule('*/5 * * * *', () => { runPickupRiskCheck().catch(() => {}); });
  console.log('[PickupRisk] Scheduled — runs every 5 minutes');
}

module.exports = { start, runPickupRiskCheck, refreshLoad, messages, agreedWindow, pickupArrivals, NOTIFY_LEVELS, _applyEvaluation: applyEvaluation };
