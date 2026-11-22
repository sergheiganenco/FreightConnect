/**
 * Which OPEN loads a carrier company is allowed to see.
 *
 * Shippers can post a load with loadVisibility 'preferred': only their
 * preferred carriers see it during the first-look window, after which it
 * becomes public. Every place that surfaces open loads to a carrier (board,
 * return-load suggestions, single-load browse) must apply the same rule.
 */
const PreferredCarrier = require('../models/PreferredCarrier');

const FIRST_LOOK_MS = 2 * 60 * 60 * 1000;

/** Mongo conditions to be OR-ed: open loads visible to this carrier company. */
async function carrierOpenVisibleConditions(companyId) {
  const entries = await PreferredCarrier.find({ carrier: companyId, isActive: true }).select('shipper').lean();
  const preferredShipperIds = entries.map((e) => e.shipper);
  return [
    // Public is matched explicitly (null = loads from before the field existed),
    // so any other value fails closed.
    { status: 'open', loadVisibility: { $in: ['public', null] } },
    // preferred + private: the shipper's preferred carriers always see them
    { status: 'open', loadVisibility: { $in: ['preferred', 'private'] }, postedBy: { $in: preferredShipperIds } },
    { status: 'open', loadVisibility: 'preferred', postedBy: { $nin: preferredShipperIds },
      createdAt: { $lte: new Date(Date.now() - FIRST_LOOK_MS) } },
  ];
}

/** Can this carrier company see/book this OPEN load? Anything not explicitly public is restricted (fails closed). */
async function carrierCanSeeLoad(load, companyId) {
  if (load.status !== 'open') return true;
  const visibility = load.loadVisibility || 'public';
  if (visibility === 'public') return true;
  // 'preferred' opens to everyone after the first-look window; 'private' never does.
  if (visibility === 'preferred' && new Date(load.createdAt).getTime() <= Date.now() - FIRST_LOOK_MS) return true;
  return !!(await PreferredCarrier.exists({ shipper: load.postedBy, carrier: companyId, isActive: true }));
}

/** Batch form of carrierCanSeeLoad: one PreferredCarrier query for all candidate carrier users (sub-accounts resolve to their company). */
async function filterCarriersWhoCanSee(load, carriers) {
  const visibility = load.loadVisibility || 'public';
  if (load.status !== 'open' || visibility === 'public') return carriers;
  if (visibility === 'preferred' && new Date(load.createdAt).getTime() <= Date.now() - FIRST_LOOK_MS) return carriers;
  const entries = await PreferredCarrier.find({ shipper: load.postedBy, isActive: true }).select('carrier').lean();
  const allowed = new Set(entries.map((e) => String(e.carrier)));
  return carriers.filter((c) => allowed.has(String(c.parentAccountId || c._id)));
}

module.exports = { carrierOpenVisibleConditions, carrierCanSeeLoad, filterCarriersWhoCanSee, FIRST_LOOK_MS };
