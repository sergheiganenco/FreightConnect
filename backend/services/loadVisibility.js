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
    { status: 'open', loadVisibility: { $ne: 'preferred' } },
    { status: 'open', loadVisibility: 'preferred', postedBy: { $in: preferredShipperIds } },
    { status: 'open', loadVisibility: 'preferred', postedBy: { $nin: preferredShipperIds },
      createdAt: { $lte: new Date(Date.now() - FIRST_LOOK_MS) } },
  ];
}

/** Can this carrier company see/book this load? Only OPEN preferred loads inside the window are restricted. */
async function carrierCanSeeLoad(load, companyId) {
  if (load.status !== 'open' || load.loadVisibility !== 'preferred') return true;
  if (new Date(load.createdAt).getTime() <= Date.now() - FIRST_LOOK_MS) return true;
  return !!(await PreferredCarrier.exists({ shipper: load.postedBy, carrier: companyId, isActive: true }));
}

module.exports = { carrierOpenVisibleConditions, carrierCanSeeLoad, FIRST_LOOK_MS };
