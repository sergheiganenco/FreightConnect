/**
 * Pickup/delivery requirement gate — the ONE place that decides whether a
 * transition is blocked for want of the pickup-code handshake or of photos. Used by
 * PUT /loads/:id/status, PUT /loads/:id/deliver, the pickup-signature endpoint
 * and the fleet deliver path (userRoutes).
 *
 * Both return null (not blocked) or { error, reason } for a 409 response.
 * Loads are read with Load.evidence deselected, so this asks Mongo directly.
 */
const Load = require('../models/Load');

// Only a live photo (not archived by an un-booking) from the CURRENT carrier company counts.
const hasPhoto = (load, stage, kinds) =>
  load.acceptedBy ? Load.exists({
    _id: load._id,
    evidence: { $elemMatch: { stage, companyId: load.acceptedBy, archived: { $ne: true }, ...(kinds ? { kind: { $in: kinds } } : {}) } },
  }) : null;

async function pickupBlockers(load) {
  // The pickup-code handshake is part of the same gate, so no path out of
  // 'accepted' can skip it (the status route also checks it inline, with its own wording).
  if (load.pickupVerification?.required && !load.pickupVerification?.verifiedAt) {
    return {
      error: 'Pickup verification required: the dock or shipper must verify your pickup code before this load can move forward.',
      reason: 'pickup_verification_required',
    };
  }
  if (!load.evidenceRequired?.pickup) return null;
  if (await hasPhoto(load, 'pickup', ['cargo', 'seal'])) return null;
  return {
    error: 'Pickup photos required: add at least one photo of the freight or the seal (Photos section of the load) before pickup can be completed.',
    reason: 'pickup_photos_required',
  };
}

async function deliveryBlockers(load) {
  if (!load.evidenceRequired?.delivery) return null;
  if (await hasPhoto(load, 'delivery')) return null;
  return {
    error: 'Delivery photos required: add at least one delivery photo (Photos section of the load) before this load can be marked delivered.',
    reason: 'delivery_photos_required',
  };
}

module.exports = { pickupBlockers, deliveryBlockers };
