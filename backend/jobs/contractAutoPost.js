/**
 * Contract Auto-Post Job
 *
 * Runs every 15 minutes.
 * For each active contract with autoPost.enabled = true,
 * checks if today is a scheduled posting day and if the postTime has arrived.
 * Creates a Load from the contract's loadTemplate when all conditions are met.
 */

const cron     = require('node-cron');
const dayjs    = require('dayjs');
const utc      = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const Contract = require('../models/Contract');
const Load     = require('../models/Load');
const { notifyUserSafe } = require('../utils/notifyUser');

dayjs.extend(utc);
dayjs.extend(timezone);

async function runAutoPost() {
  try {
    const now = dayjs();

    const contracts = await Contract.find({
      status: 'active',
      'autoPost.enabled': true,
    }).lean();

    for (const contract of contracts) {
      try {
        const tz       = contract.autoPost.schedule?.timezone || 'America/Chicago';
        const nowLocal = dayjs().tz(tz);
        const todayDow = nowLocal.day(); // 0=Sunday … 6=Saturday

        // Check if today is a scheduled day
        const scheduledDays = contract.autoPost.schedule?.daysOfWeek || [];
        if (!scheduledDays.includes(todayDow)) continue;

        // Check if the post time has passed today (within the last 15-minute window)
        const postTime = contract.autoPost.schedule?.postTime; // "HH:mm"
        if (!postTime) continue;
        const [hh, mm]  = postTime.split(':').map(Number);
        const postMoment = nowLocal.hour(hh).minute(mm).second(0);
        const windowStart = postMoment.subtract(15, 'minute');
        if (!nowLocal.isAfter(windowStart) || !nowLocal.isBefore(postMoment.add(1, 'minute'))) continue;

        // Check max loads per period
        const maxLoads = contract.volume.maximumLoadsPerPeriod || Infinity;
        if ((contract.volume.currentPeriodLoadsPosted || 0) >= maxLoads) continue;

        // Check we haven't already posted for this exact window today
        const windowStartDate = windowStart.toDate();
        const alreadyPosted = await Load.exists({
          contractId:  contract._id,
          createdAt:   { $gte: windowStartDate },
        });
        if (alreadyPosted) continue;

        // Build load from template
        const tpl = contract.autoPost.loadTemplate || {};
        const today = nowLocal.format('YYYY-MM-DD');

        const buildTime = (hhmm) => {
          if (!hhmm) return undefined;
          const [h, m] = hhmm.split(':').map(Number);
          return dayjs.tz(`${today} ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`, tz).toDate();
        };

        const load = await Load.create({
          title:         tpl.title || `${contract.contractNumber} — Auto-Posted`,
          origin:        `${contract.lane.origin.city}, ${contract.lane.origin.state}`,
          originLat:     contract.lane.origin.latitude,
          originLng:     contract.lane.origin.longitude,
          destination:   `${contract.lane.destination.city}, ${contract.lane.destination.state}`,
          destinationLat:contract.lane.destination.latitude,
          destinationLng:contract.lane.destination.longitude,
          rate:          contract.pricing.rateCents / 100,
          equipmentType: contract.equipmentType,
          hazardousMaterial: contract.hazardousMaterial,
          loadWeight:    tpl.loadWeight,
          loadDimensions:tpl.loadDimensions,
          commodityType: tpl.commodityType,
          specialInstructions: tpl.specialInstructions,
          pickupTimeWindow: {
            start: buildTime(tpl.pickupTimeWindowStart),
            end:   buildTime(tpl.pickupTimeWindowEnd),
          },
          deliveryTimeWindow: {
            start: buildTime(tpl.deliveryTimeWindowStart),
            end:   buildTime(tpl.deliveryTimeWindowEnd),
          },
          postedBy:        contract.shipper,
          contractId:      contract._id,
          isContractLoad:  true,
          status:          'open',
        });

        // Increment counter
        await Contract.findByIdAndUpdate(contract._id, {
          $inc: {
            'volume.currentPeriodLoadsPosted':    1,
            'performance.totalLoadsPosted':        1,
          },
        });

        // Notify shipper
        notifyUserSafe(contract.shipper.toString(), {
          type:  'load:matched',
          title: 'Contract load auto-posted',
          body:  `${contract.contractNumber}: Load "${load.title}" has been posted`,
          link:  '/dashboard/shipper/contracts',
          metadata: { contractId: contract._id, loadId: load._id },
        });

        // Notify assigned active carriers
        for (const ac of contract.assignedCarriers || []) {
          if (ac.status === 'active') {
            notifyUserSafe(ac.carrier.toString(), {
              type:  'load:matched',
              title: 'New contract load available',
              body:  `${contract.contractNumber}: A new load is ready — ${load.title}`,
              link:  '/dashboard/carrier/loads',
              metadata: { contractId: contract._id, loadId: load._id },
            });
          }
        }

        console.log(`[contractAutoPost] Posted load ${load._id} for contract ${contract.contractNumber}`);
      } catch (contractErr) {
        console.error(`[contractAutoPost] Error processing contract ${contract.contractNumber}:`, contractErr.message);
      }
    }
  } catch (err) {
    console.error('[contractAutoPost] Job error:', err.message);
  }
}

function start() {
  // Run every 15 minutes
  cron.schedule('*/15 * * * *', runAutoPost);
  console.log('[contractAutoPost] Job scheduled (every 15 minutes)');
}

module.exports = { start, runAutoPost };
