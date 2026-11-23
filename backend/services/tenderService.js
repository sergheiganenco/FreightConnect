/**
 * tenderService.js — auto-tender: a load is offered to the shipper's network carriers ONE AT A TIME, at the posted rate.
 *
 * Each carrier gets `responseMinutes` to accept (the ordinary accept route) or decline; then the next in line is offered.
 * When nobody is left the load falls back to the visibility the shipper chose ('public' board or the whole 'private' network).
 *
 * State on the Load: `loadVisibility: 'tender'`, `tender` (current offer: readable by the offered carrier) and `tenderPlan`
 * (the line and its history: select:false, shipper only). Every step is ONE conditional write on `tenderPlan.position`, so a
 * decline racing the expiry job, or two job runs, can never skip a carrier or offer the load twice.
 */
const mongoose = require('mongoose');
const Load = require('../models/Load');
const User = require('../models/User');
const PreferredCarrier = require('../models/PreferredCarrier');
const { checkLoadEligibility } = require('./loadEligibility');
const { notifyUserSafe } = require('../utils/notifyUser');
const { getIO } = require('../utils/socket');

const MAX_QUEUE = 25;
const RESPONSE_MINUTES = { min: 5, max: 1440, default: 30 };
const FALLBACKS = ['public', 'private'];
const TIER_RANK = { gold: 0, silver: 1, standard: 2 };
const PLAN = '+tenderPlan';
const same = (a, b) => a != null && b != null && String(a) === String(b);

/**
 * Validate the shipper's tender request and build the line. Returns { plan } or { error }.
 * `carrierIds` (optional) is the shipper's own order; every id must be an active carrier of THEIR network.
 * Without it the line is the whole network: gold, silver, standard, oldest relationship first.
 */
async function buildPlan(shipperCompanyId, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'tender must be an object.' };
  const responseMinutes = input.responseMinutes == null ? RESPONSE_MINUTES.default : Number(input.responseMinutes);
  if (!Number.isInteger(responseMinutes) || responseMinutes < RESPONSE_MINUTES.min || responseMinutes > RESPONSE_MINUTES.max) {
    return { error: `tender.responseMinutes must be a whole number between ${RESPONSE_MINUTES.min} and ${RESPONSE_MINUTES.max}.` };
  }
  const fallback = input.fallback == null ? 'public' : input.fallback;
  if (!FALLBACKS.includes(fallback)) return { error: `tender.fallback must be one of: ${FALLBACKS.join(', ')}.` };

  const network = await PreferredCarrier.find({ shipper: shipperCompanyId, isActive: true }).select('carrier tier addedAt').lean();
  let queue;
  if (input.carrierIds != null) {
    const ids = input.carrierIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_QUEUE || ids.some((x) => typeof x !== 'string' || !mongoose.isValidObjectId(x))) {
      return { error: `tender.carrierIds must be a list of 1 to ${MAX_QUEUE} carrier ids.` };
    }
    if (new Set(ids).size !== ids.length) return { error: 'tender.carrierIds lists a carrier twice.' };
    const inNetwork = new Set(network.map((n) => String(n.carrier)));
    if (ids.some((x) => !inNetwork.has(x))) return { error: 'Every carrier in tender.carrierIds must be an active carrier in your network.' };
    queue = ids;
  } else {
    queue = network
      .sort((a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) || new Date(a.addedAt) - new Date(b.addedAt))
      .slice(0, MAX_QUEUE).map((n) => String(n.carrier));
  }
  if (!queue.length) return { error: 'Add carriers to your network before offering a load to it.' };
  return { plan: { queue, position: -1, responseMinutes, fallback, history: [] } };
}

// Can this carrier be offered the load at all? (Whether it may BOOK is still decided by the booking gate at accept.)
function offerable(load, carrier) {
  if (!carrier || carrier.role !== 'carrier' || carrier.active === false) return false;
  if (carrier.verification?.status !== 'verified') return false; // anything else could not book it and would only burn the answer window
  return checkLoadEligibility({ load, carrier }).eligible;
}

const money = (load) => `$${Number(load.rate).toLocaleString()}`;

/**
 * Move the tender one step: close the current offer with `outcome` (when there is one) and offer the next carrier that can
 * take it, or end the tender. `expectPosition` is the position the caller acted on. Returns the updated load, or null when
 * someone else already moved it (or the load is no longer an open tender).
 */
async function advance(loadId, { outcome = null, reason, expectPosition, now = new Date() } = {}) {
  const load = await Load.findOne({ _id: loadId, status: 'open', loadVisibility: 'tender' }).select(PLAN);
  const plan = load?.tenderPlan;
  if (!plan) return null;
  if (expectPosition != null && plan.position !== expectPosition) return null;

  const history = [];
  if (plan.position >= 0 && outcome) history.push({ carrier: plan.queue[plan.position], outcome, at: now, ...(reason ? { reason } : {}) });
  const rest = plan.queue.slice(plan.position + 1);
  const carriers = rest.length ? await User.find({ _id: { $in: rest } }).select('role active verification fleet carrierEndorsements').lean() : [];
  const byId = new Map(carriers.map((c) => [String(c._id), c]));
  // A carrier the shipper has since paused or removed from the network is not offered the load.
  const inNetwork = new Set((rest.length ? await PreferredCarrier.distinct('carrier', { shipper: load.postedBy, carrier: { $in: rest }, isActive: true }) : []).map(String));
  let next = plan.position + 1;
  for (; next < plan.queue.length; next++) {
    if (inNetwork.has(String(plan.queue[next])) && offerable(load, byId.get(String(plan.queue[next])))) break;
    history.push({ carrier: plan.queue[next], outcome: 'skipped', at: now });
  }

  const filter = { _id: load._id, status: 'open', acceptedBy: null, loadVisibility: 'tender', 'tenderPlan.position': plan.position };
  const push = history.length ? { $push: { 'tenderPlan.history': { $each: history } } } : {};
  if (next < plan.queue.length) {
    const offeredTo = plan.queue[next];
    const expiresAt = new Date(now.getTime() + plan.responseMinutes * 60000);
    const updated = await Load.findOneAndUpdate(filter, {
      $set: { 'tender.offeredTo': offeredTo, 'tender.expiresAt': expiresAt, 'tenderPlan.position': next, 'tenderPlan.offeredAt': now },
      ...push,
    }, { new: true });
    if (!updated) return null;
    await notifyUserSafe(offeredTo, {
      type: 'tender:offered',
      title: 'A shipper is offering you a load',
      body: `${load.origin} → ${load.destination} · ${money(load)} · ${load.equipmentType}. The offer is yours alone for ${plan.responseMinutes} minutes: accept or decline it.`,
      link: '/dashboard/carrier/loads',
      metadata: { loadId: String(load._id), expiresAt },
    });
    return updated;
  }

  // Nobody left: the load goes where the shipper said it should.
  const updated = await Load.findOneAndUpdate(filter, {
    $set: { loadVisibility: plan.fallback, 'tenderPlan.position': plan.queue.length, 'tenderPlan.result': 'exhausted', 'tenderPlan.endedAt': now },
    $unset: { tender: 1 },
    ...push,
  }, { new: true });
  if (!updated) return null;
  await notifyUserSafe(load.postedBy, {
    type: 'tender:exhausted',
    title: 'No carrier in your line took the load',
    body: `"${load.title}" was offered to every carrier in line and none accepted. It is now ${plan.fallback === 'public' ? 'on the public load board' : 'open to your whole network'}.`,
    link: '/dashboard/shipper/loads',
    metadata: { loadId: String(load._id) },
  });
  if (plan.fallback === 'public') require('./matchingService').notifyMatchedCarriers(updated, getIO());
  return updated;
}

/** The offered carrier company says no. Returns { ok } or { status, error }. */
async function decline({ loadId, carrierCompanyId, reason }) {
  const load = await Load.findOne({ _id: loadId, status: 'open', loadVisibility: 'tender' }).select(PLAN);
  // Same answer whether the load does not exist, is not a tender, or is offered to someone else: nothing is revealed.
  if (!load || !same(load.tender?.offeredTo, carrierCompanyId)) return { status: 404, error: 'Load not found' };
  const moved = await advance(load._id, { outcome: 'declined', reason, expectPosition: load.tenderPlan.position });
  return moved ? { ok: true } : { status: 409, error: 'This offer has already ended.' };
}

/** What the shipper sees: the line, each carrier's state, and the live offer. */
async function statusForShipper({ loadId, shipperCompanyId }) {
  const load = await Load.findOne({ _id: loadId, postedBy: shipperCompanyId }).select(`${PLAN} tender loadVisibility status acceptedBy`).lean();
  if (!load) return { status: 404, error: 'Load not found' };
  const plan = load.tenderPlan;
  if (!plan) return { tender: null };
  const names = await User.find({ _id: { $in: plan.queue } }).select('name companyName').lean();
  const nameOf = new Map(names.map((u) => [String(u._id), u.companyName || u.name]));
  const outcomeOf = new Map((plan.history || []).map((h) => [String(h.carrier), h]));
  const active = load.loadVisibility === 'tender';
  return {
    tender: {
      active,
      responseMinutes: plan.responseMinutes,
      fallback: plan.fallback,
      result: plan.result || (same(load.acceptedBy, load.tender?.offeredTo) ? 'accepted' : null),
      expiresAt: active ? load.tender?.expiresAt || null : null,
      queue: plan.queue.map((id, i) => {
        const h = outcomeOf.get(String(id));
        const state = i === plan.position && same(load.acceptedBy, id) ? 'accepted'
          : i === plan.position && active && load.status === 'open' ? 'offered'
          : h ? h.outcome : (i > plan.position && active ? 'waiting' : 'not_offered');
        return { carrierId: String(id), name: nameOf.get(String(id)) || 'Carrier', state, at: h?.at || null, reason: h?.reason || null };
      }),
    },
  };
}

module.exports = { buildPlan, advance, decline, statusForShipper, MAX_QUEUE, RESPONSE_MINUTES, FALLBACKS };
