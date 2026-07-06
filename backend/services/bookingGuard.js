const User = require('../models/User');
const Load = require('../models/Load');
const { checkLoadEligibility } = require('./loadEligibility');
const antiFraudGuard = require('./antiFraudGuard');

/**
 * Shared booking gate + atomic booking.
 *
 * EVERY code path that sets Load.acceptedBy must go through this — direct
 * accept, bid accept, counter accept, truck assign-load, and auto-dispatch.
 * The review found each new booking path tended to re-invent (or skip) the
 * checks; this is the single place they live.
 */
async function evaluateBookingGate({ load, carrierId, req = null, carrier = null }) {
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
async function atomicBookLoad({ loadId, carrierId, gate, extra = {} }) {
  const update = {
    status: 'accepted',
    acceptedBy: carrierId,
    acceptanceFingerprint: gate.fingerprint,
    ...extra,
  };
  if (gate.riskFlags && gate.riskFlags.length > 0) update.riskFlags = gate.riskFlags;
  return Load.findOneAndUpdate(
    { _id: loadId, status: 'open', acceptedBy: null },
    { $set: update },
    { new: true }
  );
}

module.exports = { evaluateBookingGate, atomicBookLoad };
