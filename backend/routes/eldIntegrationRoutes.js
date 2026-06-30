/**
 * ELD Integration Routes — Telematics provider connections, signed webhook
 * receiver, and connection testing.
 *
 * Mounted (by the wiring agent) at: /api/eld-integration
 *
 * Carrier endpoints (role 'carrier'):
 *   POST   /connect          — upsert an EldConnection for this carrier+provider
 *   GET    /                 — list this carrier's connections (no secrets)
 *   DELETE /:id              — disable/remove a connection (must belong to carrier)
 *   POST   /:id/test         — guarded (env-gated) live fetch test, or "configured" message
 *
 * Webhook (NO auth — verified by HMAC signature against the stored webhookSecret):
 *   POST   /webhook/:provider — inbound telematics location receiver
 *
 * Runtime dependencies (created by sibling agents — referenced by contract):
 *   - services/trackingService.js  → recordLocation(...)
 *   - services/eld/index.js        → getProvider(name)
 *   - models/EldConnection.js
 *
 * NOTE: req.user.userId + req.user.role (set by authMiddleware). NEVER req.user._id.
 */

const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/authMiddleware');

const EldConnection  = require('../models/EldConnection');
const { getProvider } = require('../services/eld');
const trackingService = require('../services/trackingService');
const Load            = require('../models/Load');

const VALID_PROVIDERS = ['motive', 'samsara', 'geotab'];

// ── Helpers ───────────────────────────────────────────────────────────────────

const CARRIER_ONLY = (req, res, next) => {
  if (req.user.role !== 'carrier' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Carriers only' });
  }
  next();
};

/**
 * Strip secret fields from a connection document before returning it to a client.
 * Even though apiToken/webhookSecret are select:false in the schema, we defend in
 * depth in case a lean/raw doc ever carries them.
 */
function sanitizeConnection(conn) {
  if (!conn) return conn;
  const obj = typeof conn.toObject === 'function' ? conn.toObject() : { ...conn };
  delete obj.apiToken;
  delete obj.webhookSecret;
  delete obj.__v;
  return obj;
}

/**
 * Resolve an inbound telematics location to a specific Load for a carrier.
 *
 * Mapping: loc.vehicleId → connection.vehicleMap entry (vehicleId → driverId),
 * then find that carrier's active load (in-transit preferred, then accepted).
 * Returns the Load _id or null if no resolution is possible.
 */
async function resolveLoadId(connection, loc) {
  if (!loc || loc.vehicleId == null) return null;

  // Confirm this vehicle is known to the connection's vehicleMap.
  const mapEntry = Array.isArray(connection.vehicleMap)
    ? connection.vehicleMap.find((m) => String(m.vehicleId) === String(loc.vehicleId))
    : null;
  if (!mapEntry) return null; // unknown vehicle — skip rather than guess

  // Find the carrier's currently-moving load. Prefer in-transit; fall back to accepted.
  const load = await Load.findOne({
    acceptedBy: connection.carrier,
    status: { $in: ['in-transit', 'accepted'] },
  })
    .sort({ status: 1, updatedAt: -1 }) // 'accepted' < 'in-transit' alpha; updatedAt tiebreak
    .select('_id status')
    .lean();

  // Prefer an explicitly in-transit load if multiple exist.
  if (!load) return null;
  if (load.status === 'in-transit') return load._id;

  // If the first hit was 'accepted', double-check there isn't an in-transit one.
  const inTransit = await Load.findOne({
    acceptedBy: connection.carrier,
    status: 'in-transit',
  })
    .select('_id')
    .lean();

  return (inTransit && inTransit._id) || load._id;
}

// ─────────────────────────────────────────────────────────────────────────────
// CARRIER ENDPOINTS (authenticated)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /connect
 * Upsert an EldConnection for this carrier + provider. Status set to 'active'.
 * Secrets are stored but NEVER returned.
 */
router.post('/connect', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const { provider, apiToken, accountId, webhookSecret, vehicleMap } = req.body || {};

    if (!provider || !VALID_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` });
    }

    if (vehicleMap != null && !Array.isArray(vehicleMap)) {
      return res.status(400).json({ error: 'vehicleMap must be an array' });
    }

    // Build the $set — only overwrite secret fields when a value was provided so
    // a partial update (e.g. just remapping vehicles) doesn't wipe stored creds.
    const set = {
      carrier: req.user.userId,
      provider,
      status: 'active',
      lastError: null,
    };
    if (accountId !== undefined) set.accountId = accountId;
    if (Array.isArray(vehicleMap)) {
      set.vehicleMap = vehicleMap
        .filter((v) => v && v.vehicleId != null)
        .map((v) => ({ vehicleId: String(v.vehicleId), driverId: v.driverId ?? null, note: v.note ?? '' }));
    }
    if (typeof apiToken === 'string' && apiToken.length) set.apiToken = apiToken;
    if (typeof webhookSecret === 'string' && webhookSecret.length) set.webhookSecret = webhookSecret;

    const connection = await EldConnection.findOneAndUpdate(
      { carrier: req.user.userId, provider },
      { $set: set, $setOnInsert: { createdAt: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );

    return res.status(200).json({ success: true, connection: sanitizeConnection(connection) });
  } catch (err) {
    // Duplicate-key (unique carrier+provider) under a race — surface cleanly.
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'A connection for this provider already exists' });
    }
    console.error('[eldIntegration] /connect failed:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /
 * List this carrier's connections (secrets excluded by select:false + sanitize).
 */
router.get('/', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const connections = await EldConnection.find({ carrier: req.user.userId })
      .sort({ createdAt: -1 });
    return res.json({ connections: connections.map(sanitizeConnection) });
  } catch (err) {
    console.error('[eldIntegration] GET / failed:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /:id
 * Disable a connection (soft) belonging to this carrier. Sets status 'disabled'.
 */
router.delete('/:id', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const connection = await EldConnection.findOne({ _id: req.params.id, carrier: req.user.userId });
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    connection.status = 'disabled';
    await connection.save();
    return res.json({ success: true });
  } catch (err) {
    if (err && err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid connection id' });
    }
    console.error('[eldIntegration] DELETE /:id failed:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /:id/test
 * If the provider supports fetchLocations and creds exist, attempt a guarded
 * (env-gated) live fetch and report the count. Otherwise return a clear
 * "configured (live calls disabled in this environment)" message.
 */
router.post('/:id/test', auth, CARRIER_ONLY, async (req, res) => {
  try {
    // Re-select the secret fields needed to actually call the provider.
    const connection = await EldConnection.findOne({ _id: req.params.id, carrier: req.user.userId })
      .select('+apiToken +webhookSecret');
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const provider = getProvider(connection.provider);
    if (!provider) {
      return res.status(400).json({ error: `Unknown provider: ${connection.provider}` });
    }

    const liveEnabled = process.env.ELD_LIVE === 'true';
    const hasCreds = Boolean(connection.apiToken);
    const supportsFetch = typeof provider.fetchLocations === 'function';

    if (!liveEnabled || !hasCreds || !supportsFetch) {
      return res.json({
        success: true,
        live: false,
        message: 'configured (live calls disabled in this environment)',
        provider: connection.provider,
        hasCredentials: hasCreds,
        supportsPolling: supportsFetch,
      });
    }

    // Env-gated live call. Provider is contractually guarded (no creds → []).
    let count = 0;
    try {
      const locs = await provider.fetchLocations(connection);
      count = Array.isArray(locs) ? locs.length : 0;
      connection.lastSyncAt = new Date();
      connection.lastError = null;
      await connection.save();
    } catch (fetchErr) {
      connection.lastError = String(fetchErr.message || fetchErr).slice(0, 500);
      await connection.save().catch(() => {});
      return res.status(502).json({ success: false, live: true, error: 'Provider fetch failed', detail: connection.lastError });
    }

    return res.json({ success: true, live: true, locationsFetched: count, provider: connection.provider });
  } catch (err) {
    if (err && err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid connection id' });
    }
    console.error('[eldIntegration] POST /:id/test failed:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK RECEIVER (NO auth — verified by HMAC signature)
//
// Telematics providers expect a fast 2xx. Almost every error path here returns
// 200 to avoid provider retry storms; we log the real issue instead. The ONLY
// non-2xx responses are 404 (unknown provider / no connection) and 401 (bad
// signature) — both of which are legitimate "do not retry blindly" signals but
// are also fast and cheap.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /webhook/:provider
 *
 * Raw body is captured by app.js for this path (wiring agent) and exposed as
 * req.rawBody — required for HMAC signature verification.
 */
router.post('/webhook/:provider', async (req, res) => {
  const providerName = req.params.provider;

  try {
    const provider = getProvider(providerName);
    if (!provider) {
      return res.status(404).json({ error: 'Unknown provider' });
    }

    // 2. Resolve the connection. Prefer an explicit connectionId, else map by
    //    accountId carried in the payload. Only consider active connections.
    const connectionId = req.query.connectionId || (req.body && req.body.connectionId);
    const accountId =
      (req.body && (req.body.accountId || req.body.account_id || req.body.tenantId)) || null;

    let connection = null;
    const baseQuery = { provider: providerName, status: 'active' };

    if (connectionId) {
      connection = await EldConnection.findOne({ ...baseQuery, _id: connectionId })
        .select('+webhookSecret').catch(() => null);
    }
    if (!connection && accountId) {
      connection = await EldConnection.findOne({ ...baseQuery, accountId: String(accountId) })
        .select('+webhookSecret');
    }
    if (!connection) {
      // Fall back to a single active connection for this provider, if unambiguous.
      const candidates = await EldConnection.find(baseQuery).select('+webhookSecret').limit(2);
      if (candidates.length === 1) connection = candidates[0];
    }

    if (!connection) {
      // No tenant resolution possible. 404 (not a retryable success), logged.
      console.warn(`[eldIntegration] webhook(${providerName}): no active connection resolved`);
      return res.status(404).json({ error: 'No matching connection' });
    }

    // 3. Verify the HMAC signature over the RAW request body.
    const signatureHeader =
      req.headers['x-eld-signature'] ||
      req.headers['x-motive-signature'] ||
      req.headers['x-samsara-signature'] ||
      req.headers['x-signature'] ||
      req.headers['x-hub-signature-256'] ||
      '';

    const rawBody = req.rawBody || (req.body ? Buffer.from(JSON.stringify(req.body)) : Buffer.alloc(0));

    let valid = false;
    try {
      valid = provider.verifyWebhook(rawBody, signatureHeader, connection.webhookSecret);
    } catch (vErr) {
      console.error(`[eldIntegration] webhook(${providerName}) verify threw:`, vErr.message);
      valid = false;
    }

    if (!valid) {
      console.warn(`[eldIntegration] webhook(${providerName}): invalid signature`);
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // 4. Parse locations from the payload.
    let locs = [];
    try {
      locs = provider.parseLocations(req.body) || [];
    } catch (pErr) {
      console.error(`[eldIntegration] webhook(${providerName}) parse failed:`, pErr.message);
      // Bad payload → ack 200 so the provider stops retrying garbage.
      return res.status(200).json({ received: 0, note: 'parse_error' });
    }

    // 5–6. Resolve each loc to a Load and record the location.
    let processed = 0;
    for (const loc of locs) {
      try {
        if (loc == null || loc.latitude == null || loc.longitude == null) continue;
        const loadId = await resolveLoadId(connection, loc);
        if (!loadId) continue;

        const result = await trackingService.recordLocation({
          loadId,
          latitude: loc.latitude,
          longitude: loc.longitude,
          speed: loc.speed ?? null,
          heading: loc.heading ?? null,
          accuracy: null,
          source: 'eld',
        });
        if (result && result.ok) processed += 1;
      } catch (locErr) {
        console.error(`[eldIntegration] webhook(${providerName}) loc error:`, locErr.message);
        // continue to next loc — never let one bad point fail the batch
      }
    }

    // 7. Mark sync time. Best-effort; never block the 2xx on this write.
    try {
      connection.lastSyncAt = new Date();
      connection.lastError = null;
      await connection.save();
    } catch (sErr) {
      console.error(`[eldIntegration] webhook(${providerName}) lastSync save failed:`, sErr.message);
    }

    return res.status(200).json({ received: locs.length, processed });
  } catch (err) {
    // Catch-all: log, but still 200 so the provider does not enter a retry storm.
    console.error(`[eldIntegration] webhook(${providerName}) fatal:`, err.message);
    return res.status(200).json({ received: 0, note: 'error_logged' });
  }
});

module.exports = router;
