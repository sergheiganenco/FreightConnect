/**
 * MotiveProvider — Motive (formerly KeepTruckin) ELD adapter.
 *
 * Docs:
 *   API root:        https://api.gomotive.com/
 *   Vehicle locations (poll):  GET https://api.gomotive.com/v1/vehicle_locations
 *                              Authorization: Bearer <apiToken>
 *   Webhooks:        https://developer.gomotive.com/  (Webhooks → vehicle_location)
 *   Signature:       HMAC-SHA256(rawBody, webhookSecret) hex digest, sent in
 *                    header X-KT-Signature (legacy) or X-Motive-Signature (current).
 *
 * Normalized breadcrumb shape produced by this adapter:
 *   { vehicleId, latitude, longitude, speed, heading, recordedAt }
 */

const BaseEldProvider = require('./baseProvider');

class MotiveProvider extends BaseEldProvider {
  get name() {
    return 'motive';
  }

  /**
   * Verify a Motive webhook. Motive computes HMAC-SHA256 of the raw request body
   * with the connection's webhookSecret and sends the hex digest in either
   * X-KT-Signature (legacy KeepTruckin header) or X-Motive-Signature. The caller
   * should pass whichever header is present; comparison is timing-safe.
   *
   * @param {Buffer|string} rawBody
   * @param {string} signatureHeader  value of X-KT-Signature / X-Motive-Signature
   * @param {string} secret           connection.webhookSecret
   * @returns {boolean}
   */
  verifyWebhook(rawBody, signatureHeader, secret) {
    if (!secret || !signatureHeader) return false;
    // Header may arrive as "sha256=<hex>" or a bare hex digest — normalize.
    const sig = String(signatureHeader).trim().replace(/^sha256=/i, '');
    return BaseEldProvider.hmacEquals(rawBody, secret, sig);
  }

  /**
   * Parse a Motive `vehicle_location` webhook payload into normalized breadcrumbs.
   * Motive may deliver a single location object or a batch. Defensive: returns []
   * on any shape mismatch.
   *
   * Example single payload:
   *   {
   *     "vehicle": { "id": 12345, "number": "TRK-1" },
   *     "location": { "lat": 41.88, "lon": -87.63, "speed": 55.2, "bearing": 270 },
   *     "located_at": "2026-06-30T14:05:00Z"
   *   }
   *
   * @param {object} payload
   * @returns {Array<{vehicleId:string,latitude:number,longitude:number,speed:?number,heading:?number,recordedAt:Date}>}
   */
  parseLocations(payload) {
    if (!payload || typeof payload !== 'object') return [];

    // Support batched deliveries: payload.vehicle_locations[] or payload.data[].
    const batch =
      (Array.isArray(payload.vehicle_locations) && payload.vehicle_locations) ||
      (Array.isArray(payload.data) && payload.data) ||
      [payload];

    const out = [];
    for (const item of batch) {
      const point = MotiveProvider._mapOne(item);
      if (point) out.push(point);
    }
    return out;
  }

  /**
   * Map a single Motive location-ish object to the normalized shape, or null.
   * @private
   */
  static _mapOne(item) {
    if (!item || typeof item !== 'object') return null;

    const vehicleId =
      item?.vehicle?.id ??
      item?.vehicle_id ??
      item?.vehicle?.number ??
      null;

    const loc = item.location || item.vehicle_location || item;
    const latitude = loc?.lat ?? loc?.latitude;
    const longitude = loc?.lon ?? loc?.lng ?? loc?.longitude;

    if (vehicleId == null) return null;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    const speedRaw = loc?.speed;
    const headingRaw = loc?.bearing ?? loc?.heading;
    const ts = item.located_at || loc?.located_at || item.recorded_at || loc?.time;
    const recordedAt = ts ? new Date(ts) : new Date();

    return {
      vehicleId: String(vehicleId),
      latitude,
      longitude,
      speed: typeof speedRaw === 'number' && Number.isFinite(speedRaw) ? speedRaw : null,
      heading: typeof headingRaw === 'number' && Number.isFinite(headingRaw) ? headingRaw : null,
      recordedAt: isNaN(recordedAt.getTime()) ? new Date() : recordedAt,
    };
  }

  /**
   * Poll the Motive REST API for the latest vehicle locations.
   *
   * GUARDED: only performs a live network request when the connection has an
   * apiToken AND process.env.ELD_LIVE === 'true'. In tests/dev (default) it
   * returns [] without touching the network.
   *
   * Live call (when enabled):
   *   GET https://api.gomotive.com/v1/vehicle_locations
   *   Headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' }
   *
   * @param {object} connection EldConnection (must be loaded with +apiToken)
   * @returns {Promise<Array>}
   */
  async fetchLocations(connection) {
    const apiToken = connection?.apiToken;
    if (!apiToken) return [];
    if (process.env.ELD_LIVE !== 'true') return [];

    try {
      const res = await fetch('https://api.gomotive.com/v1/vehicle_locations', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Accept: 'application/json',
        },
      });
      if (!res.ok) return [];
      const body = await res.json();
      // Motive wraps results as { vehicle_locations: [ { vehicle, location, located_at }, ... ] }
      return this.parseLocations(body);
    } catch {
      // Never throw from the adapter — polling job treats [] as "no update".
      return [];
    }
  }
}

module.exports = MotiveProvider;
module.exports.MotiveProvider = MotiveProvider;
