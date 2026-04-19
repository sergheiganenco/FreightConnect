/**
 * detentionService.js — Detention fee calculation & cascade impact
 *
 * Real-world trucking logic:
 *   - Free time: typically 2 hours at pickup AND 2 hours at delivery
 *   - After free time: $50-100/hour (industry standard, contract can override)
 *   - Detention doesn't just cost money — it cascades:
 *       • If a driver spends 6 hours at a facility (4 hours detention),
 *         and their next pickup is 4 hours away by driving,
 *         they may also trigger a mandatory 10-hour HOS rest break
 *       • Total impact: 4h detention + 10h HOS rest = 14 hours behind schedule
 *   - TONU (Truck Ordered Not Used): shipper cancels after driver arrives → flat fee
 */

const DwellEvent = require('../models/DwellEvent');
const Load       = require('../models/Load');
const Contract   = require('../models/Contract');
const { notifyUserSafe } = require('../utils/notifyUser');

// ── HOS constants (FMCSA) ────────────────────────────────────────────────────
const MAX_DRIVE_MINUTES     = 660;  // 11 hours
const MAX_ON_DUTY_MINUTES   = 840;  // 14-hour window
const MANDATORY_REST_MIN    = 600;  // 10-hour off-duty
const BREAK_AFTER_DRIVE_MIN = 480;  // 30-min break required after 8h driving

// ── Default rates ────────────────────────────────────────────────────────────
const DEFAULT_FREE_MINUTES       = 120;  // 2 hours
const DEFAULT_DETENTION_RATE_CPH = 7500; // $75/hour in cents

/**
 * Calculate detention fee from a dwell event.
 * Uses contract rates if available, otherwise defaults.
 */
function calculateDetention(dwellMinutes, freeMinutes, rateCentsPerHour) {
  const detentionMinutes = Math.max(0, dwellMinutes - freeMinutes);
  const detentionHours   = detentionMinutes / 60;
  const feeCents         = Math.round(detentionHours * rateCentsPerHour);
  return { detentionMinutes, feeCents };
}

/**
 * Get detention rates from contract, or use defaults.
 */
async function getDetentionRates(loadId) {
  const load = await Load.findById(loadId).select('contractId');
  if (load?.contractId) {
    const contract = await Contract.findById(load.contractId)
      .select('pricing.accessorialRates');
    if (contract?.pricing?.accessorialRates) {
      return {
        freeMinutes: (contract.pricing.accessorialRates.detentionFreeHours || 2) * 60,
        rateCentsPerHour: contract.pricing.accessorialRates.detentionPerHourCents || DEFAULT_DETENTION_RATE_CPH,
      };
    }
  }
  return { freeMinutes: DEFAULT_FREE_MINUTES, rateCentsPerHour: DEFAULT_DETENTION_RATE_CPH };
}

/**
 * Assess cascade impact on the carrier's next load.
 *
 * Real-world scenario:
 *   Driver finishes unloading at Facility A at 4:00 PM (was supposed to leave at 2:00 PM).
 *   Next load pickup at Facility B is at 8:00 AM tomorrow, 5 hours drive away.
 *   Driver has already driven 6 hours today.
 *   Remaining drive capacity: 11 - 6 = 5 hours. Can they make it?
 *   If detention pushes their on-duty clock past 14 hours, they MUST take 10h rest first.
 *
 * @param {ObjectId} carrierId
 * @param {Date} departureTime - when driver actually leaves current facility
 * @param {number} hoursAlreadyDrivenToday - from ELD or estimate
 * @returns {{ nextLoad, delayMinutes, hosRestRequired, totalImpactMin }}
 */
async function assessCascadeImpact(carrierId, departureTime, hoursAlreadyDrivenToday = 0) {
  // Find the carrier's next accepted load (by pickup time, not yet in-transit)
  const nextLoad = await Load.findOne({
    acceptedBy: carrierId,
    status: 'accepted',
    'pickupTimeWindow.start': { $gt: departureTime },
  })
    .sort({ 'pickupTimeWindow.start': 1 })
    .select('title origin destination pickupTimeWindow originLat originLng');

  if (!nextLoad) return { nextLoad: null, delayMinutes: 0, hosRestRequired: false, totalImpactMin: 0 };

  const pickupAt = new Date(nextLoad.pickupTimeWindow.start);
  const availableMinutes = (pickupAt - departureTime) / 60000;

  // Rough drive time estimate: we'd need routing API for exact, but
  // use straight-line distance * 1.3 factor / 55 mph average
  // For now, return what we know and let the frontend show the risk
  const minutesDrivenToday = (hoursAlreadyDrivenToday || 0) * 60;
  const remainingDriveMin  = MAX_DRIVE_MINUTES - minutesDrivenToday;

  // If on-duty window is nearly exhausted, HOS rest is mandatory
  const hosRestRequired = remainingDriveMin < 120; // less than 2 hours left to drive
  const hosRestMinutes  = hosRestRequired ? MANDATORY_REST_MIN : 0;

  // Estimate: does the carrier have enough time?
  // Available time = gap between departure and next pickup
  // Needed time = estimated drive + possible rest
  const bufferMinutes = availableMinutes - hosRestMinutes;

  // If buffer is negative, next load is at risk
  const estimatedDelayMin = bufferMinutes < 0 ? Math.abs(Math.round(bufferMinutes)) : 0;
  const totalImpactMin = estimatedDelayMin + hosRestMinutes;

  return {
    nextLoad: {
      _id: nextLoad._id,
      title: nextLoad.title,
      origin: nextLoad.origin,
      pickupAt: nextLoad.pickupTimeWindow.start,
    },
    estimatedDelayMin,
    hosRestRequired,
    hosRestMinutes,
    totalImpactMin,
    status: estimatedDelayMin > 0 ? 'at_risk' : 'none',
  };
}

/**
 * Update a dwell event's detention calculation and cascade impact.
 * Called whenever a timestamp is updated (check-in, dock-in, etc.)
 */
async function recalculateDwellEvent(eventId) {
  const event = await DwellEvent.findById(eventId);
  if (!event) return null;

  // Calculate dwell time
  const end   = event.departedAt || new Date();
  const start = event.arrivedAt;
  if (!start) return event;

  const dwellMinutes = Math.round((end - start) / 60000);

  // Get rates
  const rates = await getDetentionRates(event.load);
  const { detentionMinutes, feeCents } = calculateDetention(
    dwellMinutes, rates.freeMinutes, rates.rateCentsPerHour
  );

  event.dwellMinutes       = dwellMinutes;
  event.freeMinutes        = rates.freeMinutes;
  event.detentionMinutes   = detentionMinutes;
  event.detentionRateCents = rates.rateCentsPerHour;
  event.detentionFeeCents  = feeCents;

  // If driver hasn't left yet and detention just started, notify both parties
  if (!event.departedAt && detentionMinutes > 0 && detentionMinutes <= 5) {
    const load = await Load.findById(event.load).select('title postedBy');
    notifyUserSafe(event.carrier, {
      type: 'detention_started',
      title: 'Detention Time Started',
      body: `Free time exceeded at ${event.facilityName || event.stopType}. Detention accruing at $${(rates.rateCentsPerHour / 100).toFixed(0)}/hr.`,
      link: `/dashboard/carrier/my-loads`,
    });
    if (load?.postedBy) {
      notifyUserSafe(load.postedBy, {
        type: 'detention_started',
        title: 'Detention Alert',
        body: `Carrier waiting at ${event.facilityName || event.stopType} for "${load.title}". Free time exceeded — detention charges accruing.`,
        link: `/dashboard/shipper/loads`,
      });
    }
  }

  // Assess cascade impact if driver departed
  if (event.departedAt) {
    const cascade = await assessCascadeImpact(event.carrier, event.departedAt);
    if (cascade.nextLoad) {
      event.nextLoadId = cascade.nextLoad._id;
      event.nextLoadImpact = {
        originalPickupAt:  cascade.nextLoad.pickupAt,
        estimatedDelayMin: cascade.estimatedDelayMin,
        hosRestRequired:   cascade.hosRestRequired,
        hosRestMinutes:    cascade.hosRestMinutes,
        totalImpactMin:    cascade.totalImpactMin,
        status:            cascade.status,
      };

      // Alert carrier if their next load is at risk
      if (cascade.status === 'at_risk') {
        notifyUserSafe(event.carrier, {
          type: 'schedule_cascade',
          title: 'Next Load At Risk',
          body: `Detention delay may cause you to miss pickup for "${cascade.nextLoad.title}". Estimated impact: ${cascade.totalImpactMin} min${cascade.hosRestRequired ? ' (includes mandatory 10h HOS rest)' : ''}.`,
          link: `/dashboard/carrier/my-loads`,
        });
      }
    }
  }

  await event.save();
  return event;
}

/**
 * Get facility reputation stats (average dwell time, detention frequency).
 * This is what builds shipper confidence — carriers can see if a facility
 * has a reputation for long waits before accepting a load.
 */
async function getFacilityStats(facilityName) {
  if (!facilityName) return null;

  const pipeline = [
    { $match: { facilityName, departedAt: { $ne: null } } },
    {
      $group: {
        _id: '$stopType',
        avgDwellMin:       { $avg: '$dwellMinutes' },
        avgDetentionMin:   { $avg: '$detentionMinutes' },
        totalEvents:       { $sum: 1 },
        detentionEvents:   { $sum: { $cond: [{ $gt: ['$detentionMinutes', 0] }, 1, 0] } },
        avgDetentionFee:   { $avg: { $cond: [{ $gt: ['$detentionFeeCents', 0] }, '$detentionFeeCents', null] } },
        maxDwellMin:       { $max: '$dwellMinutes' },
      },
    },
  ];

  const results = await DwellEvent.aggregate(pipeline);
  const stats = {};
  for (const r of results) {
    stats[r._id] = {
      avgDwellMinutes:     Math.round(r.avgDwellMin),
      avgDetentionMinutes: Math.round(r.avgDetentionMin),
      totalEvents:         r.totalEvents,
      detentionFrequency:  r.totalEvents > 0 ? Math.round((r.detentionEvents / r.totalEvents) * 100) : 0,
      avgDetentionFeeCents: Math.round(r.avgDetentionFee || 0),
      maxDwellMinutes:     r.maxDwellMin,
    };
  }

  return { facilityName, stats };
}

module.exports = {
  calculateDetention,
  getDetentionRates,
  assessCascadeImpact,
  recalculateDwellEvent,
  getFacilityStats,
  DEFAULT_FREE_MINUTES,
  DEFAULT_DETENTION_RATE_CPH,
};
