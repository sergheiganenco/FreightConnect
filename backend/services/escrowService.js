/**
 * Escrow Service — Stripe manual-capture payment flow
 *
 * Flow:
 *  1. createHold()    — PaymentIntent with capture_method:'manual' (authorizes card, holds funds)
 *  2. captureEscrow() — Captures held funds after delivery, transfers to carrier minus platform fee
 *  3. cancelHold()    — Releases the hold if the load is cancelled before delivery
 *  4. refundPayment() — Issues a full or partial refund after a dispute
 *
 * All amounts are in cents (integers). Never use floating-point for money.
 */

const {
  calculatePlatformFee,
  calculateCarrierPayout,
  validateAmountCents,
} = require('./paymentValidator');

// Lazy-init Stripe so the module can be required even without STRIPE_SECRET_KEY
let _stripe = null;
function getStripe() {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    _stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

class EscrowService {
  /**
   * Create a PaymentIntent with manual capture (hold funds without charging).
   *
   * @param {string} loadId       - MongoDB Load ID
   * @param {number} amountCents  - Total amount in cents (integer)
   * @param {string} shipperId    - Shipper's MongoDB User ID
   * @param {string} carrierId    - Carrier's MongoDB User ID
   * @param {string} [customerStripeId] - Shipper's Stripe Customer ID (optional)
   * @returns {Promise<{ clientSecret: string, paymentIntentId: string }>}
   */
  async createHold(loadId, amountCents, shipperId, carrierId, customerStripeId) {
    const validation = validateAmountCents(amountCents);
    if (!validation.valid) {
      throw new Error(`Invalid amount: ${validation.error}`);
    }

    const stripe = getStripe();

    const intentParams = {
      amount: amountCents,
      currency: 'usd',
      capture_method: 'manual', // Hold funds — do NOT charge yet
      metadata: {
        loadId,
        shipperId,
        carrierId,
        type: 'escrow',
      },
    };

    // Attach to existing Stripe customer if available
    if (customerStripeId) {
      intentParams.customer = customerStripeId;
    }

    const intent = await stripe.paymentIntents.create(intentParams);

    return {
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
    };
  }

  /**
   * Capture held funds after delivery confirmation and transfer to carrier.
   *
   * @param {string} paymentIntentId - Stripe PaymentIntent ID
   * @param {string} loadId          - MongoDB Load ID (for logging/metadata)
   * @param {string} carrierConnectAccountId - Carrier's Stripe Connect account ID
   * @returns {Promise<{ success: boolean, chargeId: string, transferId: string, payoutCents: number }>}
   */
  async captureEscrow(paymentIntentId, loadId, carrierConnectAccountId) {
    if (!paymentIntentId) throw new Error('paymentIntentId is required');
    if (!carrierConnectAccountId) throw new Error('carrierConnectAccountId is required');

    const stripe = getStripe();

    // 1. Capture the held funds
    const captured = await stripe.paymentIntents.capture(paymentIntentId);
    const chargeId = captured.latest_charge;
    const amountCents = captured.amount;

    // 2. Transfer to carrier minus platform fee
    const payoutCents = calculateCarrierPayout(amountCents);

    const transfer = await stripe.transfers.create({
      amount: payoutCents,
      currency: 'usd',
      destination: carrierConnectAccountId,
      source_transaction: chargeId,
      metadata: {
        loadId,
        paymentIntentId,
        type: 'carrier_payout',
      },
    });

    return {
      success: true,
      chargeId,
      transferId: transfer.id,
      payoutCents,
    };
  }

  /**
   * Cancel a payment hold (e.g. load cancelled before delivery).
   *
   * @param {string} paymentIntentId - Stripe PaymentIntent ID
   * @param {string} [reason]        - Cancellation reason for records
   * @returns {Promise<{ success: boolean, status: string }>}
   */
  async cancelHold(paymentIntentId, reason) {
    if (!paymentIntentId) throw new Error('paymentIntentId is required');

    const stripe = getStripe();

    const cancelled = await stripe.paymentIntents.cancel(paymentIntentId, {
      cancellation_reason: 'requested_by_customer',
    });

    return {
      success: true,
      status: cancelled.status,
    };
  }

  /**
   * Refund a captured payment (full or partial), typically after a dispute.
   *
   * @param {string} paymentIntentId - Stripe PaymentIntent ID
   * @param {number|null} amountCents - Amount to refund in cents; null = full refund
   * @param {string} [reason]         - One of 'duplicate', 'fraudulent', 'requested_by_customer'
   * @returns {Promise<{ success: boolean, refundId: string, amountRefundedCents: number }>}
   */
  async refundPayment(paymentIntentId, amountCents, reason) {
    if (!paymentIntentId) throw new Error('paymentIntentId is required');

    if (amountCents !== null && amountCents !== undefined) {
      const validation = validateAmountCents(amountCents);
      if (!validation.valid) {
        throw new Error(`Invalid refund amount: ${validation.error}`);
      }
    }

    const stripe = getStripe();

    const refundParams = {
      payment_intent: paymentIntentId,
    };
    if (amountCents) {
      refundParams.amount = amountCents;
    }
    if (reason && ['duplicate', 'fraudulent', 'requested_by_customer'].includes(reason)) {
      refundParams.reason = reason;
    }

    const refund = await stripe.refunds.create(refundParams);

    return {
      success: true,
      refundId: refund.id,
      amountRefundedCents: refund.amount,
    };
  }

  /**
   * Verify a Stripe webhook signature.
   *
   * @param {Buffer|string} rawBody  - Raw request body
   * @param {string} signature        - stripe-signature header value
   * @returns {object} Parsed Stripe event
   * @throws {Error} If signature verification fails
   */
  static verifyWebhook(rawBody, signature) {
    const stripe = getStripe();
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }
    return stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  }
}

module.exports = new EscrowService();
