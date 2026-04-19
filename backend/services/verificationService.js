/**
 * VerificationService — centralized carrier verification and trust scoring
 *
 * Combines FMCSA verification, insurance checks, ratings, delivery performance,
 * and account metrics into a comprehensive trust score (0-100).
 *
 * Levels:
 *   new       0-20
 *   basic    21-40
 *   verified 41-60
 *   trusted  61-80
 *   elite    81-100
 */

const User = require('../models/User');
const Load = require('../models/Load');
const Rating = require('../models/Rating');
const Exception = require('../models/Exception');
const fmcsaService = require('./fmcsaService');

/**
 * Determine trust level label from numeric score.
 * @param {number} score
 * @returns {string}
 */
function scoreToLevel(score) {
  if (score <= 20) return 'new';
  if (score <= 40) return 'basic';
  if (score <= 60) return 'verified';
  if (score <= 80) return 'trusted';
  return 'elite';
}

class VerificationService {
  /**
   * Check FMCSA status by DOT number.
   * Verifies operating authority is active, checks for out-of-service issues.
   * @param {string} dotNumber
   * @returns {Promise<{verified: boolean, data: object, issues: string[]}>}
   */
  async verifyCarrierFMCSA(dotNumber) {
    const issues = [];

    try {
      const data = await fmcsaService.lookupByDOT(dotNumber);

      if (!data || !data.legalName) {
        return { verified: false, data: null, issues: ['No FMCSA record found for DOT number'] };
      }

      const isAuthorized = fmcsaService.verifyAuthority(data);
      if (!isAuthorized) {
        issues.push(`Operating status is "${data.operatingStatus || 'unknown'}" — not authorized`);
      }

      // Check safety rating if available
      const rating = (data.safetyRating || '').toLowerCase();
      if (rating === 'unsatisfactory') {
        issues.push('Unsatisfactory safety rating');
      }

      return {
        verified: isAuthorized && rating !== 'unsatisfactory',
        data,
        issues,
      };
    } catch (err) {
      return {
        verified: false,
        data: null,
        issues: [`FMCSA lookup failed: ${err.message}`],
      };
    }
  }

  /**
   * Validate that a carrier's insurance is current.
   * @param {string} carrierId — User _id
   * @returns {Promise<{valid: boolean, expiresAt: Date|null, daysRemaining: number, coverage: object}>}
   */
  async checkInsurance(carrierId) {
    try {
      const user = await User.findById(carrierId).select('verification.insurance');
      if (!user || !user.verification || !user.verification.insurance) {
        return { valid: false, expiresAt: null, daysRemaining: 0, coverage: {} };
      }

      const ins = user.verification.insurance;
      const coverage = {
        cargoLiability: ins.cargoLiability || {},
        autoLiability: ins.autoLiability || {},
        status: ins.status || 'unknown',
      };

      // Find earliest expiry across policies
      const expiries = [];
      if (ins.cargoLiability?.expiry) expiries.push(new Date(ins.cargoLiability.expiry));
      if (ins.autoLiability?.expiry) expiries.push(new Date(ins.autoLiability.expiry));

      if (expiries.length === 0) {
        return { valid: false, expiresAt: null, daysRemaining: 0, coverage };
      }

      const earliestExpiry = new Date(Math.min(...expiries));
      const now = new Date();
      const daysRemaining = Math.ceil((earliestExpiry - now) / (1000 * 60 * 60 * 24));

      return {
        valid: daysRemaining > 0 && ins.status !== 'lapsed',
        expiresAt: earliestExpiry,
        daysRemaining: Math.max(0, daysRemaining),
        coverage,
      };
    } catch (err) {
      console.error('[VerificationService.checkInsurance] Error:', err.message);
      return { valid: false, expiresAt: null, daysRemaining: 0, coverage: {} };
    }
  }

  /**
   * Calculate comprehensive trust score (0-100).
   *
   * Components:
   *   - FMCSA verification status:  20 pts
   *   - Insurance validity:          15 pts
   *   - Average rating:              20 pts (scaled 1-5 → 0-20)
   *   - On-time delivery rate:       20 pts
   *   - Dispute/exception rate:      15 pts (inverse — fewer = better)
   *   - Account age:                  5 pts (max at 1 year)
   *   - Profile completeness:         5 pts
   *
   * @param {string} userId
   * @returns {Promise<{score: number, breakdown: object, level: string}>}
   */
  async calculateTrustScore(userId) {
    const user = await User.findById(userId).select(
      'verification trustScore role fleet phone companyName mcNumber dotNumber createdAt'
    );
    if (!user) throw new Error('User not found');

    const breakdown = {};

    // ── 1. FMCSA verification (20 pts) ──────────────────────────────────────
    if (user.verification?.status === 'verified') {
      breakdown.fmcsa = 20;
    } else if (user.verification?.status === 'pending') {
      breakdown.fmcsa = 10;
    } else {
      breakdown.fmcsa = 0;
    }

    // ── 2. Insurance validity (15 pts) ──────────────────────────────────────
    const insurance = await this.checkInsurance(userId);
    if (insurance.valid && insurance.daysRemaining > 30) {
      breakdown.insurance = 15;
    } else if (insurance.valid) {
      breakdown.insurance = 10; // expiring soon
    } else {
      breakdown.insurance = 0;
    }

    // ── 3. Average rating (20 pts) ──────────────────────────────────────────
    const ratingAvg = await Rating.getAverageForUser(userId);
    if (ratingAvg.count > 0) {
      // Scale 1-5 → 0-20
      breakdown.rating = Math.round(((ratingAvg.overall - 1) / 4) * 20);
    } else {
      breakdown.rating = 10; // neutral score for new users
    }

    // ── 4. On-time delivery rate (20 pts) ───────────────────────────────────
    const deliveredLoads = await Load.countDocuments({
      $or: [{ postedBy: userId }, { acceptedBy: userId }],
      status: 'delivered',
    });
    // Loads delivered late (after delivery window end)
    const lateLoads = await Load.countDocuments({
      $or: [{ postedBy: userId }, { acceptedBy: userId }],
      status: 'delivered',
      deliveredAt: { $exists: true },
      'deliveryTimeWindow.end': { $exists: true },
      $expr: { $gt: ['$deliveredAt', '$deliveryTimeWindow.end'] },
    });
    const onTimeRate = deliveredLoads > 0
      ? ((deliveredLoads - lateLoads) / deliveredLoads)
      : 1;
    breakdown.onTime = Math.round(onTimeRate * 20);

    // ── 5. Dispute/exception rate (15 pts, inverse) ─────────────────────────
    const totalLoads = await Load.countDocuments({
      $or: [{ postedBy: userId }, { acceptedBy: userId }],
      status: { $in: ['delivered', 'in-transit', 'accepted'] },
    });
    let exceptionCount = 0;
    try {
      exceptionCount = await Exception.countDocuments({
        $or: [
          { filedBy: userId },
          { loadId: { $in: await Load.find({ acceptedBy: userId }).distinct('_id') } },
        ],
      });
    } catch (_) { /* Exception model may not exist yet */ }

    const exceptionRate = totalLoads > 0 ? exceptionCount / totalLoads : 0;
    // 0% exceptions = 15pts, 50%+ = 0pts
    breakdown.disputes = Math.round(Math.max(0, (1 - exceptionRate * 2)) * 15);

    // ── 6. Account age (5 pts, max at 1 year) ──────────────────────────────
    const accountAgeDays = (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    breakdown.accountAge = Math.min(5, Math.round((accountAgeDays / 365) * 5));

    // ── 7. Profile completeness (5 pts) ─────────────────────────────────────
    let profilePts = 0;
    if (user.phone) profilePts += 1;
    if (user.companyName) profilePts += 1;
    if (user.mcNumber || user.dotNumber) profilePts += 1;
    if (user.fleet && user.fleet.length > 0) profilePts += 1;
    if (user.verification?.status !== 'unverified') profilePts += 1;
    breakdown.profile = profilePts;

    // ── Total ───────────────────────────────────────────────────────────────
    const score = Math.max(0, Math.min(100,
      breakdown.fmcsa +
      breakdown.insurance +
      breakdown.rating +
      breakdown.onTime +
      breakdown.disputes +
      breakdown.accountAge +
      breakdown.profile
    ));

    const level = scoreToLevel(score);

    // Persist to user
    user.trustScore.score = score;
    user.trustScore.lastCalculated = new Date();
    user.trustScore.onTimeRate = Math.round(onTimeRate * 100);
    user.trustScore.totalLoadsCompleted = deliveredLoads;
    await user.save();

    return { score, breakdown, level };
  }

  /**
   * Check if a carrier meets minimum requirements to accept loads.
   * Must have: verified email (implied by signup), FMCSA verified OR pending
   * with valid insurance, at least 1 truck in fleet.
   *
   * @param {object} user — Mongoose user document
   * @returns {{allowed: boolean, reasons: string[]}}
   */
  canAcceptLoads(user) {
    const reasons = [];

    if (user.role !== 'carrier') {
      reasons.push('Only carriers can accept loads');
      return { allowed: false, reasons };
    }

    // FMCSA check
    const vStatus = user.verification?.status;
    if (!vStatus || vStatus === 'unverified' || vStatus === 'rejected' || vStatus === 'suspended') {
      reasons.push('FMCSA verification required (status: ' + (vStatus || 'unverified') + ')');
    }

    // Insurance check (synchronous — uses embedded data)
    const ins = user.verification?.insurance;
    if (vStatus === 'pending') {
      // Pending carriers must have valid insurance
      if (!ins || ins.status !== 'valid') {
        reasons.push('Valid insurance required while verification is pending');
      }
    }

    // Fleet check
    if (!user.fleet || user.fleet.length === 0) {
      reasons.push('At least 1 truck must be registered in your fleet');
    }

    return {
      allowed: reasons.length === 0,
      reasons,
    };
  }
}

module.exports = new VerificationService();
