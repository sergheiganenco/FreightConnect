/**
 * shipperVerificationService.js — Multi-step shipper verification
 *
 * Real-world context:
 *   - Anyone can claim to be a "shipper" — scammers post fake loads to collect
 *     carrier info, or post loads they can't pay for
 *   - Verification levels determine what a shipper can do:
 *
 *   Level 0 (unverified): Can browse, can't post loads
 *   Level 1 (email verified): Free email = warning flag; business domain = +trust
 *   Level 2 (payment method): Card/bank on file → can post loads (escrow required for first 3)
 *   Level 3 (business verified): EIN checked, docs uploaded → full platform access
 *   Level 4 (admin verified): Manual review complete → preferred status, higher limits
 *
 * Free email domains (gmail, yahoo, etc.) aren't blocked — many owner-operators
 * who also ship use personal email. But it's a trust signal shown to carriers.
 */

const User = require('../models/User');

// ── Known free email providers ──────────────────────────────────────────────
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'mail.com', 'protonmail.com', 'zoho.com', 'yandex.com',
  'live.com', 'msn.com', 'me.com', 'inbox.com', 'gmx.com',
]);

/**
 * Check if an email is from a free provider.
 * Business domains (e.g., john@acmefreight.com) get a trust boost.
 */
function checkEmailDomain(email) {
  if (!email) return { domain: null, isFreeEmail: null };
  const domain = email.split('@')[1]?.toLowerCase();
  return {
    domain,
    isFreeEmail: FREE_EMAIL_DOMAINS.has(domain),
  };
}

/**
 * Basic EIN format validation (XX-XXXXXXX).
 * We can't verify against IRS without a paid API, but we can:
 *   1. Validate format
 *   2. Reject known-invalid prefixes (00, 07, 08, 09, 17, 19, 28, 29, 49, 69, 70, 78, 79, 89)
 *   3. Flag for admin review
 */
function validateEIN(ein) {
  if (!ein) return { valid: false, reason: 'EIN is required' };

  // Strip dashes and spaces
  const cleaned = ein.replace(/[-\s]/g, '');
  if (!/^\d{9}$/.test(cleaned)) {
    return { valid: false, reason: 'EIN must be 9 digits (format: XX-XXXXXXX)' };
  }

  // Known invalid prefixes per IRS
  const prefix = cleaned.substring(0, 2);
  const invalidPrefixes = ['00', '07', '08', '09', '17', '19', '28', '29', '49', '69', '70', '78', '79', '89'];
  if (invalidPrefixes.includes(prefix)) {
    return { valid: false, reason: 'Invalid EIN prefix — this is not a valid IRS-issued number' };
  }

  return {
    valid: true,
    masked: `${prefix}-***${cleaned.slice(-4)}`, // Only store masked version
    prefix,
  };
}

/**
 * Assess shipper verification level based on what's been completed.
 * Returns a level 0-4 and what's missing for the next level.
 */
function assessVerificationLevel(user) {
  const sv = user.shipperVerification || {};
  const steps = {
    emailVerified:   !!sv.emailDomainVerified || sv.emailDomain !== undefined,
    paymentMethod:   !!sv.paymentMethodVerified,
    businessIdentity: !!sv.einVerified || !!sv.businessVerified,
    adminApproved:   sv.status === 'verified',
  };

  let level = 0;
  if (steps.emailVerified) level = 1;
  if (steps.emailVerified && steps.paymentMethod) level = 2;
  if (steps.emailVerified && steps.paymentMethod && steps.businessIdentity) level = 3;
  if (steps.adminApproved) level = 4;

  const missing = [];
  if (!steps.emailVerified) missing.push('Email domain check');
  if (!steps.paymentMethod) missing.push('Add a payment method (credit card or bank account)');
  if (!steps.businessIdentity) missing.push('Verify business identity (EIN or business license)');
  if (!steps.adminApproved && level >= 3) missing.push('Awaiting admin review for full verification');

  // Determine what the shipper can do at this level
  const permissions = {
    canBrowseLoads: true,
    canPostLoads: level >= 2,  // Need payment method
    escrowRequired: level < 3 || sv.firstLoadEscrowRequired,
    maxActiveLoads: level >= 4 ? 999 : level >= 3 ? 50 : level >= 2 ? 10 : 0,
    canUsePreferredCarriers: level >= 3,
    canUseContracts: level >= 4,
  };

  return { level, steps, missing, permissions, status: sv.status || 'unverified' };
}

/**
 * Run email domain check and persist to user.
 */
async function runEmailDomainCheck(userId) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const { domain, isFreeEmail } = checkEmailDomain(user.email);

  if (!user.shipperVerification) user.shipperVerification = {};
  user.shipperVerification.emailDomain = domain;
  user.shipperVerification.isFreeEmail = isFreeEmail;
  user.shipperVerification.emailDomainVerified = true;

  // Auto-upgrade status from unverified to pending
  if (user.shipperVerification.status === 'unverified') {
    user.shipperVerification.status = 'pending';
  }

  await user.save();
  return { domain, isFreeEmail };
}

/**
 * Submit EIN for verification.
 * We validate format and store masked. Admin reviews for full verification.
 */
async function submitEIN(userId, ein, businessName, stateOfIncorporation, businessType) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const einResult = validateEIN(ein);
  if (!einResult.valid) {
    return { success: false, error: einResult.reason };
  }

  if (!user.shipperVerification) user.shipperVerification = {};
  user.shipperVerification.ein = einResult.masked;
  user.shipperVerification.einVerified = true; // Format validated (not IRS-verified)
  user.shipperVerification.businessName = businessName || user.companyName;
  user.shipperVerification.stateOfIncorporation = stateOfIncorporation || '';
  user.shipperVerification.businessType = businessType || null;
  user.shipperVerification.businessVerified = true;

  // Upgrade status
  if (['unverified', 'pending'].includes(user.shipperVerification.status)) {
    user.shipperVerification.status = 'pending';
  }

  await user.save();
  return { success: true, masked: einResult.masked };
}

/**
 * Record payment method on file (called after Stripe customer setup).
 */
async function recordPaymentMethod(userId, stripeCustomerId, last4, type) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  if (!user.shipperVerification) user.shipperVerification = {};
  user.shipperVerification.paymentMethodVerified = true;
  user.shipperVerification.stripeCustomerId = stripeCustomerId;
  user.shipperVerification.paymentMethodLast4 = last4;
  user.shipperVerification.paymentMethodType = type;

  if (user.shipperVerification.status === 'unverified') {
    user.shipperVerification.status = 'pending';
  }

  await user.save();
  return { paymentMethodVerified: true, last4 };
}

module.exports = {
  checkEmailDomain,
  validateEIN,
  assessVerificationLevel,
  runEmailDomainCheck,
  submitEIN,
  recordPaymentMethod,
  FREE_EMAIL_DOMAINS,
};
