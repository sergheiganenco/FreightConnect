/**
 * Load Alert Digest
 *
 * Runs every 4 hours (6 AM, 10 AM, 2 PM, 6 PM, 10 PM, 2 AM).
 * For each carrier with alert preferences set:
 *   - Finds open loads matching their lanes/equipment posted in the last 4 hours
 *   - Sends a digest email with top 5 matching loads
 *   - Updates lastDigestSentAt to prevent duplicates
 *
 * Carriers can also use AlertPreference model for custom lane/equipment filters,
 * or falls back to User.preferences if no AlertPreference record exists.
 */

const cron = require('node-cron');
const Load = require('../models/Load');
const User = require('../models/User');
const AlertPreference = require('../models/AlertPreference');

async function sendDigestEmail(to, subject, html) {
  try {
    const nodemailer = require('nodemailer');
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn('[LoadAlertDigest] Email not configured — skipping send');
      return;
    }
    const transporter = nodemailer.createTransport({
      service: 'Gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      html,
    });
  } catch (err) {
    console.error('[LoadAlertDigest] Email send failed:', err.message);
  }
}

function buildDigestHtml(loads, carrierName) {
  const loadRows = loads.map((load) => {
    const pickupDate = load.pickupTimeWindow?.start
      ? new Date(load.pickupTimeWindow.start).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
        })
      : 'Flexible';

    return `
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 12px 8px; font-size: 14px;">${load.origin} &rarr; ${load.destination}</td>
        <td style="padding: 12px 8px; font-size: 14px; text-align: right;">$${Number(load.rate).toLocaleString()}</td>
        <td style="padding: 12px 8px; font-size: 14px; text-align: center;">${load.equipmentType}</td>
        <td style="padding: 12px 8px; font-size: 14px; text-align: center;">${pickupDate}</td>
      </tr>`;
  }).join('');

  const appUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: 'Inter', Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        <div style="background: linear-gradient(135deg, #1976d2, #1565c0); padding: 24px; text-align: center;">
          <h1 style="color: #fff; margin: 0; font-size: 22px;">FreightConnect Load Alert</h1>
        </div>
        <div style="padding: 24px;">
          <p style="font-size: 16px; color: #333;">Hi ${carrierName},</p>
          <p style="font-size: 14px; color: #555; line-height: 1.6;">
            <strong>${loads.length} new load${loads.length !== 1 ? 's' : ''}</strong> matching your lane preferences
            ${loads.length !== 1 ? 'have' : 'has'} been posted in the last 4 hours.
            Here are the top matches:
          </p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <thead>
              <tr style="background: #f8f9fa;">
                <th style="padding: 10px 8px; text-align: left; font-size: 12px; text-transform: uppercase; color: #666;">Lane</th>
                <th style="padding: 10px 8px; text-align: right; font-size: 12px; text-transform: uppercase; color: #666;">Rate</th>
                <th style="padding: 10px 8px; text-align: center; font-size: 12px; text-transform: uppercase; color: #666;">Equipment</th>
                <th style="padding: 10px 8px; text-align: center; font-size: 12px; text-transform: uppercase; color: #666;">Pickup</th>
              </tr>
            </thead>
            <tbody>
              ${loadRows}
            </tbody>
          </table>
          <div style="text-align: center; margin: 24px 0;">
            <a href="${appUrl}/dashboard/carrier/loads"
               style="display: inline-block; padding: 12px 32px; background: #1976d2; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">
              View Load Board
            </a>
          </div>
          <p style="font-size: 12px; color: #999; text-align: center; margin-top: 24px;">
            You can adjust your alert preferences in your carrier dashboard settings.<br>
            &copy; ${new Date().getFullYear()} FreightConnect
          </p>
        </div>
      </div>
    </body>
    </html>`;
}

/**
 * Check if a load's origin or destination matches a lane specification.
 * Uses case-insensitive substring matching on city/state names.
 */
function laneMatches(load, lane) {
  const originLower = (load.origin || '').toLowerCase();
  const destLower = (load.destination || '').toLowerCase();
  const laneOriginLower = (lane.origin || '').toLowerCase();
  const laneDestLower = (lane.destination || '').toLowerCase();

  const originMatch = !laneOriginLower || originLower.includes(laneOriginLower);
  const destMatch = !laneDestLower || destLower.includes(laneDestLower);

  return originMatch && destMatch;
}

async function runDigest() {
  console.log('[LoadAlertDigest] Running load alert digest...');
  const now = new Date();
  const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  let emailsSent = 0;

  try {
    // Get all carriers
    const carriers = await User.find({ role: 'carrier' }).select('name email preferences');

    for (const carrier of carriers) {
      try {
        // Check for AlertPreference record (takes precedence)
        const alertPref = await AlertPreference.findOne({ user: carrier._id });

        // Determine email settings
        const emailEnabled = alertPref ? alertPref.emailEnabled : true;
        const frequency = alertPref ? alertPref.emailFrequency : '4hours';

        // Skip if email is disabled or frequency is 'never'
        if (!emailEnabled || frequency === 'never') continue;

        // Skip if frequency is 'daily' (handled by a different schedule)
        if (frequency === 'daily') continue;

        // Skip if digest was already sent recently (within 3.5 hours to allow for cron drift)
        const lastSent = alertPref?.lastDigestSentAt;
        if (lastSent && frequency === '4hours') {
          const minGap = 3.5 * 60 * 60 * 1000; // 3.5 hours
          if (now.getTime() - new Date(lastSent).getTime() < minGap) continue;
        }

        // Determine lanes and equipment from AlertPreference or User.preferences
        const lanes = alertPref?.lanes?.length ? alertPref.lanes : (carrier.preferences?.preferredLanes || []);
        const equipment = alertPref?.equipment?.length ? alertPref.equipment : (carrier.preferences?.equipmentTypes || []);
        const minRate = alertPref?.minRate || carrier.preferences?.minRate || 0;

        // Skip carriers with no lane or equipment preferences
        if (lanes.length === 0 && equipment.length === 0) continue;

        // Build load query
        const loadFilter = {
          status: 'open',
          createdAt: { $gte: fourHoursAgo },
        };

        if (equipment.length > 0) {
          loadFilter.equipmentType = { $in: equipment };
        }

        if (minRate > 0) {
          loadFilter.rate = { $gte: minRate };
        }

        // Fetch candidate loads
        const candidateLoads = await Load.find(loadFilter)
          .sort({ rate: -1 })
          .limit(50)
          .lean();

        // Filter by lane matching if lanes are specified
        let matchingLoads = candidateLoads;
        if (lanes.length > 0) {
          matchingLoads = candidateLoads.filter((load) =>
            lanes.some((lane) => laneMatches(load, lane))
          );
        }

        if (matchingLoads.length === 0) continue;

        // Take top 5
        const topLoads = matchingLoads.slice(0, 5);

        // Send digest email
        const subject = `${matchingLoads.length} new load${matchingLoads.length !== 1 ? 's' : ''} match your lanes - FreightConnect`;
        const html = buildDigestHtml(topLoads, carrier.name || 'Carrier');

        await sendDigestEmail(carrier.email, subject, html);
        emailsSent++;

        // Update lastDigestSentAt
        if (alertPref) {
          alertPref.lastDigestSentAt = now;
          await alertPref.save();
        } else {
          // Create an AlertPreference record to track when we last sent
          await AlertPreference.findOneAndUpdate(
            { user: carrier._id },
            { $set: { lastDigestSentAt: now } },
            { upsert: true }
          );
        }
      } catch (carrierErr) {
        console.error(`[LoadAlertDigest] Error processing carrier ${carrier._id}:`, carrierErr.message);
      }
    }

    console.log(`[LoadAlertDigest] Digest complete. Sent ${emailsSent} email(s).`);
  } catch (err) {
    console.error('[LoadAlertDigest] Fatal error:', err);
  }
}

function start() {
  // Run every 4 hours: 6 AM, 10 AM, 2 PM, 6 PM, 10 PM, 2 AM
  cron.schedule('0 2,6,10,14,18,22 * * *', runDigest);
  console.log('[LoadAlertDigest] Scheduled — runs every 4 hours (2,6,10,14,18,22)');
}

module.exports = { start, runDigest };
