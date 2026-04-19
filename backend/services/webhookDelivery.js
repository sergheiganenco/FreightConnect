const crypto = require('crypto');
const Webhook = require('../models/Webhook');

const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_FAILURES = 10;

class WebhookDeliveryService {
  /**
   * Deliver an event to all matching active webhooks.
   * @param {string} eventType — e.g. 'load.created'
   * @param {Object} payload — event data
   * @returns {Promise<PromiseSettledResult[]>}
   */
  async deliver(eventType, payload) {
    const webhooks = await Webhook.find({ events: eventType, isActive: true });
    if (!webhooks.length) return [];

    const results = await Promise.allSettled(
      webhooks.map((wh) => this._send(wh, eventType, payload))
    );
    return results;
  }

  /**
   * Send a single webhook delivery with HMAC signature.
   * @param {Document} webhook — Webhook document
   * @param {string} eventType
   * @param {Object} payload
   */
  async _send(webhook, eventType, payload) {
    const body = JSON.stringify({
      event: eventType,
      data: payload,
      timestamp: new Date().toISOString(),
    });

    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(body)
      .digest('hex');

    // Use dynamic import for node-fetch or built-in fetch
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-FreightConnect-Signature': `sha256=${signature}`,
          'X-FreightConnect-Event': eventType,
          'User-Agent': 'FreightConnect-Webhooks/1.0',
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Success — reset failure count, update delivery timestamp
      await Webhook.updateOne(
        { _id: webhook._id },
        {
          $set: { failureCount: 0, lastDeliveryAt: new Date() },
        }
      );

      return { webhookId: webhook._id, status: 'delivered' };
    } catch (err) {
      clearTimeout(timeout);

      const reason = err.name === 'AbortError'
        ? 'Request timed out'
        : err.message;

      const newFailureCount = (webhook.failureCount || 0) + 1;
      const update = {
        $set: {
          failureCount: newFailureCount,
          lastFailureAt: new Date(),
          lastFailureReason: reason,
        },
      };

      // Disable webhook after MAX_FAILURES consecutive failures
      if (newFailureCount >= MAX_FAILURES) {
        update.$set.isActive = false;
        console.warn(
          `[WebhookDelivery] Disabled webhook ${webhook._id} after ${MAX_FAILURES} consecutive failures`
        );
      }

      await Webhook.updateOne({ _id: webhook._id }, update);

      throw new Error(`Webhook delivery failed for ${webhook._id}: ${reason}`);
    }
  }

  /**
   * Send a test event to a specific webhook (for verification).
   * @param {Document} webhook
   * @returns {Promise<Object>}
   */
  async sendTest(webhook) {
    return this._send(webhook, 'test', {
      message: 'This is a test webhook delivery from FreightConnect',
      webhookId: webhook._id,
    });
  }
}

module.exports = new WebhookDeliveryService();
