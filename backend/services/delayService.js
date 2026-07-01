/**
 * delayService.js — Predictive delivery-delay alerts.
 *
 * On each GPS update we project arrival from the current position + speed. If
 * that projected arrival is later than the load's delivery window, we alert the
 * shipper (and carrier) ONCE — proactively, before the load is actually overdue.
 * (The overdueLoadMonitor cron is the reactive backstop for loads with no GPS.)
 */

const Load = require('../models/Load');
const { notifyUserSafe } = require('../utils/notifyUser');

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.7613; // mean Earth radius, miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * @param {{loadId, latitude, longitude, speed?, now?}} args  speed in km/h
 * @returns {Promise<{alerted:boolean, minutesLate?:number, projectedArrival?:Date, reason?:string}>}
 */
async function checkPredictedDelay({ loadId, latitude, longitude, speed = null, now = new Date() }) {
  const load = await Load.findById(loadId).select(
    'status destinationLat destinationLng deliveryTimeWindow postedBy acceptedBy title delayAlertSentAt'
  );
  if (!load) return { alerted: false, reason: 'not_found' };
  if (load.status !== 'in-transit') return { alerted: false, reason: 'not_in_transit' };
  if (load.delayAlertSentAt) return { alerted: false, reason: 'already_alerted' };

  const dueAt = load.deliveryTimeWindow && load.deliveryTimeWindow.end;
  if (!dueAt) return { alerted: false, reason: 'no_window' };
  if (load.destinationLat == null || load.destinationLng == null) return { alerted: false, reason: 'no_destination' };
  if (latitude == null || longitude == null) return { alerted: false, reason: 'no_position' };

  const miles = haversineMiles(latitude, longitude, load.destinationLat, load.destinationLng);
  const mph = (speed != null && speed > 5) ? speed * 0.621371 : 50; // moving? use GPS speed, else 50mph avg
  const projectedArrival = new Date(now.getTime() + (miles / mph) * 3600 * 1000);
  const due = new Date(dueAt);
  if (projectedArrival <= due) return { alerted: false, reason: 'on_time' };

  const minutesLate = Math.round((projectedArrival - due) / 60000);

  // Idempotent: mark before notifying so a burst of pings can't double-alert.
  load.delayAlertSentAt = now;
  await load.save();

  if (load.postedBy) {
    await notifyUserSafe(load.postedBy, {
      type: 'delivery_delay_predicted',
      title: 'Delivery Running Late',
      body: `"${load.title}" is projected to arrive ~${minutesLate} min past the delivery window.`,
      link: '/dashboard/shipper/loads',
      metadata: { loadId: String(load._id), minutesLate },
    });
  }
  if (load.acceptedBy) {
    await notifyUserSafe(load.acceptedBy, {
      type: 'delivery_delay_predicted',
      title: 'You Are Running Late',
      body: `Your ETA for "${load.title}" is ~${minutesLate} min past the delivery window — the shipper has been notified.`,
      link: '/dashboard/carrier/my-loads',
      metadata: { loadId: String(load._id), minutesLate },
    });
  }

  return { alerted: true, minutesLate, projectedArrival };
}

module.exports = { checkPredictedDelay, haversineMiles };
