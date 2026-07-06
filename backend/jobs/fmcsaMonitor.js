const cron = require('node-cron');
const User = require('../models/User');
const verificationService = require('../services/verificationService');
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
 *  - API unavailable / lookup error → SKIP (fail-open on availability; never
 *    mass-suspend because the FMCSA API is down or no key is configured).
 *  - Affirmative negative (record found, not authorized, or unsatisfactory
 *    safety rating) → suspend + email + in-app notification.
 * Restoration is deliberately NOT automatic: the carrier re-runs verification
 * (POST /api/verification/carrier/start) or an admin overrides.
 */

async function runFmcsaCheck() {
  console.log('[FmcsaMonitor] Running FMCSA authority re-check...');
  let checked = 0;
  let suspended = 0;
  try {
    const carriers = await User.find({
      role: 'carrier',
      'verification.status': 'verified',
    }).select('name email dotNumber verification');

    for (const carrier of carriers) {
      try {
        const dot = carrier.verification?.dotNumber || carrier.dotNumber;
        if (!dot) continue; // nothing to re-check against

        const result = await verificationService.verifyCarrierFMCSA(dot);
        checked += 1;

        // Availability failure or no data → skip, never suspend on a flaky API
        if (!result.data) continue;

        // Record what FMCSA said (audit trail either way)
        carrier.verification.fmcsaData = {
          ...(carrier.verification.fmcsaData?.toObject?.() || carrier.verification.fmcsaData || {}),
          operatingStatus: result.data.operatingStatus,
          safetyRating: result.data.safetyRating,
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
