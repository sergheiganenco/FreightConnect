/**
 * platformCoverageService — decide what the platform's contingent cargo policy
 * may cover on a claim, and apply admin decisions (tracking aggregate usage).
 *
 * The platform backstop is intended for when the respondent CARRIER's insurance
 * can't/won't pay a valid claim. All money is INTEGER CENTS.
 */

/**
 * Assess how much the platform policy could cover for a claim.
 * @param {object} claim   - Claim doc (uses resolvedAmountCents ?? amountCents)
 * @param {object} ctx     - { policy, carrierInsuranceStatus }
 * @returns {{ eligible, coveredAmountCents, deductibleCents, perClaimLimitCents,
 *            remainingAggregateCents, carrierInsuranceStatus, reasons }}
 */
function assess(claim, { policy, carrierInsuranceStatus } = {}) {
  const reasons = [];
  const claimAmount = claim?.resolvedAmountCents ?? claim?.amountCents ?? 0;

  if (!policy) {
    return { eligible: false, coveredAmountCents: 0, deductibleCents: 0, perClaimLimitCents: 0,
      remainingAggregateCents: 0, carrierInsuranceStatus: carrierInsuranceStatus || 'unknown',
      reasons: ['No active platform insurance policy configured.'] };
  }
  if (!policy.inForce()) {
    reasons.push('Platform policy is not in force (inactive or outside its term).');
  }
  if (['withdrawn', 'denied'].includes(claim?.status)) {
    reasons.push(`Claim status "${claim.status}" is not eligible for coverage.`);
  }
  if (claimAmount <= 0) {
    reasons.push('Claim has no approved/claimed amount to cover.');
  }
  // The backstop exists for carriers whose own insurance is insufficient.
  if (carrierInsuranceStatus && carrierInsuranceStatus === 'valid') {
    reasons.push("Carrier's own insurance is valid — pursue their policy first (platform coverage is a backstop).");
  }

  const deductibleCents = policy.deductibleCents || 0;
  const remainingAggregateCents = policy.remainingAggregateCents();
  // Covered = min(claim, per-claim limit) − deductible, capped by remaining aggregate.
  const beforeDeductible = Math.min(claimAmount, policy.perClaimLimitCents || 0);
  const afterDeductible = Math.max(0, beforeDeductible - deductibleCents);
  const coveredAmountCents = Math.max(0, Math.min(afterDeductible, remainingAggregateCents));

  if (coveredAmountCents === 0 && reasons.length === 0) {
    reasons.push('Computed coverage is $0 (deductible or aggregate limit exhausts it).');
  }

  const eligible = policy.inForce()
    && !['withdrawn', 'denied'].includes(claim?.status)
    && claimAmount > 0
    && coveredAmountCents > 0;

  return {
    eligible,
    coveredAmountCents,
    deductibleCents,
    perClaimLimitCents: policy.perClaimLimitCents || 0,
    remainingAggregateCents,
    carrierInsuranceStatus: carrierInsuranceStatus || 'unknown',
    reasons,
  };
}

/**
 * Apply an admin coverage decision to a claim, tracking aggregate usage.
 * @param {object} claim   - Claim doc (mutated, not saved)
 * @param {object} policy  - PlatformInsurancePolicy doc (mutated, not saved)
 * @param {object} decision - { action: 'approve'|'deny'|'pay', coveredAmountCents,
 *                              deductibleCents, reason, reference, adminId }
 * @returns {{ claim, policy }}
 */
function applyDecision(claim, policy, decision) {
  const pc = claim.platformCoverage || {};
  const prevCommitted = ['approved', 'paid'].includes(pc.status) ? (pc.coveredAmountCents || 0) : 0;

  if (decision.action === 'deny') {
    // Release any previously-committed aggregate.
    if (prevCommitted && policy) policy.aggregateUsedCents = Math.max(0, (policy.aggregateUsedCents || 0) - prevCommitted);
    claim.platformCoverage = {
      ...pc, status: 'denied', policyId: policy?._id || pc.policyId || null,
      reason: decision.reason || pc.reason || null, decidedBy: decision.adminId || null, decidedAt: new Date(),
    };
    return { claim, policy };
  }

  // approve / pay
  const covered = decision.coveredAmountCents || 0;
  // Adjust the running aggregate by the delta vs whatever was previously committed.
  if (policy) policy.aggregateUsedCents = Math.max(0, (policy.aggregateUsedCents || 0) - prevCommitted + covered);

  claim.platformCoverage = {
    status: decision.action === 'pay' ? 'paid' : 'approved',
    policyId: policy?._id || null,
    coveredAmountCents: covered,
    deductibleCents: decision.deductibleCents ?? pc.deductibleCents ?? (policy?.deductibleCents || 0),
    reason: decision.reason || pc.reason || null,
    reference: decision.reference || pc.reference || null,
    decidedBy: decision.adminId || null,
    decidedAt: new Date(),
  };
  return { claim, policy };
}

module.exports = { assess, applyDecision };
