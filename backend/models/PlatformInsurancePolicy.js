/**
 * PlatformInsurancePolicy — the platform's own contingent cargo insurance policy.
 *
 * This is the "we stand behind the freight" backstop: if a carrier's insurance
 * fails to cover a valid cargo claim, the platform's policy can pay (up to a
 * per-claim limit, subject to a deductible, capped by the aggregate limit).
 *
 * Business reality: the actual coverage/payout comes from a real freight-insurance
 * partner. This model configures the policy terms and TRACKS aggregate usage so
 * the app can compute what it may cover; it does not itself move money.
 *
 * Convention: at most ONE active policy at a time (isActive). All money is
 * INTEGER CENTS.
 */

const mongoose = require('mongoose');

const PlatformInsurancePolicySchema = new mongoose.Schema({
  insurer:        { type: String, required: true },          // underwriting partner
  policyNumber:   { type: String, required: true },
  // Coverage terms (integer cents)
  perClaimLimitCents:   { type: Number, required: true },    // max payout on a single claim
  aggregateLimitCents:  { type: Number, required: true },    // max payout across the policy term
  deductibleCents:      { type: Number, default: 0 },        // subtracted from each covered claim
  // Running total already committed to claims this term (approved/paid).
  aggregateUsedCents:   { type: Number, default: 0 },

  effectiveDate:  { type: Date, required: true },
  expiryDate:     { type: Date, required: true },
  isActive:       { type: Boolean, default: true },

  createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  notes:          { type: String, default: null },
}, { timestamps: true });

// Only one active policy is expected; index for the common "get active" lookup.
PlatformInsurancePolicySchema.index({ isActive: 1, expiryDate: -1 });

/** Remaining aggregate headroom in cents. */
PlatformInsurancePolicySchema.methods.remainingAggregateCents = function () {
  return Math.max(0, (this.aggregateLimitCents || 0) - (this.aggregateUsedCents || 0));
};

/** Is the policy currently in force (active + within its term)? */
PlatformInsurancePolicySchema.methods.inForce = function (at = new Date()) {
  return this.isActive && this.effectiveDate <= at && this.expiryDate > at;
};

/** Fetch the current in-force policy, if any. */
PlatformInsurancePolicySchema.statics.getActive = async function (at = new Date()) {
  const p = await this.findOne({
    isActive: true,
    effectiveDate: { $lte: at },
    expiryDate: { $gt: at },
  }).sort({ expiryDate: -1 });
  return p || null;
};

module.exports = mongoose.model('PlatformInsurancePolicy', PlatformInsurancePolicySchema);
