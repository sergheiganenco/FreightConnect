/**
 * Contract Monitor Job
 *
 * Runs daily at 08:00.
 * - Warns parties 30 days and 7 days before expiration
 * - Expires contracts past their endDate
 * - Auto-renews contracts with autoRenew = true
 * - Resets volume counters at the start of each new period
 */

const cron     = require('node-cron');
const dayjs    = require('dayjs');
const Contract = require('../models/Contract');
const { generateContractNumber } = require('../utils/contractNumberGenerator');
const { notifyUserSafe }         = require('../utils/notifyUser');

async function runContractMonitor() {
  try {
    const now      = dayjs();
    const in7days  = now.add(7,  'day').toDate();
    const in30days = now.add(30, 'day').toDate();
    const today    = now.toDate();

    // ── 1. Expiration warnings ────────────────────────────────────────────────
    const expiringSoon = await Contract.find({
      status:           'active',
      'terms.endDate':  { $lte: in30days, $gt: today },
    }).lean();

    for (const contract of expiringSoon) {
      const daysLeft = dayjs(contract.terms.endDate).diff(now, 'day');
      const isUrgent = daysLeft <= 7;

      const notifyBoth = async (msg) => {
        notifyUserSafe(contract.shipper.toString(), {
          type:  isUrgent ? 'exception:new' : 'load:status',
          title: isUrgent ? `⚠️ Contract expiring in ${daysLeft} day(s)` : `Contract expiring in ${daysLeft} day(s)`,
          body:  `${contract.contractNumber}: ${contract.title} — ${msg}`,
          link:  '/dashboard/shipper/contracts',
          metadata: { contractId: contract._id },
        });
        for (const ac of contract.assignedCarriers || []) {
          if (ac.status === 'active') {
            notifyUserSafe(ac.carrier.toString(), {
              type:  isUrgent ? 'exception:new' : 'load:status',
              title: isUrgent ? `⚠️ Contract expiring in ${daysLeft} day(s)` : `Contract expiring in ${daysLeft} day(s)`,
              body:  `${contract.contractNumber}: ${contract.title} — ${msg}`,
              link:  '/dashboard/carrier/contracts',
              metadata: { contractId: contract._id },
            });
          }
        }
      };

      if (isUrgent) {
        await notifyBoth('Expires in 7 days or less. Take action now.');
      } else if (!contract._30dayWarnSent) {
        await notifyBoth('Expires in 30 days. Consider renewing.');
        await Contract.findByIdAndUpdate(contract._id, { $set: { _30dayWarnSent: true } });
      }
    }

    // ── 2. Expire contracts past endDate ──────────────────────────────────────
    const expired = await Contract.find({
      status:          'active',
      'terms.endDate': { $lt: today },
    });

    for (const contract of expired) {
      if (contract.terms.autoRenew) {
        // Auto-renew: create a new contract with the same terms, shifted dates
        const newContractNumber = await generateContractNumber();
        const months = contract.terms.autoRenewTermMonths || 12;
        const newStart = dayjs(contract.terms.endDate);
        const newEnd   = newStart.add(months, 'month');

        const newContract = await Contract.create({
          ...contract.toObject(),
          _id:            undefined,
          contractNumber: newContractNumber,
          status:         'active',
          'terms.startDate': newStart.toDate(),
          'terms.endDate':   newEnd.toDate(),
          'performance':  { totalLoadsPosted: 0, totalLoadsCompleted: 0, averageOnTimeRate: 100, averageTenderAcceptRate: 100, totalRevenueCents: 0, claimsCount: 0 },
          'volume.currentPeriodLoadsPosted':    0,
          'volume.currentPeriodLoadsCompleted': 0,
          history: [{ action: 'auto_renewed', details: `Auto-renewed from ${contract.contractNumber}`, timestamp: new Date() }],
        });

        contract.status = 'expired';
        contract.history.push({ action: 'expired', details: `Auto-renewed as ${newContractNumber}` });
        await contract.save();

        notifyUserSafe(contract.shipper.toString(), {
          type:  'load:status',
          title: 'Contract auto-renewed',
          body:  `${contract.contractNumber} expired and was auto-renewed as ${newContractNumber}`,
          link:  '/dashboard/shipper/contracts',
          metadata: { contractId: newContract._id },
        });

        console.log(`[contractMonitor] Auto-renewed ${contract.contractNumber} → ${newContractNumber}`);
      } else {
        contract.status = 'expired';
        contract.history.push({ action: 'expired', details: 'Contract term ended' });
        await contract.save();

        notifyUserSafe(contract.shipper.toString(), {
          type:  'exception:new',
          title: 'Contract expired',
          body:  `${contract.contractNumber}: ${contract.title} has expired. Renew if needed.`,
          link:  '/dashboard/shipper/contracts',
          metadata: { contractId: contract._id },
        });

        for (const ac of contract.assignedCarriers || []) {
          if (ac.status === 'active') {
            notifyUserSafe(ac.carrier.toString(), {
              type:  'exception:new',
              title: 'Contract expired',
              body:  `${contract.contractNumber}: ${contract.title} has expired.`,
              link:  '/dashboard/carrier/contracts',
              metadata: { contractId: contract._id },
            });
          }
        }

        console.log(`[contractMonitor] Expired contract ${contract.contractNumber}`);
      }
    }

    // ── 3. Reset volume counters at start of each period ──────────────────────
    const active = await Contract.find({ status: 'active' });
    for (const contract of active) {
      const periodStart = dayjs(contract.volume.currentPeriodStart || contract.terms.startDate);
      const freq = contract.volume.frequency;
      let periodLengthDays = 7;
      if (freq === 'daily')    periodLengthDays = 1;
      if (freq === 'biweekly') periodLengthDays = 14;
      if (freq === 'monthly')  periodLengthDays = 30;

      const periodEnd = periodStart.add(periodLengthDays, 'day');
      if (now.isAfter(periodEnd)) {
        contract.volume.currentPeriodStart              = now.toDate();
        contract.volume.currentPeriodLoadsPosted        = 0;
        contract.volume.currentPeriodLoadsCompleted     = 0;
        await contract.save();
      }
    }

  } catch (err) {
    console.error('[contractMonitor] Job error:', err.message);
  }
}

function start() {
  // Run daily at 08:00
  cron.schedule('0 8 * * *', runContractMonitor);
  console.log('[contractMonitor] Job scheduled (daily 08:00)');
}

module.exports = { start, runContractMonitor };
