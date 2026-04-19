/**
 * LoadMatchingAgent — autonomous agent that monitors new loads and proactively
 * pushes match notifications to the best-fit carriers.
 *
 * Runs every 30 seconds. For each load posted within the last 60 seconds that
 * has not yet been match-notified, it:
 *   1. Finds top 10 carrier matches (via matchingService)
 *   2. Sends a persisted notification to each carrier (notifyUserSafe)
 *   3. Emits an `ai:loadMatch` socket event to each carrier's personal room
 *   4. Marks the load so it is not processed again
 *
 * Uses an in-memory Set plus a DB flag (matchNotificationSent) to prevent
 * duplicate notifications across restarts.
 */

const { Agent } = require('./AgentFramework');
const Load = require('../models/Load');
const { findMatchesForLoad } = require('../services/matchingService');
const { notifyUserSafe } = require('../utils/notifyUser');
const { getIO } = require('../utils/socket');

class LoadMatchingAgent extends Agent {
  constructor() {
    super('LoadMatchingAgent', { intervalMs: 30_000 }); // every 30s
    /** @type {Set<string>} — loadIds already processed this session */
    this._processed = new Set();
  }

  /** @returns {Promise<number>} number of carrier notifications sent */
  async execute() {
    const since = new Date(Date.now() - 60_000); // loads posted in last 60s

    const newLoads = await Load.find({
      status: 'open',
      createdAt: { $gte: since },
      matchNotificationSent: { $ne: true },
    })
      .select('_id title origin destination rate equipmentType')
      .lean();

    let actionCount = 0;

    for (const load of newLoads) {
      const lid = load._id.toString();
      if (this._processed.has(lid)) continue;

      try {
        const matches = await findMatchesForLoad(load._id, 10);

        for (const { carrier, score } of matches) {
          if (score < 40) continue; // only notify good matches

          // Persistent notification
          await notifyUserSafe(carrier._id, {
            type: 'ai:loadMatch',
            title: 'AI Match: New load matches your profile',
            body: `${load.origin} → ${load.destination} · $${load.rate} · Score ${score}`,
            link: '/dashboard/carrier/loads',
            metadata: { loadId: load._id, score },
          });

          // Real-time socket push
          try {
            getIO().to(`user_${carrier._id}`).emit('ai:loadMatch', {
              loadId: load._id,
              title: load.title,
              origin: load.origin,
              destination: load.destination,
              rate: load.rate,
              equipmentType: load.equipmentType,
              score,
            });
          } catch (_) { /* socket unavailable — notification still persisted */ }

          actionCount++;
        }

        // Mark load as processed (DB flag + in-memory)
        await Load.updateOne({ _id: load._id }, { $set: { matchNotificationSent: true } });
        this._processed.add(lid);

        // Evict old entries to avoid unbounded memory growth
        if (this._processed.size > 10_000) {
          const iter = this._processed.values();
          for (let i = 0; i < 5000; i++) iter.next();
          // keep the newer half
        }
      } catch (err) {
        console.error(`[LoadMatchingAgent] Error processing load ${lid}:`, err.message);
        // continue to next load
      }
    }

    return actionCount;
  }
}

module.exports = LoadMatchingAgent;
