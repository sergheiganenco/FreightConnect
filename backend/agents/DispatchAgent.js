/**
 * DispatchAgent — autonomous load dispatcher.
 *
 * Runs every 2 minutes. Processes loads where the shipper has opted into
 * auto-dispatch (User.preferences.autoDispatch = true). Finds the best
 * matching verified carrier with an available truck and a match score > 80,
 * then atomically assigns the load.
 *
 * All auto-dispatch decisions are logged for audit trail via the
 * AutoDispatchLog embedded in Load or logged to console.
 */

const { Agent } = require('./AgentFramework');
const Load = require('../models/Load');
const User = require('../models/User');
const { calculateMatchScore } = require('../services/matchingService');
const { notifyUserSafe } = require('../utils/notifyUser');
const { getIO } = require('../utils/socket');

class DispatchAgent extends Agent {
  constructor() {
    super('DispatchAgent', { intervalMs: 2 * 60_000 }); // every 2 min
  }

  /** @returns {Promise<number>} number of loads auto-dispatched */
  async execute() {
    // 1. Find shippers who opted into auto-dispatch
    const autoDispatchShippers = await User.find({
      role: 'shipper',
      'preferences.autoDispatch': true,
    })
      .select('_id')
      .lean();

    if (autoDispatchShippers.length === 0) return 0;

    const shipperIds = autoDispatchShippers.map((s) => s._id);

    // 2. Find open loads from those shippers that haven't been dispatched yet
    const loads = await Load.find({
      status: 'open',
      postedBy: { $in: shipperIds },
      autoDispatched: { $ne: true }, // avoid re-processing
    }).lean();

    let dispatched = 0;

    for (const load of loads) {
      try {
        // 3. Find verified carriers with matching equipment
        const carriers = await User.find({
          role: 'carrier',
          'verification.status': 'verified',
        }).lean();

        // 4. Score and filter
        const scored = carriers
          .map((carrier) => ({
            carrier,
            score: calculateMatchScore(load, carrier),
            hasAvailableTruck: (carrier.fleet || []).some((t) => t.available),
          }))
          .filter((m) => m.score > 80 && m.hasAvailableTruck)
          .sort((a, b) => b.score - a.score);

        if (scored.length === 0) continue;

        // 5. Booking gate + atomic accept — auto-dispatch BOOKS the load, so
        // it must pass the same eligibility (hazmat/endorsements, credential
        // expiry) + anti-fraud (insurance expiry) enforcement as manual paths.
        // Walk candidates best-first until one passes the gate.
        const { evaluateBookingGate, atomicBookLoad } = require('../services/bookingGuard');
        let updated = null;
        let best = null;
        for (const candidate of scored) {
          const gate = await evaluateBookingGate({ load, carrierId: candidate.carrier._id });
          if (!gate.allowed) continue;
          updated = await atomicBookLoad({
            loadId: load._id,
            carrierId: candidate.carrier._id,
            gate,
            extra: {
              autoDispatched: true,
              autoDispatchedAt: new Date(),
              autoDispatchScore: candidate.score,
            },
          });
          best = candidate;
          break; // booked, or load taken by another path (checked below)
        }

        if (!updated || !best) continue; // no eligible carrier, or already booked

        dispatched++;

        // 6. Assign first available truck
        const truck = (best.carrier.fleet || []).find((t) => t.available);
        if (truck) {
          await User.updateOne(
            { _id: best.carrier._id, 'fleet.truckId': truck.truckId },
            {
              $set: {
                'fleet.$.status': 'Assigned',
                'fleet.$.available': false,
                'fleet.$.currentLoadId': load._id.toString(),
              },
            },
          );
        }

        // 7. Notify carrier
        await notifyUserSafe(best.carrier._id, {
          type: 'ai:autoDispatch',
          title: 'AI Auto-Dispatch: Load assigned to you',
          body: `${load.origin} → ${load.destination} · $${load.rate} · Match ${best.score}%`,
          link: '/dashboard/carrier/my-loads',
          metadata: { loadId: load._id, score: best.score },
        });

        // 8. Notify shipper
        await notifyUserSafe(load.postedBy, {
          type: 'ai:autoDispatch',
          title: 'AI Auto-Dispatch: Load assigned',
          body: `${load.origin} → ${load.destination} dispatched to ${best.carrier.companyName || best.carrier.name}`,
          link: '/dashboard/shipper/loads',
          metadata: { loadId: load._id, carrierId: best.carrier._id },
        });

        // 9. Socket event
        try {
          const io = getIO();
          io.to(`user_${best.carrier._id}`).emit('ai:autoDispatch', {
            loadId: load._id,
            origin: load.origin,
            destination: load.destination,
            rate: load.rate,
            score: best.score,
          });
          io.to(`user_${load.postedBy}`).emit('load:statusUpdate', {
            loadId: load._id,
            status: 'accepted',
            acceptedBy: best.carrier._id,
            autoDispatched: true,
          });
        } catch (_) { /* socket unavailable */ }

        console.log(
          `[DispatchAgent] Auto-dispatched load ${load._id} to carrier ${best.carrier._id} (score: ${best.score})`
        );
      } catch (err) {
        console.error(`[DispatchAgent] Error dispatching load ${load._id}:`, err.message);
      }
    }

    return dispatched;
  }
}

module.exports = DispatchAgent;
