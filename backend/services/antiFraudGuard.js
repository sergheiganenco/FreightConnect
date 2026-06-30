const User = require('../models/User');
const Load = require('../models/Load');

/**
 * Anti-fraud guard for broker-free freight marketplace.
 * Prevents double-brokering, identity mismatch, and suspicious acceptance patterns.
 *
 * The #1 fraud in modern freight is double-brokering (a carrier accepts a load then
 * re-brokers it to an unvetted third party) and carrier identity theft (using a
 * stolen MC/DOT number). This module enforces hard blocks for unverified identity
 * and lapsed insurance, and emits soft riskFlags for monitoring.
 */

// Rapid-fire acceptance window + threshold (possible bot / double-broker harvesting)
const RAPID_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RAPID_THRESHOLD = 10;             // > 10 accepts in the window is suspicious

let verificationService = null;
try {
  // Reuse the centralized check if it is available
  verificationService = require('./verificationService');
} catch (_) {
  verificationService = null;
}

/**
 * Record the identity/device fingerprint of whoever accepts a load and decide
 * whether the acceptance is allowed.
 *
 * @param {Object}   params
 * @param {Object}   params.load    - The load being accepted (Mongoose doc or lean)
 * @param {Object}   params.carrier - The carrier User document
 * @param {Object}   params.req     - The Express request (for device fingerprint)
 * @returns {Promise<{allowed: boolean, reasons: string[], riskFlags: string[], fingerprint: Object}>}
 */
async function evaluateAcceptance({ load, carrier, req }) {
  const reasons = [];
  const riskFlags = [];
  const fingerprint = buildFingerprint(req, carrier ? carrier._id : null);

  try {
    if (!carrier) {
      reasons.push('Carrier account not found');
      return { allowed: false, reasons, riskFlags, fingerprint };
    }

    // ── 1. Identity + insurance hard checks ───────────────────────────────
    // Prefer the centralized verificationService.canAcceptLoads when available.
    let identityHandled = false;
    if (verificationService && typeof verificationService.canAcceptLoads === 'function') {
      try {
        const result = verificationService.canAcceptLoads(carrier);
        identityHandled = true;
        if (result && result.allowed === false) {
          for (const r of (result.reasons || [])) reasons.push(r);
        }
      } catch (svcErr) {
        console.error('[antiFraudGuard] canAcceptLoads failed, falling back to inline checks:', svcErr.message);
        identityHandled = false;
      }
    }

    if (!identityHandled) {
      // Inline fallback: verification status must be 'verified', OR 'pending' with
      // insurance on file. Anything else is a hard block (no stolen MC numbers).
      const vStatus = carrier.verification?.status;
      const ins = carrier.verification?.insurance;
      if (vStatus === 'verified') {
        // ok
      } else if (vStatus === 'pending') {
        if (!ins || ins.status !== 'valid') {
          reasons.push('Valid insurance required while carrier verification is pending');
        }
      } else {
        reasons.push('FMCSA verification required (status: ' + (vStatus || 'unverified') + ')');
      }
    }

    // ── 1b. Stolen MC number guard ────────────────────────────────────────
    // If FMCSA recorded an MC number on the verification, the carrier must still
    // carry it. A blank/mismatched MC on a "verified" record is a hard block.
    const fmcsaMc = carrier.verification?.fmcsaData?.mcNumber || carrier.verification?.mcNumber;
    if (carrier.verification?.fmcsaData?.mcNumber && !fmcsaMc) {
      reasons.push('Carrier MC number is missing from verified FMCSA record (possible identity theft)');
    }

    // ── 2. Insurance expiry hard check ────────────────────────────────────
    const ins = carrier.verification?.insurance;
    if (ins) {
      if (ins.status === 'lapsed') {
        reasons.push('Insurance has lapsed — update your Certificate of Insurance before accepting loads');
      } else {
        const expiries = [];
        if (ins.cargoLiability?.expiry) expiries.push(new Date(ins.cargoLiability.expiry));
        if (ins.autoLiability?.expiry) expiries.push(new Date(ins.autoLiability.expiry));
        if (expiries.length > 0) {
          const earliest = new Date(Math.min(...expiries.map((d) => d.getTime())));
          if (!isNaN(earliest.getTime()) && earliest.getTime() <= Date.now()) {
            reasons.push('Insurance policy has expired — update your Certificate of Insurance before accepting loads');
          }
        }
      }
    }

    // ── 3. Rapid-fire acceptance detection (soft flag) ────────────────────
    try {
      const since = new Date(Date.now() - RAPID_WINDOW_MS);
      const recentAccepts = await Load.countDocuments({
        acceptedBy: carrier._id,
        updatedAt: { $gte: since },
        status: { $in: ['accepted', 'in-transit', 'delivered'] },
      });
      if (recentAccepts > RAPID_THRESHOLD) {
        riskFlags.push('rapid_acceptance');
      }
    } catch (countErr) {
      console.error('[antiFraudGuard] rapid-acceptance count failed (non-fatal):', countErr.message);
    }

    // ── 4. Identity-confidence soft flags ─────────────────────────────────
    if (carrier.verification?.identityVerified === false) {
      riskFlags.push('identity_not_confirmed');
    }
    if (!fingerprint.ip || fingerprint.ip === 'unknown') {
      riskFlags.push('missing_ip_fingerprint');
    }

    return {
      allowed: reasons.length === 0,
      reasons,
      riskFlags,
      fingerprint,
    };
  } catch (err) {
    console.error('[antiFraudGuard] evaluateAcceptance failed:', err.message);
    // Fail closed on identity safety: if we cannot evaluate, do not allow acceptance.
    return {
      allowed: false,
      reasons: ['Unable to verify carrier eligibility right now. Please try again.'],
      riskFlags: ['evaluation_error'],
      fingerprint,
    };
  }
}

/**
 * Build the device/identity fingerprint to store on the load for audit +
 * double-broker detection.
 *
 * @param {Object} req       - Express request
 * @param {string} carrierId - The accepting carrier's user id
 * @returns {{carrierId: any, ip: string, userAgent: string, at: Date}}
 */
function buildFingerprint(req, carrierId) {
  let ip = 'unknown';
  let userAgent = 'unknown';
  try {
    const headers = (req && req.headers) || {};
    const rawIp = headers['x-forwarded-for'] || (req && req.ip) || '';
    ip = rawIp.toString().split(',')[0].trim() || 'unknown';
    userAgent = headers['user-agent'] || 'unknown';
  } catch (_) {
    /* keep defaults */
  }
  return {
    carrierId: carrierId || null,
    ip,
    userAgent,
    at: new Date(),
  };
}

/**
 * Detect potential double-brokering: the account uploading POD / marking the load
 * delivered MUST be the same account that accepted the load.
 *
 * @param {Object} load          - The load document
 * @param {string} actingUserId  - The user performing the action
 * @returns {{ok: boolean, reason?: string}}
 */
function verifyHaulerMatchesAcceptor(load, actingUserId) {
  try {
    if (!load || !load.acceptedBy) {
      return { ok: false, reason: 'Load has no accepting carrier' };
    }
    if (String(load.acceptedBy) !== String(actingUserId)) {
      return {
        ok: false,
        reason: 'Acting user is not the carrier who accepted this load (possible double-brokering)',
      };
    }
    return { ok: true };
  } catch (err) {
    console.error('[antiFraudGuard] verifyHaulerMatchesAcceptor failed:', err.message);
    return { ok: false, reason: 'Unable to verify hauler identity' };
  }
}

module.exports = { evaluateAcceptance, buildFingerprint, verifyHaulerMatchesAcceptor };
