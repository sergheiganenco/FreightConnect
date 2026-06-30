/**
 * SamsaraProvider — Samsara ELD / telematics adapter.
 *
 * Docs:
 *   API root:        https://api.samsara.com/
 *   Vehicle locations (poll):  GET https://api.samsara.com/fleet/vehicles/locations
 *                              Authorization: Bearer <apiToken>
 *   Webhooks:        https://developer.samsara.com/docs/webhooks
 *   Signature:       Samsara signs with HMAC-SHA256 over the message
 *                        "v1:" + <X-Samsara-Timestamp> + ":" + rawBody
 *                    keyed by the webhook secret. The result is sent in header
 *                    X-Samsara-Signature, formatted "v1=<hexdigest>".
 *
 * Normalized breadcrumb shape produced by this adapter:
 *   { vehicleId, latitude, longitude, speed, heading, recordedAt }
 */

const BaseEldProvider = require('./baseProvider');

class SamsaraProvider extends BaseEldProvider {
  get name() {
    return 'samsara';
  }

  /**
   * Verify a Samsara webhook signature.
   *
   * Signed message: "v1:" + timestamp + ":" + rawBody
   * The header X-Samsara-Signature carries "v1=<hexdigest>". The X-Samsara-Timestamp
   * header supplies the timestamp. Because the timestamp is part of the signed
   * message, the caller must pass the timestamp alongside the signature — this
   * adapter accepts it either as a second positional bundle on `signatureHeader`
   * (object form `{ signature, timestamp }`) or expects the route to have already
   * assembled the "v1=<hex>" header and prefixed timestamp.
   *
   * For ergonomics, signatureHeader may be either:
   *   - a string "v1=<hex>" / "<hex>"  → caller must also embed timestamp via secret-less path, OR
   *   - an object { signature, timestamp }  (preferred — fully self-contained)
   *
   * @param {Buffer|string} rawBody
   * @param {string|{signature:string,timestamp:string}} signatureHeader
   * @param {string} secret           connection.webhookSecret
   * @returns {boolean}
   */
  verifyWebhook(rawBody, signatureHeader, secret) {
    if (!secret || !signatureHeader) return false;

    let signature;
    let timestamp = '';
    if (typeof signatureHeader === 'object') {
      signature = signatureHeader.signature;
      timestamp = signatureHeader.timestamp || '';
    } else {
      signature = signatureHeader;
    }
    if (!signature) return false;

    // Strip the "v1=" / "v1:" scheme prefix to get the bare hex digest.
    const sigHex = String(signature).trim().replace(/^v1[=:]/i, '');

    // Reconstruct the signed message exactly as Samsara does.
    const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    const signedMessage = `v1:${timestamp}:${bodyStr}`;

    return BaseEldProvider.hmacEquals(signedMessage, secret, sigHex);
  }

  /**
   * Parse a Samsara webhook payload into normalized breadcrumbs.
   *
   * Samsara webhooks carry an `eventType` (e.g. "GpsData") and an `event`/`data`
   * object. Defensive: returns [] on any shape mismatch.
   *
   * Example payload:
   *   {
   *     "eventType": "GpsData",
   *     "data": {
   *       "vehicle": { "id": "281474977146368", "name": "Truck 7" },
   *       "location": {
   *         "latitude": 37.7749, "longitude": -122.4194,
   *         "speedMilesPerHour": 48.3, "headingDegrees": 180,
   *         "time": "2026-06-30T14:05:00Z"
   *       }
   *     }
   *   }
   *
   * @param {object} payload
   * @returns {Array<{vehicleId:string,latitude:number,longitude:number,speed:?number,heading:?number,recordedAt:Date}>}
   */
  parseLocations(payload) {
    if (!payload || typeof payload !== 'object') return [];

    const container = payload.data || payload.event || payload;

    // Support both a single event and a batch (data[] or vehicles[]).
    const batch =
      (Array.isArray(container) && container) ||
      (Array.isArray(container.vehicles) && container.vehicles) ||
      (Array.isArray(payload.data) && payload.data) ||
      [container];

    const out = [];
    for (const item of batch) {
      const point = SamsaraProvider._mapOne(item);
      if (point) out.push(point);
    }
    return out;
  }

  /**
   * Map a single Samsara event/vehicle object to the normalized shape, or null.
   * @private
   */
  static _mapOne(item) {
    if (!item || typeof item !== 'object') return null;

    const vehicleId =
      item?.vehicle?.id ??
      item?.id ??
      item?.vehicleId ??
      null;

    const loc = item.location || item.gps || item;
    const latitude = loc?.latitude ?? loc?.lat;
    const longitude = loc?.longitude ?? loc?.lng ?? loc?.lon;

    if (vehicleId == null) return null;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    const speedRaw = loc?.speedMilesPerHour ?? loc?.speed;
    const headingRaw = loc?.headingDegrees ?? loc?.heading ?? loc?.bearing;
    const ts = loc?.time || item.time || item.happenedAtTime;
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
   * Poll the Samsara REST API for current vehicle locations.
   *
   * GUARDED: only performs a live network request when the connection has an
   * apiToken AND process.env.ELD_LIVE === 'true'. Otherwise returns [] without
   * touching the network.
   *
   * Live call (when enabled):
   *   GET https://api.samsara.com/fleet/vehicles/locations
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
      const res = await fetch('https://api.samsara.com/fleet/vehicles/locations', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Accept: 'application/json',
        },
      });
      if (!res.ok) return [];
      const body = await res.json();
      // Samsara returns { data: [ { id, name, location: {...} }, ... ] }
      return this.parseLocations(body);
    } catch {
      return [];
    }
  }
}

module.exports = SamsaraProvider;
module.exports.SamsaraProvider = SamsaraProvider;
