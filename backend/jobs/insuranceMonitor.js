const cron = require('node-cron');
const User = require('../models/User');
const emailService = require('../services/emailService');
const fmcsaService = require('../services/fmcsaService');

const EXPIRY_WARNING_DAYS = 30;

/**
 * A suspension can come from insurance, the FMCSA authority monitor, fraud
 * detection, the review queue, or an admin. Insurance renewal must only
 * reverse an INSURANCE suspension (verification.suspensionReason), and even
 * then only when the recorded FMCSA data is still clean — otherwise renewing
 * a COI would resurrect a revoked/unsatisfactory or fraud-suspended carrier.
 */
function fmcsaStillClean(carrier) {
  const fmcsa = carrier.verification?.fmcsaData;
  if (!fmcsa || !fmcsa.operatingStatus) return true; // nothing recorded to hold against them
  try {
    if (!fmcsaService.verifyAuthority(fmcsa)) return false;
    if (String(fmcsa.safetyRating || '').toLowerCase() === 'unsatisfactory') return false;
    return true;
  } catch (_) {
    return true; // never let a helper error strand a carrier in suspension
  }
}

function mayRestoreFromInsurance(carrier) {
  return (
    carrier.verification.status === 'suspended' &&
    carrier.verification.suspensionReason === 'insurance' &&
    fmcsaStillClean(carrier)
  );
}

async function runInsuranceCheck() {
  console.log('[InsuranceMonitor] Running nightly insurance check...');
  try {
    // Include suspended carriers: a carrier this job suspended must be seen
    // again on later runs or the restore branch below is unreachable.
    const carriers = await User.find({
      role: 'carrier',
      'verification.status': { $in: ['verified', 'suspended'] },
    });

    const now = new Date();
    const warnCutoff = new Date(now.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000);

    for (const carrier of carriers) {
      const ins = carrier.verification?.insurance;
      if (!ins) continue;

      // Earliest expiry across policies — a valid cargo policy must not mask
      // an expired auto-liability policy (mirrors antiFraudGuard).
      const expiries = [ins.cargoLiability?.expiry, ins.autoLiability?.expiry]
        .filter(Boolean)
        .map((d) => new Date(d))
        .filter((d) => !isNaN(d.getTime()));
      if (expiries.length === 0) continue;
      const expiry = new Date(Math.min(...expiries.map((d) => d.getTime())));
      let changed = false;

      if (expiry < now) {
        // Insurance has lapsed
        if (ins.status !== 'lapsed') {
          carrier.verification.insurance.status = 'lapsed';
          carrier.verification.status = 'suspended';
          carrier.verification.suspensionReason = 'insurance';
          changed = true;

          try {
            await emailService.sendEmail({
              to: carrier.email,
              subject: 'FreightConnect — Insurance Lapsed',
              html: `
                <p>Hi ${carrier.name},</p>
                <p>Your insurance on file has expired. Your account has been suspended and you cannot accept new loads until your insurance is updated and verified.</p>
                <p>Please upload a current Certificate of Insurance in your profile to restore your account.</p>
              `,
            });
          } catch (emailErr) {
            console.error('[InsuranceMonitor] Email error:', emailErr.message);
          }
        }
      } else if (expiry < warnCutoff) {
        // Insurance expiring soon — but currently VALID, so a carrier we
        // suspended for lapsed insurance who renewed into this window gets
        // their account back (suspension would otherwise never lift).
        if (mayRestoreFromInsurance(carrier)) {
          carrier.verification.status = 'verified';
          carrier.verification.suspensionReason = null;
          changed = true;
        }
        if (ins.status !== 'expiring') {
          carrier.verification.insurance.status = 'expiring';
          changed = true;

          const daysLeft = Math.ceil((expiry - now) / (24 * 60 * 60 * 1000));
          try {
            await emailService.sendEmail({
              to: carrier.email,
              subject: `FreightConnect — Insurance Expiring in ${daysLeft} Days`,
              html: `
                <p>Hi ${carrier.name},</p>
                <p>Your insurance on file expires in <strong>${daysLeft} days</strong> on ${expiry.toLocaleDateString()}.</p>
                <p>Please update your Certificate of Insurance in your profile before it lapses to avoid account suspension.</p>
              `,
            });
          } catch (emailErr) {
            console.error('[InsuranceMonitor] Email error:', emailErr.message);
          }
        }
      } else {
        // Insurance is valid — restore if previously lapsed/expiring
        if (ins.status === 'lapsed' || ins.status === 'expiring') {
          carrier.verification.insurance.status = 'valid';
          if (mayRestoreFromInsurance(carrier)) {
            carrier.verification.status = 'verified';
            carrier.verification.suspensionReason = null;
          }
          changed = true;
        }
      }

      carrier.verification.insurance.lastChecked = now;
      if (changed) {
        await carrier.save();
        console.log(`[InsuranceMonitor] Updated ${carrier.email}: ${ins.status}`);
      }
    }

    console.log(`[InsuranceMonitor] Check complete. Processed ${carriers.length} carriers.`);
  } catch (err) {
    console.error('[InsuranceMonitor] Error:', err);
  }
}

function start() {
  // Run nightly at 2:00 AM
  cron.schedule('0 2 * * *', runInsuranceCheck);
  console.log('[InsuranceMonitor] Scheduled — runs nightly at 2:00 AM');
}

module.exports = { start, runInsuranceCheck };
