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
const TrackingEvent = require('../models/TrackingEvent');
const ReviewQueue = require('../models/ReviewQueue');
const User = require('../models/User');
const { haversineMiles } = require('../utils/geo');
const { evaluatePickupRisk, CONSTANTS: { PROPOSAL_TTL_MS } } = require('../services/pickupRiskService');
const { notifyUserSafe } = require('../utils/notifyUser');

const DAY_MS = 24 * 60 * 60 * 1000;
const LOOKAHEAD_MS = 12 * 60 * 60 * 1000;
const NEAR_PHOTO_MILES = 1;
const CORROBORATE_MS = 30 * 60 * 1000; // a signature/photo needs an authenticated fix near the origin within this of it
const NOTIFY_LEVELS = ['at_risk', 'late_certain', 'no_show'];
const SELECT = 'title origin pickupFacilityName pickupAddress originLat originLng pickupTimeWindow bookedWindow carrierLocation postedBy acceptedBy assignedDriverName pickupRisk.notified pickupRisk.carrierConfirmation pickupRisk.detail.latestArrivalAt bookedAt pickupVerification.verifiedAt pickupSignature.signedAt';

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
  const fix = (c) => (c && c.updatedAt && c.latitude != null ? { lat: c.latitude, lng: c.longitude, updatedAt: c.updatedAt } : null);
  const loc = fix(load.carrierLocation);                              // latest fix of any kind: at_risk prompt, live map
  const authLoc = fix(load.carrierLocation && load.carrierLocation.lastAuthenticated); // evidence: late_certain only
  const win = agreedWindow(load);
  const result = evaluatePickupRisk({
    now,
    pickupStart: win.start,
    pickupEnd: win.end,
    origin: { lat: load.originLat, lng: load.originLng },
    lastLocation: loc,
    lastAuthenticatedLocation: authLoc,
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

/** Is there an authenticated fix from THIS booking within 1 mile of the origin within 30 min of `at`? */
async function corroboratedAt(load, at) {
  const t = new Date(at).getTime();
  if (!Number.isFinite(t) || !Number.isFinite(load.originLat) || !Number.isFinite(load.originLng)) return false;
  const near = (la, lo) => haversineMiles(la, lo, load.originLat, load.originLng) <= NEAR_PHOTO_MILES;
  const la = load.carrierLocation && load.carrierLocation.lastAuthenticated;
  if (la && la.updatedAt && Math.abs(new Date(la.updatedAt).getTime() - t) <= CORROBORATE_MS && near(la.latitude, la.longitude)) return true;
  const from = Math.max(t - CORROBORATE_MS, load.bookedAt ? new Date(load.bookedAt).getTime() : 0);
  const fixes = await TrackingEvent.find({ load: load._id, carrier: load.acceptedBy, authenticated: true, recordedAt: { $gte: new Date(from), $lte: new Date(t + CORROBORATE_MS) } })
    .select('latitude longitude').lean();
  return fixes.some((f) => near(f.latitude, f.longitude));
}

/**
 * Arrival evidence per booked load: Map `${loadId}:${carrierId}` -> { arrived, signals }.
 * Counts only evidence from THIS booking. A geofence/manual check-in or a verified pickup code (dock-entered) is
 * sufficient. A pickup signature or a "nearby" pickup photo is captured in the carrier's own app (the photo's
 * distance is client-reported GPS), so it counts only when corroborated: a verified code, or an authenticated
 * fix within 1 mile of the origin within 30 min of it. `signals` feeds the admin review item (no coordinates).
 */
async function arrivalEvidence(loads) {
  const events = await DwellEvent.find({ load: { $in: loads.map((l) => l._id) }, stopType: 'pickup', arrivedAt: { $ne: null } })
    .select('load carrier arrivedAt arrivalAuthenticated arrivalManualBy').lean();
  // Bind to the CURRENT booking: an arrival from an earlier booking by the same carrier does not count.
  // (Loads booked before bookedAt existed have none: every arrival counts, as before.)
  const booked = new Map(loads.map((l) => [String(l._id), l.bookedAt]));
  const during = (id, at) => { const b = booked.get(String(id)); return !b || new Date(at) >= new Date(b); };
  const photoLoads = await Load.find({
    _id: { $in: loads.map((l) => l._id) },
    evidence: { $elemMatch: { stage: 'pickup', archived: { $ne: true }, facilityDistanceMiles: { $lte: NEAR_PHOTO_MILES } } },
  }).select('acceptedBy +evidence').lean(); // evidence is select:false
  const photosBy = new Map(photoLoads.map((p) => [String(p._id), p.evidence || []]));
  const out = new Map();
  for (const l of loads) {
    const sig = { geofence: null, verifiedCode: false, signature: null, photo: null };
    const kind = (e) => (e.arrivalManualBy ? 'manual' : e.arrivalAuthenticated === true ? 'authenticated' : e.arrivalAuthenticated === false ? 'unauthenticated' : 'unknown');
    const kinds = events.filter((e) => String(e.load) === String(l._id) && String(e.carrier) === String(l.acceptedBy) && during(l._id, e.arrivedAt)).map(kind);
    if (kinds.length) sig.geofence = kinds.includes('authenticated') ? 'authenticated' : kinds[0];
    const v = l.pickupVerification && l.pickupVerification.verifiedAt;
    sig.verifiedCode = !!(v && during(l._id, v));
    const sg = l.pickupSignature && l.pickupSignature.signedAt;
    if (sg && during(l._id, sg)) sig.signature = (sig.verifiedCode || await corroboratedAt(l, sg)) ? 'corroborated' : 'uncorroborated';
    const photos = (photosBy.get(String(l._id)) || []).filter((e) => e.stage === 'pickup' && !e.archived && e.facilityDistanceMiles != null
      && e.facilityDistanceMiles <= NEAR_PHOTO_MILES && String(e.companyId) === String(l.acceptedBy));
    if (photos.length) {
      let ok = sig.verifiedCode;
      for (const p of photos) { if (ok) break; ok = await corroboratedAt(l, p.uploadedAt); }
      sig.photo = ok ? 'corroborated' : 'uncorroborated';
    }
    out.set(`${l._id}:${l.acceptedBy}`, { arrived: !!(sig.geofence || sig.verifiedCode || sig.signature === 'corroborated' || sig.photo === 'corroborated'), signals: sig });
  }
  return out;
}

async function pickupArrivals(loads) {
  const ev = await arrivalEvidence(loads);
  return new Set([...ev].filter(([, v]) => v.arrived).map(([k]) => k));
}

/** Evidence snapshot for the admin review item: times, distances in miles, signal kinds. Never coordinates. */
async function noShowSnapshot(loadId, { releasedByRole, now = new Date() } = {}) {
  const load = await Load.findById(loadId).select(SELECT).lean();
  if (!load) return null;
  const arrival = (await arrivalEvidence([load])).get(`${load._id}:${load.acceptedBy}`);
  const miles = (c) => (c && c.latitude != null && Number.isFinite(load.originLat) ? Math.round(haversineMiles(c.latitude, c.longitude, load.originLat, load.originLng) * 10) / 10 : null);
  const cl = load.carrierLocation || {};
  const la = cl.lastAuthenticated;
  const [carrier, shipper] = await Promise.all([
    User.findById(load.acceptedBy).select('companyName name').lean(),
    User.findById(load.postedBy).select('companyName name').lean(),
  ]);
  const win = agreedWindow(load);
  return {
    loadId: String(load._id), loadTitle: load.title, releasedByRole, releasedAt: now.toISOString(),
    carrierCompany: (carrier && (carrier.companyName || carrier.name)) || null,
    shipperCompany: (shipper && (shipper.companyName || shipper.name)) || null,
    agreedWindow: { start: win.start || null, end: win.end || null, latestArrivalAt: load.pickupRisk && load.pickupRisk.detail ? load.pickupRisk.detail.latestArrivalAt || null : null },
    arrivalSignalsFound: arrival ? arrival.arrived : false,
    arrivalSignals: arrival ? arrival.signals : null, // geofence: authenticated|unauthenticated|manual|unknown|null; signature/photo: corroborated|uncorroborated|null
    lastAuthenticatedFix: la && la.updatedAt ? { at: la.updatedAt, distanceMiles: miles(la), source: la.source || null } : null,
    lastFix: cl.updatedAt ? { at: cl.updatedAt, distanceMiles: miles(cl), source: cl.source || null, authenticated: cl.authenticated === true } : null,
    carrierConfirmation: (load.pickupRisk && load.pickupRisk.carrierConfirmation && load.pickupRisk.carrierConfirmation.status) || null,
  };
}

/** A suspected no-show goes to a person: nothing automatic happens to the carrier's trust score. */
function fileNoShowReview(snapshot, carrierId) {
  return ReviewQueue.create({
    type: 'pickup_no_show', subjectUser: carrierId, severity: 'medium', status: 'pending',
    reason: `Shipper released load "${snapshot.loadTitle}" as a suspected pickup no-show. No automatic trust score change was made.`,
    recommendedAction: 'manual_review', details: snapshot,
  });
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

module.exports = { start, runPickupRiskCheck, refreshLoad, messages, agreedWindow, pickupArrivals, noShowSnapshot, fileNoShowReview, NOTIFY_LEVELS, _applyEvaluation: applyEvaluation };
