/**
 * Platform (contingent) cargo coverage — assessment + decision math.
 *
 * The platform policy backstops a valid claim when the carrier's insurance can't
 * pay. Covered = min(claim, per-claim limit) − deductible, capped by the remaining
 * aggregate. All money is INTEGER CENTS.
 */

const PlatformInsurancePolicy = require('../../models/PlatformInsurancePolicy');
const svc = require('../../services/platformCoverageService');

const $ = (dollars) => Math.round(dollars * 100); // → cents

// A policy instance (methods work without a DB connection).
function policy(overrides = {}) {
  const now = Date.now();
  return new PlatformInsurancePolicy({
    insurer: 'ContingentCargo Co',
    policyNumber: 'PC-1',
    perClaimLimitCents: $(100000),      // $100k per claim
    aggregateLimitCents: $(1000000),    // $1M aggregate
    deductibleCents: $(1000),           // $1k deductible
    aggregateUsedCents: 0,
    effectiveDate: new Date(now - 86400000),
    expiryDate: new Date(now + 86400000 * 300),
    isActive: true,
    ...overrides,
  });
}

const claim = (over = {}) => ({ _id: 'c1', status: 'resolved', amountCents: $(50000), ...over });

describe('platform coverage assessment', () => {
  test('no active policy → ineligible', () => {
    const a = svc.assess(claim(), { policy: null });
    expect(a.eligible).toBe(false);
    expect(a.reasons.join(' ')).toMatch(/no active platform insurance policy/i);
  });

  test('covered = min(claim, per-claim) − deductible, within aggregate', () => {
    const a = svc.assess(claim({ amountCents: $(50000) }), { policy: policy(), carrierInsuranceStatus: 'lapsed' });
    expect(a.eligible).toBe(true);
    expect(a.coveredAmountCents).toBe($(50000) - $(1000)); // 50k claim − 1k deductible
    expect(a.deductibleCents).toBe($(1000));
  });

  test('claim above per-claim limit is capped at the limit (minus deductible)', () => {
    const a = svc.assess(claim({ amountCents: $(250000) }), { policy: policy(), carrierInsuranceStatus: 'lapsed' });
    expect(a.coveredAmountCents).toBe($(100000) - $(1000)); // capped at $100k − $1k
  });

  test('remaining aggregate caps the covered amount', () => {
    const p = policy({ aggregateUsedCents: $(999500) }); // only $500 left
    const a = svc.assess(claim({ amountCents: $(50000) }), { policy: p, carrierInsuranceStatus: 'lapsed' });
    expect(a.remainingAggregateCents).toBe($(500));
    expect(a.coveredAmountCents).toBe($(500));
  });

  test('resolvedAmountCents (approved payout) takes precedence over claimed amount', () => {
    const a = svc.assess(claim({ amountCents: $(80000), resolvedAmountCents: $(30000) }), { policy: policy(), carrierInsuranceStatus: 'unknown' });
    expect(a.coveredAmountCents).toBe($(30000) - $(1000));
  });

  test('withdrawn/denied claims are not eligible', () => {
    expect(svc.assess(claim({ status: 'withdrawn' }), { policy: policy() }).eligible).toBe(false);
    expect(svc.assess(claim({ status: 'denied' }), { policy: policy() }).eligible).toBe(false);
  });

  test('valid carrier insurance adds a "backstop" note (pursue carrier first)', () => {
    const a = svc.assess(claim(), { policy: policy(), carrierInsuranceStatus: 'valid' });
    expect(a.reasons.join(' ')).toMatch(/backstop/i);
  });

  test('policy outside its term is not in force → ineligible', () => {
    const expired = policy({ expiryDate: new Date(Date.now() - 1000) });
    expect(svc.assess(claim(), { policy: expired }).eligible).toBe(false);
  });
});

describe('platform coverage decisions track aggregate usage', () => {
  test('approve commits covered amount to the aggregate', () => {
    const p = policy();
    const c = claim();
    svc.applyDecision(c, p, { action: 'approve', coveredAmountCents: $(49000), deductibleCents: $(1000), adminId: 'admin1' });
    expect(c.platformCoverage.status).toBe('approved');
    expect(c.platformCoverage.coveredAmountCents).toBe($(49000));
    expect(p.aggregateUsedCents).toBe($(49000));
  });

  test('pay marks paid; deny releases previously-committed aggregate', () => {
    const p = policy();
    const c = claim();
    svc.applyDecision(c, p, { action: 'approve', coveredAmountCents: $(49000), adminId: 'a' });
    expect(p.aggregateUsedCents).toBe($(49000));

    svc.applyDecision(c, p, { action: 'pay', coveredAmountCents: $(49000), adminId: 'a', reference: 'CHK-1' });
    expect(c.platformCoverage.status).toBe('paid');
    expect(c.platformCoverage.reference).toBe('CHK-1');
    expect(p.aggregateUsedCents).toBe($(49000)); // unchanged (same amount)

    svc.applyDecision(c, p, { action: 'deny', reason: 'reversed', adminId: 'a' });
    expect(c.platformCoverage.status).toBe('denied');
    expect(p.aggregateUsedCents).toBe(0); // released
  });
});
