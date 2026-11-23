const User = require('../models/User');
const Load = require('../models/Load');
const { checkLoadEligibility } = require('./loadEligibility');
const antiFraudGuard = require('./antiFraudGuard');
const { carrierCanSeeLoad } = require('./loadVisibility');

/**
 * Shared booking gate + atomic booking.
 *
 * EVERY code path that sets Load.acceptedBy must go through this — direct
 * accept, bid accept, counter accept, truck assign-load, and auto-dispatch.
 * The review found each new booking path tended to re-invent (or skip) the
 * checks; this is the single place they live.
 */
async function evaluateBookingGate({ load, carrierId, req = null, carrier = null }) {
  // Visibility first: a carrier that cannot see a first-look/private load must not
  // book it on ANY path. `notVisible` lets callers answer 404 without revealing it.
  if (!(await carrierCanSeeLoad(load, carrierId))) {
    return { allowed: false, notVisible: true, reasons: ['Load not found'], verificationStatus: 'unverified' };
  }

  const carrierDoc = carrier || await User.findById(carrierId)
    .select('role verification fleet carrierEndorsements');

  const eligibility = checkLoadEligibility({ load, carrier: carrierDoc });
  if (!eligibility.eligible) {
    return {
      allowed: false,
      reasons: eligibility.reasons,
      verificationStatus: carrierDoc?.verification?.status || 'unverified',
    };
  }

  const fraudResult = await antiFraudGuard.evaluateAcceptance({ load, carrier: carrierDoc, req });
  if (!fraudResult.allowed) {
    return {
      allowed: false,
      reasons: fraudResult.reasons,
      verificationStatus: carrierDoc?.verification?.status || 'unverified',
    };
  }

  return {
    allowed: true,
    riskFlags: fraudResult.riskFlags || [],
    fingerprint: antiFraudGuard.buildFingerprint(req, carrierId),
  };
}

/**
 * Atomically assign an open load to a carrier (prevents double-booking and
 * clobbering cancelled loads). Returns the booked load or null if no longer open.
 */
// Filter value for "the load is still on terms version v" (loads from before the field existed count as 1).
const versionIs = (v) => (v === 1 ? { $in: [1, null] } : v);

// termsVersion: the version of the load the caller's gate/bid was evaluated against. When given, a load the shipper
// has materially edited since is NOT booked (returns null like any other lost race).
async function atomicBookLoad({ loadId, carrierId, gate, extra = {}, termsVersion }) {
  const update = {
    status: 'accepted',
    acceptedBy: carrierId,
    acceptanceFingerprint: gate.fingerprint,
    ...extra,
  };
  if (gate.riskFlags && gate.riskFlags.length > 0) update.riskFlags = gate.riskFlags;
  const booked = await Load.findOneAndUpdate(
    { _id: loadId, status: 'open', acceptedBy: null, ...(termsVersion != null ? { termsVersion: versionIs(termsVersion) } : {}) },
    { $set: update },
    { new: true }
  );
  if (booked) await require('./standbyService').buildStandby(booked, carrierId);
  return booked;
}

module.exports = { evaluateBookingGate, atomicBookLoad, versionIs };
