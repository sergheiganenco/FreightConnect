/**
 * Which OPEN loads a carrier company is allowed to see.
 *
 * Shippers can post a load with loadVisibility 'preferred': only their
 * preferred carriers see it during the first-look window, after which it
 * becomes public. Every place that surfaces open loads to a carrier (board,
 * return-load suggestions, single-load browse) must apply the same rule.
 */
const PreferredCarrier = require('../models/PreferredCarrier');
const User = require('../models/User');

const FIRST_LOOK_MS = 2 * 60 * 60 * 1000;

// A load without coordinates can never be booked (accept refuses it), so it is not offered to carriers at all.
const HAS_COORDS = {
  originLat: { $type: 'number' }, originLng: { $type: 'number' },
  destinationLat: { $type: 'number' }, destinationLng: { $type: 'number' },
};

const same = (a, b) => a != null && b != null && String(a) === String(b);
// A tender load exists for exactly one carrier company, and only until its offer runs out.
const tenderOfferFor = (companyId) => ({ loadVisibility: 'tender', 'tender.offeredTo': companyId, 'tender.expiresAt': { $gt: new Date() } });
const holdsTenderOffer = (load, companyId) => same(load.tender?.offeredTo, companyId) && new Date(load.tender.expiresAt).getTime() > Date.now();
/** For the atomic booking write: a tender load is booked only by the carrier holding the live offer. */
const tenderBookable = (companyId) => ({ $or: [{ loadVisibility: { $ne: 'tender' } }, tenderOfferFor(companyId)] });

/** Mongo conditions to be OR-ed: open loads visible to this carrier company (and bookable: they have coordinates). */
async function carrierOpenVisibleConditions(companyId) {
  const entries = await PreferredCarrier.find({ carrier: companyId, isActive: true }).select('shipper').lean();
  const preferredShipperIds = entries.map((e) => e.shipper);
  return [
    // Public is matched explicitly (null = loads from before the field existed),
    // so any other value fails closed.
    { status: 'open', loadVisibility: { $in: ['public', null] }, ...HAS_COORDS },
    // preferred + private: the shipper's preferred carriers always see them
    { status: 'open', loadVisibility: { $in: ['preferred', 'private'] }, postedBy: { $in: preferredShipperIds }, ...HAS_COORDS },
    { status: 'open', loadVisibility: 'preferred', postedBy: { $nin: preferredShipperIds },
      createdAt: { $lte: new Date(Date.now() - FIRST_LOOK_MS) }, ...HAS_COORDS },
    { status: 'open', ...tenderOfferFor(companyId), ...HAS_COORDS },
  ];
}

/** Can this carrier company see/book this OPEN load? Anything not explicitly public is restricted (fails closed). */
async function carrierCanSeeLoad(load, companyId) {
  if (load.status !== 'open') return true;
  const visibility = load.loadVisibility || 'public';
  if (visibility === 'public') return true;
  if (visibility === 'tender') return holdsTenderOffer(load, companyId);
  // 'preferred' opens to everyone after the first-look window; 'private' never does.
  if (visibility === 'preferred' && new Date(load.createdAt).getTime() <= Date.now() - FIRST_LOOK_MS) return true;
  return !!(await PreferredCarrier.exists({ shipper: load.postedBy, carrier: companyId, isActive: true }));
}

/**
 * Accounts whose sub-accounts must not receive load alerts: deactivated owners
 * (deactivation does not cascade to sub-accounts today) and suspended/rejected carriers.
 */
function blockedOwnerIds() {
  return User.distinct('_id', { $or: [{ active: false }, { 'verification.status': { $in: ['suspended', 'rejected'] } }] });
}

/** Batch form of carrierCanSeeLoad: one PreferredCarrier query for all candidate carrier users (sub-accounts resolve to their company). */
async function filterCarriersWhoCanSee(load, carriers) {
  // Deactivated accounts, and sub-accounts of a deactivated/suspended/rejected owner,
  // never receive load details — checked BEFORE the public early return.
  carriers = carriers.filter((c) => c.active !== false);
  if (carriers.some((c) => c.parentAccountId)) {
    const blocked = new Set((await blockedOwnerIds()).map(String));
    carriers = carriers.filter((c) => !c.parentAccountId || !blocked.has(String(c.parentAccountId)));
  }
  const visibility = load.loadVisibility || 'public';
  if (load.status !== 'open' || visibility === 'public') return carriers;
  if (visibility === 'tender') return carriers.filter((c) => holdsTenderOffer(load, c.parentAccountId || c._id));
  if (visibility === 'preferred' && new Date(load.createdAt).getTime() <= Date.now() - FIRST_LOOK_MS) return carriers;
  const entries = await PreferredCarrier.find({ shipper: load.postedBy, isActive: true }).select('carrier').lean();
  const allowed = new Set(entries.map((e) => String(e.carrier)));
  return carriers.filter((c) => allowed.has(String(c.parentAccountId || c._id)));
}

module.exports = { carrierOpenVisibleConditions, carrierCanSeeLoad, filterCarriersWhoCanSee, blockedOwnerIds, tenderBookable, FIRST_LOOK_MS };
