/**
 * Payment Validation Tests
 *
 * Tests the paymentValidator service at backend/services/paymentValidator.js.
 * All monetary amounts are in cents (integers).
 */

require('./setup');
const {
  validateAmountCents,
  calculatePlatformFee,
  calculateCarrierPayout,
  validateCurrency,
  centsToDollars,
  dollarsToCents,
  PLATFORM_FEE_RATE,
} = require('../services/paymentValidator');

describe('Payment Validation', () => {
  // ─── validateAmountCents ──────────────────────────────────────────────────

  test('should validate positive integer amounts', () => {
    expect(validateAmountCents(100)).toEqual({ valid: true });
    expect(validateAmountCents(250000)).toEqual({ valid: true }); // $2,500.00
    expect(validateAmountCents(1)).toEqual({ valid: true });
    expect(validateAmountCents(99999999)).toEqual({ valid: true }); // just under $1M
  });

  test('should reject negative amounts', () => {
    const result = validateAmountCents(-100);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('positive');
  });

  test('should reject zero amount', () => {
    const result = validateAmountCents(0);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('positive');
  });

  test('should reject floating point amounts', () => {
    const result = validateAmountCents(100.50);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('integer');
  });

  test('should reject non-number types', () => {
    expect(validateAmountCents('100').valid).toBe(false);
    expect(validateAmountCents(null).valid).toBe(false);
    expect(validateAmountCents(undefined).valid).toBe(false);
    expect(validateAmountCents({}).valid).toBe(false);
  });

  test('should reject amounts exceeding $1,000,000', () => {
    const result = validateAmountCents(100_000_001);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('maximum');
  });

  // ─── calculatePlatformFee ─────────────────────────────────────────────────

  test('should calculate 2% platform fee correctly', () => {
    // $100.00 = 10000 cents -> 2% = 200 cents
    expect(calculatePlatformFee(10000)).toBe(200);

    // $2,500.00 = 250000 cents -> 2% = 5000 cents
    expect(calculatePlatformFee(250000)).toBe(5000);

    // $1.00 = 100 cents -> 2% = 2 cents
    expect(calculatePlatformFee(100)).toBe(2);
  });

  test('should round fractional cents', () => {
    // $33.33 = 3333 cents -> 2% = 66.66 -> rounds to 67
    expect(calculatePlatformFee(3333)).toBe(67);

    // $1.01 = 101 cents -> 2% = 2.02 -> rounds to 2
    expect(calculatePlatformFee(101)).toBe(2);

    // Odd penny: 1 cent -> 2% = 0.02 -> rounds to 0
    expect(calculatePlatformFee(1)).toBe(0);
  });

  test('should use the defined PLATFORM_FEE_RATE of 0.02', () => {
    expect(PLATFORM_FEE_RATE).toBe(0.02);
  });

  // ─── calculateCarrierPayout ───────────────────────────────────────────────

  test('should calculate carrier payout correctly', () => {
    // $100.00: payout = 10000 - 200 = 9800
    expect(calculateCarrierPayout(10000)).toBe(9800);

    // $2,500.00: payout = 250000 - 5000 = 245000
    expect(calculateCarrierPayout(250000)).toBe(245000);
  });

  test('platform fee + carrier payout should equal total', () => {
    const testAmounts = [10000, 250000, 3333, 100, 99999, 50000, 1];

    for (const amount of testAmounts) {
      const fee = calculatePlatformFee(amount);
      const payout = calculateCarrierPayout(amount);
      expect(fee + payout).toBe(amount);
    }
  });

  test('carrier payout should always be less than or equal to total', () => {
    const testAmounts = [1, 100, 10000, 250000, 99999999];
    for (const amount of testAmounts) {
      expect(calculateCarrierPayout(amount)).toBeLessThanOrEqual(amount);
    }
  });

  // ─── validateCurrency ─────────────────────────────────────────────────────

  test('should validate supported currencies', () => {
    expect(validateCurrency('usd')).toBe(true);
    expect(validateCurrency('USD')).toBe(true);
    expect(validateCurrency('Usd')).toBe(true);
  });

  test('should reject unsupported currencies', () => {
    expect(validateCurrency('eur')).toBe(false);
    expect(validateCurrency('gbp')).toBe(false);
    expect(validateCurrency('')).toBe(false);
    expect(validateCurrency(null)).toBe(false);
    expect(validateCurrency(undefined)).toBe(false);
  });

  // ─── centsToDollars / dollarsToCents conversions ──────────────────────────

  test('should convert cents to dollars string correctly', () => {
    expect(centsToDollars(10000)).toBe('100.00');
    expect(centsToDollars(250099)).toBe('2500.99');
    expect(centsToDollars(1)).toBe('0.01');
    expect(centsToDollars(0)).toBe('0.00');
  });

  test('should convert dollars to cents correctly', () => {
    expect(dollarsToCents(100)).toBe(10000);
    expect(dollarsToCents(2500.99)).toBe(250099);
    expect(dollarsToCents(0.01)).toBe(1);
    expect(dollarsToCents(19.99)).toBe(1999);
  });

  test('dollarsToCents should handle floating point edge cases', () => {
    // 19.99 * 100 = 1998.9999... in floating point, Math.round fixes it
    expect(dollarsToCents(19.99)).toBe(1999);
    expect(dollarsToCents(0.1 + 0.2)).toBe(30); // 0.30000...04 * 100 -> 30
  });
});
