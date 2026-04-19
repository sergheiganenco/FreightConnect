/**
 * geofenceService.js — Geofenced Auto Check-in / Check-out
 *
 * Detects when a carrier enters or leaves a pickup/delivery facility geofence.
 * On entry: auto-creates a DwellEvent (check-in).
 * On exit: sets departedAt and triggers detention recalculation.
 *
 * Call checkGeofence(carrierId, latitude, longitude) from the
 * socket 'updateCarrierLocation' handler in app.js.
 */

const Load       = require('../models/Load');
const DwellEvent = require('../models/DwellEvent');
const { recalculateDwellEvent } = require('./detentionService');
const { notifyUserSafe }       = require('../utils/notifyUser');
const { getIO }                = require('../utils/socket');

// ── Configuration ────────────────────────────────────────────────────────────
const GEOFENCE_RADIUS_METERS = 500;   // 0.3 miles ~ 483m, rounding to 500
const EARTH_RADIUS_METERS    = 6_371_000;

/**
 * Haversine distance in meters between two lat/lng points.
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Check if a point is within the geofence radius of a facility.
 */
function isWithinGeofence(carrierLat, carrierLng, facilityLat, facilityLng, radiusMeters = GEOFENCE_RADIUS_METERS) {
  if (carrierLat == null || carrierLng == null || facilityLat == null || facilityLng == null) {
    return false;
  }
  const distance = haversineDistance(carrierLat, carrierLng, facilityLat, facilityLng);
  return distance <= radiusMeters;
}

/**
 * Build the list of facility check-points for a load.
 * Each entry has: type ('pickup'|'delivery'), lat, lng, facilityName, facilityAddress, stopIndex
 */
function getFacilityCheckpoints(load) {
  const checkpoints = [];

  // Multi-stop loads: use stops array
  if (load.stops && load.stops.length > 0) {
    for (let i = 0; i < load.stops.length; i++) {
      const stop = load.stops[i];
      if (stop.lat != null && stop.lng != null) {
        checkpoints.push({
          type: stop.type,
          lat: stop.lat,
          lng: stop.lng,
          facilityName: stop.contactName || '',
          facilityAddress: stop.address || '',
          stopIndex: i,
        });
      }
    }
    return checkpoints;
  }

  // Standard load: origin (pickup) and destination (delivery)
  if (load.originLat != null && load.originLng != null) {
    checkpoints.push({
      type: 'pickup',
      lat: load.originLat,
      lng: load.originLng,
      facilityName: load.pickupFacilityName || '',
      facilityAddress: load.pickupAddress || load.origin || '',
      stopIndex: 0,
    });
  }

  if (load.destinationLat != null && load.destinationLng != null) {
    checkpoints.push({
      type: 'delivery',
      lat: load.destinationLat,
      lng: load.destinationLng,
      facilityName: load.deliveryFacilityName || '',
      facilityAddress: load.deliveryAddress || load.destination || '',
      stopIndex: 0,
    });
  }

  return checkpoints;
}

/**
 * Main geofence check — called on every carrier location update.
 *
 * @param {string} carrierId  - The carrier's user ID
 * @param {number} latitude   - Carrier's current GPS latitude
 * @param {number} longitude  - Carrier's current GPS longitude
 * @returns {Object} { checkedIn: [], checkedOut: [] } - arrays of DwellEvent IDs affected
 */
async function checkGeofence(carrierId, latitude, longitude) {
  if (!carrierId || latitude == null || longitude == null) return { checkedIn: [], checkedOut: [] };

  const result = { checkedIn: [], checkedOut: [] };

  try {
    // Find all active loads for this carrier
    const activeLoads = await Load.find({
      acceptedBy: carrierId,
      status: { $in: ['accepted', 'in-transit'] },
    }).select(
      '_id postedBy origin destination originLat originLng destinationLat destinationLng ' +
      'pickupFacilityName pickupAddress deliveryFacilityName deliveryAddress stops'
    );

    if (activeLoads.length === 0) return result;

    for (const load of activeLoads) {
      const checkpoints = getFacilityCheckpoints(load);

      for (const cp of checkpoints) {
        const within = isWithinGeofence(latitude, longitude, cp.lat, cp.lng);

        // Find existing open dwell event for this load + stop
        const existingEvent = await DwellEvent.findOne({
          load: load._id,
          carrier: carrierId,
          stopType: cp.type,
          stopIndex: cp.stopIndex,
          departedAt: null, // still on-site (no departure yet)
        });

        if (within && !existingEvent) {
          // ── ENTER geofence: auto-check-in ────────────────────────────
          const dwellEvent = await DwellEvent.create({
            load: load._id,
            carrier: carrierId,
            shipper: load.postedBy,
            stopType: cp.type,
            stopIndex: cp.stopIndex,
            facilityName: cp.facilityName,
            facilityAddress: cp.facilityAddress,
            arrivedAt: new Date(),
          });

          result.checkedIn.push(dwellEvent._id);

          // Notify shipper
          await notifyUserSafe(load.postedBy, {
            type: 'geofence_checkin',
            title: `Carrier arrived at ${cp.type} facility`,
            body: `Auto check-in at ${cp.facilityName || cp.facilityAddress || cp.type}. ` +
                  `Dwell time tracking started.`,
            link: '/dashboard/shipper/loads',
            metadata: { loadId: load._id, dwellEventId: dwellEvent._id, stopType: cp.type },
          });

          // Notify carrier
          await notifyUserSafe(carrierId, {
            type: 'geofence_checkin',
            title: `Checked in at ${cp.type} facility`,
            body: `Auto check-in recorded at ${cp.facilityName || cp.facilityAddress || cp.type}.`,
            link: '/dashboard/carrier/my-loads',
            metadata: { loadId: load._id, dwellEventId: dwellEvent._id, stopType: cp.type },
          });

          // Emit socket event for real-time UI update
          try {
            const io = getIO();
            const payload = {
              type: 'geofence_checkin',
              loadId: load._id,
              dwellEventId: dwellEvent._id,
              stopType: cp.type,
              facilityName: cp.facilityName,
              arrivedAt: dwellEvent.arrivedAt,
            };
            io.to(`user_${load.postedBy}`).emit('geofenceEvent', payload);
            io.to(`user_${carrierId}`).emit('geofenceEvent', payload);
          } catch (_) { /* socket not available */ }

          console.log(
            `[Geofence] Check-in: carrier ${carrierId} at ${cp.type} for load ${load._id}`
          );

        } else if (!within && existingEvent) {
          // ── LEAVE geofence: auto-check-out ───────────────────────────
          existingEvent.departedAt = new Date();
          await existingEvent.save();

          // Recalculate detention
          await recalculateDwellEvent(existingEvent._id);

          result.checkedOut.push(existingEvent._id);

          // Notify shipper
          await notifyUserSafe(load.postedBy, {
            type: 'geofence_checkout',
            title: `Carrier departed ${cp.type} facility`,
            body: `Auto check-out at ${cp.facilityName || cp.facilityAddress || cp.type}. ` +
                  `Dwell time: ${existingEvent.dwellMinutes || 0} minutes.`,
            link: '/dashboard/shipper/loads',
            metadata: { loadId: load._id, dwellEventId: existingEvent._id, stopType: cp.type },
          });

          // Emit socket event
          try {
            const io = getIO();
            const payload = {
              type: 'geofence_checkout',
              loadId: load._id,
              dwellEventId: existingEvent._id,
              stopType: cp.type,
              facilityName: cp.facilityName,
              departedAt: existingEvent.departedAt,
            };
            io.to(`user_${load.postedBy}`).emit('geofenceEvent', payload);
            io.to(`user_${carrierId}`).emit('geofenceEvent', payload);
          } catch (_) { /* socket not available */ }

          console.log(
            `[Geofence] Check-out: carrier ${carrierId} from ${cp.type} for load ${load._id}`
          );
        }
        // If within && existingEvent → already checked in, do nothing
        // If !within && !existingEvent → not near facility, do nothing
      }
    }
  } catch (err) {
    console.error('[Geofence] Error in checkGeofence:', err.message);
  }

  return result;
}

module.exports = {
  checkGeofence,
  isWithinGeofence,
  haversineDistance,
  getFacilityCheckpoints,
  GEOFENCE_RADIUS_METERS,
};
