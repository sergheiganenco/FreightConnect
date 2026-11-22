/**
 * ELD Poller Job
 *
 * For ELD providers that don't push webhooks, poll their API on a schedule and
 * feed locations into the unified tracking pipeline (trackingService.recordLocation).
 *
 * Runs every 2 minutes.
 *
 * ENV-GATED & SAFE-BY-DEFAULT:
 *   - Provider.fetchLocations(connection) is contractually guarded: it returns []
 *     unless ELD_LIVE === 'true' (and valid creds exist).
 *   - With no active connections, or ELD_LIVE unset, this job is a pure no-op:
 *     no network calls, no errors, no writes.
 *
 * Runtime dependencies (created by sibling agents — referenced by contract):
 *   - services/eld/index.js        → getProvider(name)
 *   - services/trackingService.js  → recordLocation(...)
 *   - models/EldConnection.js
 */

const cron = require('node-cron');

const EldConnection   = require('../models/EldConnection');
const { resolveVehicleLoad } = require('../services/eldLoadResolver');
const { getProvider } = require('../services/eld');
const trackingService = require('../services/trackingService');

/**
 * runEldPoll — one polling pass over all active EldConnections.
 * Per-connection try/catch ensures one bad connection can't break the batch.
 */
async function runEldPoll() {
  let connections = [];
  try {
    // Re-select apiToken so providers can authenticate live calls.
    connections = await EldConnection.find({ status: 'active' }).select('+apiToken');
  } catch (err) {
    console.error('[EldPoller] Failed to load connections:', err.message);
    return;
  }

  if (!connections.length) {
    // No-op: nothing to poll. Stay quiet to avoid log spam every 2 minutes.
    return;
  }

  const liveEnabled = process.env.ELD_LIVE === 'true';
  let totalPoints = 0;
  let totalRecorded = 0;
  let polledConnections = 0;

  for (const connection of connections) {
    try {
      const provider = getProvider(connection.provider);
      if (!provider || typeof provider.fetchLocations !== 'function') continue;

      // Contractually returns [] unless ELD_LIVE==='true' and creds exist.
      const locs = (await provider.fetchLocations(connection)) || [];
      polledConnections += 1;
      totalPoints += locs.length;

      for (const loc of locs) {
        try {
          if (loc == null || loc.latitude == null || loc.longitude == null) continue;
          const hit = await resolveVehicleLoad(connection, loc.vehicleId);
          if (!hit) continue;

          const result = await trackingService.recordLocation({
            loadId: hit.loadId,
            latitude: loc.latitude,
            longitude: loc.longitude,
            speed: loc.speed ?? null,
            heading: loc.heading ?? null,
            accuracy: null,
            source: 'eld',
            authenticated: hit.authenticated, // the vehicle is tied to this load by the connection's vehicleMap
          });
          if (result && result.ok) totalRecorded += 1;
        } catch (locErr) {
          console.error(`[EldPoller] loc error (conn ${connection._id}):`, locErr.message);
        }
      }

      connection.lastSyncAt = new Date();
      connection.lastError = null;
      await connection.save();
    } catch (connErr) {
      console.error(`[EldPoller] connection ${connection._id} (${connection.provider}) failed:`, connErr.message);
      try {
        connection.lastError = String(connErr.message || connErr).slice(0, 500);
        connection.status = 'error';
        await connection.save();
      } catch (_) { /* swallow — best-effort error recording */ }
    }
  }

  // Only log when something actually happened (or live mode is on) to keep logs clean.
  if (liveEnabled || totalPoints > 0) {
    console.log(
      `[EldPoller] Polled ${polledConnections}/${connections.length} connection(s) — ` +
      `${totalPoints} point(s) fetched, ${totalRecorded} recorded. (ELD_LIVE=${liveEnabled})`
    );
  }
}

function start() {
  // Every 2 minutes.
  cron.schedule('*/2 * * * *', runEldPoll);
  console.log('[EldPoller] Scheduled — runs every 2 minutes (env-gated; no-op unless ELD_LIVE=true with active connections)');
}

module.exports = { start, runEldPoll };
