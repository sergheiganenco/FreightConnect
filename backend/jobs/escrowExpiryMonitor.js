/**
 * Escrow Expiry Monitor
 *
 * Runs every 30 minutes. Finds loads that a carrier accepted but where the
 * shipper never funded escrow, and that have passed the funding deadline.
 * Such loads are reopened back to the board so the carrier isn't hauling on
 * an unfunded promise.
 *
 * For each expired load:
 *   1. Cancel the Stripe payment hold if one exists (guarded — non-fatal).
 *   2. Atomically reopen the load (guarded on status='accepted' + unfunded to
 *      avoid racing a real funding event).
 *   3. Record the transition in StatusHistory (guarded).
 *   4. Notify both the shipper and the (former) carrier.
 *
 * Idempotent + per-item try/catch — one failure does not stop the batch.
 *
 * Configurable via ESCROW_FUND_DEADLINE_HOURS (default 24).
 */

const cron = require('node-cron');
const Load = require('../models/Load');
const { notifyUserSafe } = require('../utils/notifyUser');

const DEADLINE_HOURS = Number(process.env.ESCROW_FUND_DEADLINE_HOURS || 24);

async function runEscrowExpiryCheck() {
  console.log('[EscrowExpiry] Running unfunded-escrow check...');
  try {
    const cutoff = new Date(Date.now() - DEADLINE_HOURS * 3600 * 1000);

    // Loads accepted but escrow never funded.
    const candidates = await Load.find({
      status: 'accepted',
      escrowFunded: { $ne: true },
    }).lean();

    let expired = 0;
    for (const load of candidates) {
      try {
        // Acceptance time: prefer the anti-fraud fingerprint, fall back to updatedAt.
        const acceptedAt = (load.acceptanceFingerprint && load.acceptanceFingerprint.at) || load.updatedAt;
        if (!acceptedAt || new Date(acceptedAt) > cutoff) continue; // not past deadline yet

        // Cancel the Stripe hold if one exists (guarded — must never break the reopen).
        if (load.escrowPaymentIntentId) {
          try {
            const escrowService = require('../services/escrowService');
            if (escrowService && typeof escrowService.cancelHold === 'function') {
              await escrowService.cancelHold(load.escrowPaymentIntentId, 'Escrow not funded within deadline');
            }
          } catch (e) {
            console.warn('[EscrowExpiry] cancelHold failed (non-fatal):', e.message);
          }
        }

        // Atomically reopen the load. The filter re-asserts the current state so a
        // funding event that lands between the find() and this update wins the race.
        const reopened = await Load.findOneAndUpdate(
          { _id: load._id, status: 'accepted', escrowFunded: { $ne: true } },
          {
            $set: {
              status: 'open',
              acceptedBy: null,
              escrowFunded: false,
              escrowPaymentIntentId: null,
              'acceptanceFingerprint.carrierId': null,
              'acceptanceFingerprint.at': null,
              assignedDriverId: null,
              assignedDriverName: null,
            },
          },
          { new: true }
        );
        if (!reopened) continue; // someone funded/changed it in the meantime

        // Record the transition in the audit trail (guarded — non-fatal).
        try {
          const StatusHistory = require('../models/StatusHistory');
          await StatusHistory.record(
            'load',
            load._id,
            'accepted',
            'open',
            null,
            `Auto-reopened: escrow not funded within ${DEADLINE_HOURS}h`
          );
        } catch (_) { /* audit failure must not break reopen */ }

        // Notify the shipper.
        await notifyUserSafe(load.postedBy, {
          type: 'load:escrow_expired',
          title: 'Load reopened — escrow not funded',
          body: `Load "${load.title}" was reopened because escrow wasn't funded within ${DEADLINE_HOURS} hours.`,
          link: '/dashboard/shipper/loads',
          metadata: { loadId: load._id },
        });

        // Notify the (former) carrier.
        if (load.acceptedBy) {
          await notifyUserSafe(load.acceptedBy, {
            type: 'load:escrow_expired',
            title: 'Load released — shipper did not fund escrow',
            body: `Load "${load.title}" was released back to the board because the shipper didn't fund escrow in time.`,
            link: '/dashboard/carrier/loads',
            metadata: { loadId: load._id },
          });
        }

        expired++;
        console.log(`[EscrowExpiry] Reopened load ${load._id} (unfunded ${DEADLINE_HOURS}h+)`);
      } catch (itemErr) {
        console.error(`[EscrowExpiry] Failed for load ${load._id}:`, itemErr.message);
      }
    }

    console.log(`[EscrowExpiry] Check complete. Reopened ${expired} unfunded load(s).`);
  } catch (err) {
    console.error('[EscrowExpiry] Fatal:', err.message);
  }
}

function start() {
  // Every 30 minutes.
  cron.schedule('*/30 * * * *', runEscrowExpiryCheck);
  console.log(`[EscrowExpiry] Scheduled — runs every 30 min (deadline ${DEADLINE_HOURS}h)`);
}

module.exports = { start, runEscrowExpiryCheck };
