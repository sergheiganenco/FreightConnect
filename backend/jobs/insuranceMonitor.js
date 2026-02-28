const cron = require('node-cron');
const User = require('../models/User');
const emailService = require('../services/emailService');

const EXPIRY_WARNING_DAYS = 30;

async function runInsuranceCheck() {
  console.log('[InsuranceMonitor] Running nightly insurance check...');
  try {
    const carriers = await User.find({
      role: 'carrier',
      'verification.status': 'verified',
    });

    const now = new Date();
    const warnCutoff = new Date(now.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000);

    for (const carrier of carriers) {
      const ins = carrier.verification?.insurance;
      if (!ins) continue;

      const expiryDate =
        ins.cargoLiability?.expiry || ins.autoLiability?.expiry || null;

      if (!expiryDate) continue;

      const expiry = new Date(expiryDate);
      let changed = false;

      if (expiry < now) {
        // Insurance has lapsed
        if (ins.status !== 'lapsed') {
          carrier.verification.insurance.status = 'lapsed';
          carrier.verification.status = 'suspended';
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
        // Insurance expiring soon
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
          if (carrier.verification.status === 'suspended') {
            carrier.verification.status = 'verified';
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
