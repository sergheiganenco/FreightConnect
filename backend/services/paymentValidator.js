/**
 * Payment Validation Utilities
 *
 * All monetary amounts are in cents (integers).
 * Never use floating-point arithmetic for money.
 */

const { PLATFORM_FEE_PCT: PLATFORM_FEE_RATE } = require('../config/fees'); // single source of truth
const SUPPORTED_CURRENCIES = ['usd'];

/**
 * Validate that an amount is a positive integer (cents).
 * @param {*} amount - Value to validate
 * @returns {{ valid: boolean, error?: string }}
 */
function validateAmountCents(amount) {
  if (typeof amount !== 'number') {
    return { valid: false, error: 'Amount must be a number' };
  }
  if (!Number.isInteger(amount)) {
    return { valid: false, error: 'Amount must be an integer (cents). Do not use decimals.' };
  }
  if (amount <= 0) {
    return { valid: false, error: 'Amount must be a positive integer' };
  }
  if (amount > 100_000_000) { // $1,000,000 sanity cap
    return { valid: false, error: 'Amount exceeds maximum allowed ($1,000,000)' };
  }
  return { valid: true };
}

/**
 * Calculate platform fee from a gross amount in cents.
 * Uses Math.round to avoid fractional cents.
 * @param {number} amountCents - Gross amount in cents
 * @returns {number} Fee in cents
 */
function calculatePlatformFee(amountCents) {
  return Math.round(amountCents * PLATFORM_FEE_RATE);
}

/**
 * Calculate carrier payout (gross minus platform fee) in cents.
 * @param {number} amountCents - Gross amount in cents
 * @returns {number} Carrier payout in cents
 */
function calculateCarrierPayout(amountCents) {
  return amountCents - calculatePlatformFee(amountCents);
}

/**
 * Validate a currency code.
 * @param {string} currency - Currency code (e.g. 'usd')
 * @returns {boolean}
 */
function validateCurrency(currency) {
  return SUPPORTED_CURRENCIES.includes(currency?.toLowerCase());
}

/**
 * Format cents to a display-friendly dollar string.
 * @param {number} cents - Amount in cents
 * @returns {string} e.g. "1234.56"
 */
function centsToDollars(cents) {
  return (cents / 100).toFixed(2);
}

/**
 * Convert a dollar amount (Number) to cents.
 * Rounds to avoid floating-point issues (e.g. 19.99 * 100 = 1998.9999...).
 * @param {number} dollars - Amount in dollars
 * @returns {number} Amount in cents (integer)
 */
function dollarsToCents(dollars) {
  return Math.round(dollars * 100);
}

module.exports = {
  validateAmountCents,
  calculatePlatformFee,
  calculateCarrierPayout,
  validateCurrency,
  centsToDollars,
  dollarsToCents,
  PLATFORM_FEE_RATE,
  SUPPORTED_CURRENCIES,
};
