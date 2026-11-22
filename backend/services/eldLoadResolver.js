/**
 * eldLoadResolver.js — tie an ELD/telematics vehicle position to ONE load, or to none.
 *
 * Shared by the ELD webhook and the poller. A fix is only returned for a load when the connection's vehicleMap
 * entry for that vehicle matches the load's assignment (entry.truckId === Load.assignedTruckId, or
 * entry.driverId === Load.assignedDriverId), so truck X's position never becomes evidence for truck Y's load.
 * Fallback: with exactly one active load AND exactly one mapped vehicle there is nothing to confuse, unless
 * the load is explicitly assigned to a different truck/driver. Anything else is skipped.
 */
const Load = require('../models/Load');

const rank = (l) => (l.status === 'in-transit' ? 0 : 1);

/** @returns {Promise<{loadId: *, authenticated: true}|null>} authenticated: connection.carrier owns the load. */
async function resolveVehicleLoad(connection, vehicleId) {
  if (vehicleId == null) return null;
  const map = Array.isArray(connection.vehicleMap) ? connection.vehicleMap : [];
  const entry = map.find((m) => String(m.vehicleId) === String(vehicleId));
  if (!entry) return null; // unknown vehicle: skip rather than guess

  const loads = await Load.find({ acceptedBy: connection.carrier, status: { $in: ['accepted', 'in-transit'] } })
    .select('_id status assignedTruckId assignedDriverId').lean();

  const mine = loads.filter((l) => (entry.truckId && l.assignedTruckId === entry.truckId) || (entry.driverId && l.assignedDriverId === entry.driverId));
  if (mine.length) {
    const best = Math.min(...mine.map(rank));
    const top = mine.filter((l) => rank(l) === best);
    return top.length === 1 ? { loadId: top[0]._id, authenticated: true } : null; // two loads on one truck at the same stage: ambiguous
  }
  if (loads.length === 1 && map.length === 1) {
    const l = loads[0];
    const other = (l.assignedTruckId && entry.truckId && l.assignedTruckId !== entry.truckId)
      || (l.assignedDriverId && entry.driverId && l.assignedDriverId !== entry.driverId);
    if (!other) return { loadId: l._id, authenticated: true };
  }
  return null;
}

module.exports = { resolveVehicleLoad };
