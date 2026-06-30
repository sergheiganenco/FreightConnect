const FactoringAssignment = require('../models/FactoringAssignment');

/**
 * Factoring payment router — single source of truth for "who gets paid".
 *
 * LEGAL ENCODING — UCC Article 9 §9-406 (see FactoringAssignment.js header).
 * This is an ENCODING of expected §9-406 behavior, NOT legal advice; it
 * REQUIRES review by legal counsel. The governing principle: once a valid
 * Notice of Assignment is on file, paying the carrier instead of the assignee
 * (factor) does NOT discharge the debt and exposes the platform to paying
 * AGAIN. Therefore, whenever the correct payee is uncertain, we HOLD — we
 * never auto-pay and risk a double-payment.
 *
 * Resolve where a carrier's payout must go. Returns one of:
 *   { payTo: 'carrier' }                              // no NOA → normal
 *   { payTo: 'factor', assignment }                   // active verified NOA → pay factor remit-to
 *   { payTo: 'hold', reason, assignment? }            // pending or competing → DO NOT PAY anyone yet
 *
 * Call this BEFORE any carrier payout.
 */
async function resolvePayee(carrierId) {
  try {
    if (!carrierId) return { payTo: 'carrier' };

    // Only statuses that can affect routing: pending (risk), active (redirect),
    // disputed (hold). released/rejected revert to normal carrier payment.
    const open = await FactoringAssignment.find({
      carrier: carrierId,
      status: { $in: ['pending_verification', 'active', 'disputed'] },
    });
    if (!open.length) return { payTo: 'carrier' };

    const active = open.filter(a => a.status === 'active');

    // Two (or more) verified, active NOAs for one carrier = competing claims.
    // §9-406 does not let us safely pick one — HOLD and escalate to human/legal.
    if (active.length > 1) {
      return { payTo: 'hold', reason: 'Competing active factoring assignments — legal review required' };
    }

    // Exactly one verified, active NOA → redirect payment to the factor.
    if (active.length === 1) {
      return { payTo: 'factor', assignment: active[0] };
    }

    // No active NOA, but a pending or disputed NOA exists → HOLD.
    // Paying the carrier now is the exact §9-406 double-payment risk if the NOA
    // is later verified as valid.
    return { payTo: 'hold', reason: 'Factoring NOA pending verification — payout held', assignment: open[0] };
  } catch (err) {
    // FAIL SAFE: if we cannot determine the correct payee, HOLD rather than risk
    // paying the wrong party. Never default to paying the carrier on error.
    return { payTo: 'hold', reason: 'Could not resolve factoring status — held for safety' };
  }
}

module.exports = { resolvePayee };
