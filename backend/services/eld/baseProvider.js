/**
 * BaseEldProvider — abstract interface for Tier-2 ELD / telematics provider adapters.
 *
 * Concrete providers (Motive, Samsara, …) extend this class and implement the
 * provider-specific webhook signature scheme, payload parsing, and polling calls.
 * The adapter layer normalizes every provider into a single breadcrumb shape:
 *
 *   { vehicleId, latitude, longitude, speed, heading, recordedAt }
 *
 * which the caller (route/cron) feeds into trackingService.recordLocation().
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Webhook signature schemes (documented per provider so live wiring is a
 * credential drop-in):
 *
 *   Motive (formerly KeepTruckin)
 *     Header:    X-KT-Signature  (legacy)  /  X-Motive-Signature  (current)
 *     Algorithm: HMAC-SHA256(rawBody, webhookSecret), hex digest
 *     Compare:   timing-safe equality against the header value (hex)
 *     Docs:      https://developer.gomotive.com/ (Webhooks → Signature Verification)
 *
 *   Samsara
 *     Header:    X-Samsara-Signature        (value formatted "v1=<hexdigest>")
 *     Timestamp: X-Samsara-Timestamp
 *     Algorithm: HMAC-SHA256( "v1:" + timestamp + ":" + rawBody , webhookSecret )
 *     Compare:   timing-safe equality against the hex digest portion of the header
 *     Docs:      https://developer.samsara.com/docs/webhooks (Validating webhooks)
 *
 *   Geotab
 *     (placeholder — Geotab uses MyGeotab API session auth rather than HMAC
 *      webhooks in most deployments; not implemented in this tier.)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const crypto = require('crypto');

class BaseEldProvider {
  /**
   * Stable provider key, matching the EldConnection.provider enum.
   * @returns {string}
   */
  get name() {
    throw new Error('BaseEldProvider.name not implemented');
  }

  /**
   * Verify a webhook payload signature using HMAC-SHA256 with a timing-safe
   * comparison. Concrete providers typically override this to parse their own
   * header format / construct the signed message, then delegate to
   * `hmacEquals()` below.
   *
   * @param {Buffer|string} rawBody         exact raw request body (pre-JSON-parse)
   * @param {string} signatureHeader        signature value from the provider header
   * @param {string} secret                 per-connection webhookSecret
   * @returns {boolean} true if the signature is valid
   */
  verifyWebhook(rawBody, signatureHeader, secret) {
    if (!secret || !signatureHeader) return false;
    const expected = BaseEldProvider.computeHmacHex(rawBody, secret);
    return BaseEldProvider.timingSafeEqualHex(expected, String(signatureHeader).trim());
  }

  /**
   * Map a provider webhook payload to the normalized breadcrumb array.
   * Must be defensive: return [] on any shape mismatch.
   *
   * @param {object} _payload provider webhook body (already JSON-parsed)
   * @returns {Array<{vehicleId:string,latitude:number,longitude:number,speed:?number,heading:?number,recordedAt:Date}>}
   */
  // eslint-disable-next-line no-unused-vars
  parseLocations(_payload) {
    throw new Error(`${this.name || 'BaseEldProvider'}.parseLocations not implemented`);
  }

  /**
   * Pull the latest vehicle locations from the provider REST API (polling mode).
   * MUST be guarded so it never hits the network without credentials AND the
   * ELD_LIVE env flag — concrete implementations return [] otherwise.
   *
   * @param {object} _connection EldConnection document (with +apiToken selected)
   * @returns {Promise<Array<{vehicleId:string,latitude:number,longitude:number,speed:?number,heading:?number,recordedAt:Date}>>}
   */
  // eslint-disable-next-line no-unused-vars
  async fetchLocations(_connection) {
    throw new Error(`${this.name || 'BaseEldProvider'}.fetchLocations not implemented`);
  }

  // ── Shared crypto helpers ─────────────────────────────────────────────────

  /**
   * Compute the HMAC-SHA256 hex digest of `data` keyed by `secret`.
   * @param {Buffer|string} data
   * @param {string} secret
   * @returns {string} lowercase hex digest
   */
  static computeHmacHex(data, secret) {
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }

  /**
   * Timing-safe comparison of two hex strings of equal expected length.
   * Returns false (without throwing) if lengths differ or inputs are invalid.
   * @param {string} aHex
   * @param {string} bHex
   * @returns {boolean}
   */
  static timingSafeEqualHex(aHex, bHex) {
    try {
      if (typeof aHex !== 'string' || typeof bHex !== 'string') return false;
      const a = Buffer.from(aHex, 'hex');
      const b = Buffer.from(bHex, 'hex');
      if (a.length === 0 || a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /**
   * Convenience: compute HMAC of `data` and timing-safe compare to a provided
   * hex signature. Used by concrete providers after they build the signed message.
   * @param {Buffer|string} data
   * @param {string} secret
   * @param {string} providedHex
   * @returns {boolean}
   */
  static hmacEquals(data, secret, providedHex) {
    if (!secret || !providedHex) return false;
    const expected = BaseEldProvider.computeHmacHex(data, secret);
    return BaseEldProvider.timingSafeEqualHex(expected, String(providedHex).trim());
  }
}

module.exports = BaseEldProvider;
module.exports.BaseEldProvider = BaseEldProvider;
