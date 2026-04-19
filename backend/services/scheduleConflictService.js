/**
 * scheduleConflictService.js — Schedule Conflict Detection
 *
 * Real-world trucking schedule constraints:
 *
 * 1. DRIVE TIME: A carrier can't teleport. If Load A delivers in Chicago at
 *    2 PM and Load B picks up in Dallas at 6 PM, that's impossible —
 *    Chicago to Dallas is ~15 hours of driving.
 *
 * 2. HOS (Hours of Service):
 *    - 11 hours max driving per day
 *    - 14-hour on-duty window (driving + all work)
 *    - 30-minute break required after 8 hours of driving
 *    - 10-hour mandatory off-duty rest between shifts
 *    - 70-hour limit over 8 consecutive days
 *    So a driver who finishes at 8 PM can't start driving until 6 AM next day.
 *
 * 3. LOADING/UNLOADING BUFFER: Assume 2 hours at each facility (industry avg).
 *
 * 4. REAL GAP NEEDED = drive time + unload buffer + possible HOS rest + pickup buffer
 *
 * This service checks all of this when a carrier tries to accept a new load.
 */

const Load = require('../models/Load');

// ── Constants ────────────────────────────────────────────────────────────────
const AVG_SPEED_MPH            = 50;  // loaded truck average including stops
const FACILITY_BUFFER_MINUTES  = 120; // 2 hours per facility (load/unload)
const MAX_DRIVE_PER_DAY_MIN    = 660; // 11 hours
const MANDATORY_REST_MIN       = 600; // 10 hours
const ON_DUTY_WINDOW_MIN       = 840; // 14 hours

/**
 * Estimate straight-line distance in miles between two lat/lng points.
 * Multiply by 1.3 to approximate road distance.
 */
function estimateDistanceMiles(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return null;
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 1.3); // 1.3 factor for road distance
}

/**
 * Estimate realistic travel time including HOS breaks.
 *
 * If drive > 8 hours: add 30-min break
 * If drive > 11 hours: can't do it in one shift — add 10h rest + continue
 */
function estimateTravelMinutes(distanceMiles) {
  if (!distanceMiles || distanceMiles <= 0) return 0;

  const rawDriveMin = Math.round((distanceMiles / AVG_SPEED_MPH) * 60);

  // How many full shifts needed?
  const shiftsNeeded = Math.ceil(rawDriveMin / MAX_DRIVE_PER_DAY_MIN);

  if (shiftsNeeded <= 1) {
    // Single shift
    const breakNeeded = rawDriveMin > 480; // 8 hours = 30-min break
    return rawDriveMin + (breakNeeded ? 30 : 0);
  }

  // Multi-shift: each shift is max 11h drive + 10h rest between
  const restPeriods = shiftsNeeded - 1;
  return rawDriveMin + (restPeriods * MANDATORY_REST_MIN) + (shiftsNeeded * 30); // 30 min break per shift
}

/**
 * Check for schedule conflicts when a carrier wants to accept a new load.
 *
 * Returns an array of conflicts with severity levels:
 *   - "blocking": impossible schedule (overlap or insufficient time)
 *   - "warning": tight schedule, possible but risky
 *   - "info": something to be aware of
 *
 * @param {string} carrierId
 * @param {Object} newLoad - the load being accepted (with pickup/delivery windows + coords)
 * @returns {Promise<{ conflicts: Array, canAccept: boolean, summary: string }>}
 */
async function checkScheduleConflicts(carrierId, newLoad) {
  const conflicts = [];

  // Get all carrier's active loads (accepted or in-transit)
  const existingLoads = await Load.find({
    acceptedBy: carrierId,
    status: { $in: ['accepted', 'in-transit'] },
  }).sort({ 'pickupTimeWindow.start': 1 });

  if (existingLoads.length === 0) {
    return { conflicts: [], canAccept: true, summary: 'No existing loads — schedule is clear.' };
  }

  const newPickupStart = newLoad.pickupTimeWindow?.start ? new Date(newLoad.pickupTimeWindow.start) : null;
  const newPickupEnd   = newLoad.pickupTimeWindow?.end ? new Date(newLoad.pickupTimeWindow.end) : null;
  const newDelivStart  = newLoad.deliveryTimeWindow?.start ? new Date(newLoad.deliveryTimeWindow.start) : null;
  const newDelivEnd    = newLoad.deliveryTimeWindow?.end ? new Date(newLoad.deliveryTimeWindow.end) : null;

  for (const existing of existingLoads) {
    const exPickupStart = existing.pickupTimeWindow?.start ? new Date(existing.pickupTimeWindow.start) : null;
    const exPickupEnd   = existing.pickupTimeWindow?.end ? new Date(existing.pickupTimeWindow.end) : null;
    const exDelivStart  = existing.deliveryTimeWindow?.start ? new Date(existing.deliveryTimeWindow.start) : null;
    const exDelivEnd    = existing.deliveryTimeWindow?.end ? new Date(existing.deliveryTimeWindow.end) : null;

    // ── Check 1: Pickup Time Overlap ──────────────────────────────────────
    if (newPickupStart && newPickupEnd && exPickupStart && exPickupEnd) {
      if (newPickupStart < exPickupEnd && newPickupEnd > exPickupStart) {
        conflicts.push({
          severity: 'blocking',
          type: 'pickup_overlap',
          message: `Pickup window overlaps with "${existing.title}" (${existing.origin}).`,
          existingLoad: { _id: existing._id, title: existing.title },
        });
      }
    }

    // ── Check 2: New pickup during existing load's transit ────────────────
    if (newPickupStart && exPickupStart && exDelivEnd) {
      if (newPickupStart >= exPickupStart && newPickupStart <= exDelivEnd) {
        // New load pickup falls during an existing load's transit period
        if (existing.status === 'in-transit') {
          conflicts.push({
            severity: 'blocking',
            type: 'pickup_during_transit',
            message: `Cannot pick up new load — you're in-transit with "${existing.title}" until ${exDelivEnd.toLocaleDateString()}.`,
            existingLoad: { _id: existing._id, title: existing.title },
          });
        }
      }
    }

    // ── Check 3: Drive time between existing delivery → new pickup ───────
    if (exDelivEnd && newPickupStart) {
      // Is this the most relevant existing load? (delivery before new pickup)
      if (exDelivEnd <= newPickupStart) {
        const distance = estimateDistanceMiles(
          existing.destinationLat, existing.destinationLng,
          newLoad.originLat, newLoad.originLng
        );

        if (distance !== null) {
          const travelMin = estimateTravelMinutes(distance);
          const facilityMin = FACILITY_BUFFER_MINUTES; // unloading at existing + loading at new
          const neededMin = travelMin + facilityMin;

          const availableMin = Math.round((newPickupStart - exDelivEnd) / 60000);

          if (neededMin > availableMin) {
            const shortfall = neededMin - availableMin;
            const hosBreaks = travelMin > MAX_DRIVE_PER_DAY_MIN
              ? Math.floor(travelMin / MAX_DRIVE_PER_DAY_MIN) * (MANDATORY_REST_MIN / 60)
              : 0;

            conflicts.push({
              severity: shortfall > 120 ? 'blocking' : 'warning',
              type: 'insufficient_transit_time',
              message: `After delivering "${existing.title}" in ${existing.destination}, ` +
                       `you need ~${Math.round(neededMin / 60)}h to reach ${newLoad.origin} ` +
                       `(${distance} mi drive + ${facilityMin / 60}h facility time` +
                       `${hosBreaks ? ` + ${hosBreaks}h HOS rest` : ''}) ` +
                       `but only have ${Math.round(availableMin / 60)}h available. ` +
                       `Short by ${Math.round(shortfall / 60)}h.`,
              existingLoad: { _id: existing._id, title: existing.title },
              details: { distance, travelMin, facilityMin, availableMin, shortfall },
            });
          }
        }
      }
    }

    // ── Check 4: New delivery conflicts with next existing pickup ─────────
    if (newDelivEnd && exPickupStart && newDelivEnd > exPickupStart) {
      // New load delivery might push into next load's pickup
      const distance = estimateDistanceMiles(
        newLoad.destinationLat, newLoad.destinationLng,
        existing.originLat, existing.originLng
      );

      if (distance !== null && newDelivEnd <= exPickupStart) {
        const travelMin = estimateTravelMinutes(distance);
        const availableMin = Math.round((exPickupStart - newDelivEnd) / 60000);

        if (travelMin + FACILITY_BUFFER_MINUTES > availableMin) {
          conflicts.push({
            severity: 'warning',
            type: 'delivery_to_next_pickup_tight',
            message: `After delivering this load in ${newLoad.destination}, ` +
                     `you need ~${Math.round((travelMin + FACILITY_BUFFER_MINUTES) / 60)}h to reach "${existing.title}" pickup ` +
                     `in ${existing.origin}, but only have ${Math.round(availableMin / 60)}h.`,
            existingLoad: { _id: existing._id, title: existing.title },
          });
        }
      }
    }
  }

  // ── Check 5: Daily load capacity (more than 2 loads same day = risky) ──
  if (newPickupStart) {
    const sameDayLoads = existingLoads.filter(l => {
      const ps = l.pickupTimeWindow?.start;
      return ps && new Date(ps).toDateString() === newPickupStart.toDateString();
    });
    if (sameDayLoads.length >= 2) {
      conflicts.push({
        severity: 'warning',
        type: 'high_daily_volume',
        message: `You already have ${sameDayLoads.length} loads scheduled for ${newPickupStart.toLocaleDateString()}. Adding another may be unrealistic with HOS limits.`,
      });
    }
  }

  // Determine if carrier can accept
  const hasBlocking = conflicts.some(c => c.severity === 'blocking');

  return {
    conflicts,
    canAccept: !hasBlocking,
    summary: conflicts.length === 0
      ? 'No schedule conflicts detected.'
      : hasBlocking
        ? `${conflicts.length} conflict(s) found — cannot safely accept this load.`
        : `${conflicts.length} warning(s) — review before accepting.`,
  };
}

module.exports = { checkScheduleConflicts, estimateDistanceMiles, estimateTravelMinutes };
