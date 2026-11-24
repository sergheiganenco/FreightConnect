const cron = require('node-cron');
const User = require('../models/User');
const fmcsaService = require('../services/fmcsaService');
const emailService = require('../services/emailService');
const { notifyUserSafe } = require('../utils/notifyUser');

/**
 * FMCSA authority re-verification monitor.
 *
 * Brokers have been held liable for tendering loads to carriers with lapsed
 * authority — verification at onboarding alone is not the defensible standard,
 * continuous monitoring is. This job re-checks every verified carrier's FMCSA
 * operating authority + safety rating and suspends accounts that are no longer
 * authorized (the accept/bid gates read verification.status, so suspension
 * blocks new bookings immediately).
 *
 * Failure semantics:
 *  - API unavailable / network error / no key → SKIP (fail-open on availability; never
 *    mass-suspend because the FMCSA API is down or no key is configured).
 *  - Invalid DOT / no such carrier / record for a different DOT → counted per carrier;
 *    3 in a row suspend with reason 'fmcsa_unconfirmed' (a matched check resets the
 *    count and lifts only that suspension). Only the FMCSA-confirmed DOT is used.
 *  - Affirmative negative (record found, not authorized, or unsatisfactory
 *    safety rating) → suspend + email + in-app notification.
 * Restoration is deliberately NOT automatic: the carrier re-runs verification
 * (POST /api/verification/carrier/start) or an admin overrides.
 */

const UNCONFIRMED = 'fmcsa_unconfirmed';
const FAILURE_LIMIT = 3; // consecutive unconfirmed results before we stop treating the carrier as bookable
const digits = (v) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');

// → { outcome: 'outage' } (never counts) | { outcome: 'failure', reason } | { outcome: 'ok', data }
async function lookupConfirmed(dot) {
  let data;
  try {
    data = await fmcsaService.lookupByDOT(dot);
  } catch (err) {
    // Only an input we can prove is bad counts; everything else is an outage.
    return err.code === 'INVALID_INPUT' ? { outcome: 'failure', reason: 'invalid DOT number' } : { outcome: 'outage' };
  }
  if (!data || !data.legalName) return { outcome: 'failure', reason: 'no FMCSA record for this DOT' };
  // The record must be for the DOT we asked about — never take another company's data.
  if (!digits(data.dotNumber) || digits(data.dotNumber) !== digits(dot)) {
    return { outcome: 'failure', reason: 'FMCSA record did not match the DOT' };
  }
  return { outcome: 'ok', data };
}

function authorityVerdict(data) {
  const issues = [];
  const authorized = fmcsaService.verifyAuthority(data);
  if (!authorized) issues.push(`Operating status is "${data.operatingStatus || 'unknown'}" — not authorized`);
  const rating = (data.safetyRating || '').toString().trim().toLowerCase();
  const unsat = rating === 'u' || rating === 'unsatisfactory';
  if (unsat) issues.push('Unsatisfactory safety rating');
  if (data.outOfService) issues.push('Carrier is under an out-of-service order');
  return { verified: authorized && !unsat, issues };
}

// Count an unconfirmed result; at FAILURE_LIMIT move a verified carrier to the
// non-bookable 'suspended' state (reason-scoped) and notify once. Returns true if suspended now.
async function recordFailure(carrier, reason) {
  const v = carrier.verification;
  v.fmcsaFailures = (v.fmcsaFailures || 0) + 1;
  v.fmcsaLastFailure = { at: new Date(), reason };
  const suspendNow = v.status === 'verified' && v.fmcsaFailures >= FAILURE_LIMIT;
  if (suspendNow) {
    v.status = 'suspended';
    v.suspensionReason = UNCONFIRMED;
  }
  await carrier.save();
  if (suspendNow) {
    const body = `We could not confirm your FMCSA record (${reason}) in ${FAILURE_LIMIT} consecutive checks. Re-run verification from your profile to restore your account.`;
    try {
      await emailService.sendEmail({
        to: carrier.email,
        subject: 'FreightConnect — Account Suspended (FMCSA record not confirmed)',
        html: `<p>Hi ${carrier.name},</p><p>${body}</p>`,
      });
    } catch (emailErr) {
      console.error('[FmcsaMonitor] Email error (non-fatal):', emailErr.message);
    }
    await notifyUserSafe(carrier._id.toString(), {
      type: 'verification:suspended',
      title: 'Account suspended — FMCSA record not confirmed',
      body,
      link: '/dashboard/carrier/verification',
      metadata: { reason: UNCONFIRMED, failure: reason },
    });
  }
  return suspendNow;
}

async function runFmcsaCheck() {
  console.log('[FmcsaMonitor] Running FMCSA authority re-check...');
  let checked = 0;
  let suspended = 0;
  try {
    // Also re-check carriers WE parked as 'fmcsa_unconfirmed' so a later match lifts it.
    const carriers = await User.find({
      role: 'carrier',
      $or: [
        { 'verification.status': 'verified' },
        { 'verification.status': 'suspended', 'verification.suspensionReason': UNCONFIRMED },
      ],
    }).select('name email verification carrierEndorsements');

    for (const carrier of carriers) {
      try {
        const v = carrier.verification;
        // Only the FMCSA-confirmed DOT is trusted. Carriers verified before it was stored
        // get ONE confirmation attempt with the number used at verification time; the
        // editable profile dotNumber is never consulted.
        const confirmedDot = v.fmcsaData?.dotNumber;
        const dot = confirmedDot || v.dotNumber;

        const found = dot ? await lookupConfirmed(dot) : { outcome: 'failure', reason: 'no DOT number to confirm' };
        if (found.outcome === 'outage') continue; // API down / no key: never changes anything
        checked += 1;
        if (found.outcome === 'failure') {
          console.warn(`[FmcsaMonitor] Carrier ${carrier._id} unconfirmed: ${found.reason}`);
          if (await recordFailure(carrier, found.reason)) suspended += 1;
          continue;
        }
        const data = found.data;
        const result = authorityVerdict(data);

        // Matched: reset the counter, lift ONLY our own suspension (authority is
        // re-evaluated just below, so a revoked carrier is re-suspended for that).
        v.fmcsaFailures = 0;
        v.fmcsaLastFailure = undefined;
        if (v.status === 'suspended' && v.suspensionReason === UNCONFIRMED) {
          v.status = 'verified';
          v.suspensionReason = null;
        }

        // Record what FMCSA said (audit trail either way); this also stores the
        // confirmed numbers for carriers that had none.
        carrier.verification.fmcsaData = {
          ...(carrier.verification.fmcsaData?.toObject?.() || carrier.verification.fmcsaData || {}),
          dotNumber: String(data.dotNumber),
          mcNumber: data.mcNumber ? String(data.mcNumber) : v.fmcsaData?.mcNumber,
          legalName: v.fmcsaData?.legalName || data.legalName,
          operatingStatus: data.operatingStatus,
          safetyRating: data.safetyRating,
          forHireAuthority: data.forHireAuthority,
          lastChecked: new Date(),
        };

        if (!result.verified) {
          // Affirmative negative: revoked authority or unsatisfactory rating
          carrier.verification.status = 'suspended';
          carrier.verification.suspensionReason = 'fmcsa_authority';
          suspended += 1;
          console.warn(`[FmcsaMonitor] Suspending ${carrier.email}: ${result.issues.join('; ')}`);

          try {
            await emailService.sendEmail({
              to: carrier.email,
              subject: 'FreightConnect — Account Suspended (FMCSA Authority)',
              html: `
                <p>Hi ${carrier.name},</p>
                <p>Our routine FMCSA check found an issue with your operating authority:</p>
                <p><strong>${result.issues.join('<br/>')}</strong></p>
                <p>Your account has been suspended and you cannot accept new loads. Once the issue is resolved with FMCSA, re-run verification from your profile to restore your account.</p>
              `,
            });
          } catch (emailErr) {
            console.error('[FmcsaMonitor] Email error (non-fatal):', emailErr.message);
          }

          await notifyUserSafe(carrier._id.toString(), {
            type: 'verification:suspended',
            title: 'Account suspended — FMCSA authority issue',
            body: result.issues.join('; '),
            link: '/dashboard/carrier/verification',
            metadata: { issues: result.issues },
          });
        }

        // Insurance on file is re-read every night as well. It used to be read once, at onboarding,
        // so a policy cancelled afterwards went unnoticed. A lapse blocks booking (antiFraudGuard reads
        // verification.insurance) and clears itself on the first night the record is good again.
        try {
          const ins = await require('../services/insuranceService').verifyInsurance(data, {
            hazmat: (carrier.carrierEndorsements || []).includes('hazmat'),
          });
          const cur = v.insurance || {};
          const better = ['vendor', 'manual'].includes(cur.source); // a certificate with real expiry dates
          const fields = {
            cargoLiability: ins.cargoLiability || {}, autoLiability: ins.autoLiability || {},
            status: ins.status, source: ins.source,
            meetsFederalMinimum: ins.meetsFederalMinimum, requiredMinimum: ins.requiredMinimum, lastChecked: ins.lastChecked,
          };
          if (ins.source !== 'fmcsa') {
            // A configured certificate vendor answered: it is the best source, so its result stands.
            if (ins.status !== 'unknown') carrier.verification.insurance = { ...fields, fmcsaLapsedAt: cur.fmcsaLapsedAt || null };
          } else if (ins.status === 'lapsed') {
            // The federal record says a required policy is missing: this always applies. A certificate's
            // own details (amounts, expiry dates) are kept; only the status and the marker change.
            const first = !cur.fmcsaLapsedAt;
            if (better) {
              carrier.verification.insurance.status = 'lapsed';
              carrier.verification.insurance.fmcsaLapsedAt = cur.fmcsaLapsedAt || new Date();
              carrier.verification.insurance.lastChecked = ins.lastChecked;
            } else {
              carrier.verification.insurance = { ...fields, fmcsaLapsedAt: cur.fmcsaLapsedAt || new Date() };
            }
            if (first) {
              console.warn(`[FmcsaMonitor] Insurance no longer on file for carrier ${carrier._id}`);
              await notifyUserSafe(carrier._id.toString(), {
                type: 'verification:insurance_lapsed',
                title: 'Insurance no longer on file with FMCSA',
                body: `${(ins.reasons || []).join(' ')} You cannot book loads until your insurer files it with FMCSA. This is checked again every night.`,
                link: '/dashboard/carrier/verification',
                metadata: { priority: 'high' },
              });
            }
          } else if (ins.status === 'valid') {
            // Good on the federal record. That lifts only the federal lapse marker. It never turns a
            // certificate's status to valid: with a vendor or manual source the status stays as it is
            // until the nightly expiry check (jobs/insuranceMonitor) confirms it from the certificate.
            if (better) carrier.verification.insurance.fmcsaLapsedAt = null;
            else carrier.verification.insurance = { ...fields, fmcsaLapsedAt: null };
          }
        } catch (insErr) {
          console.error(`[FmcsaMonitor] insurance re-check failed for ${carrier._id} (non-fatal):`, insErr.message);
        }

        await carrier.save();
        // Gentle pacing — don't burst the FMCSA API across a large fleet list
        await new Promise((r) => setTimeout(r, 300));
      } catch (itemErr) {
        console.error(`[FmcsaMonitor] Failed for carrier ${carrier._id}:`, itemErr.message);
        // Continue processing other carriers
      }
    }

    console.log(`[FmcsaMonitor] Check complete. ${checked} checked, ${suspended} suspended.`);
  } catch (err) {
    console.error('[FmcsaMonitor] Fatal error:', err.message);
  }
}

function start() {
  // Nightly at 2:30 AM — after insuranceMonitor (2:00) so the two never interleave
  cron.schedule('30 2 * * *', runFmcsaCheck);
  console.log('[FmcsaMonitor] Scheduled — runs nightly at 2:30 AM');
}

module.exports = { start, runFmcsaCheck };
