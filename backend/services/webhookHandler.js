/**
 * Centralized Stripe Webhook Event Handler
 *
 * Maps Stripe event types to handler functions.
 * Each handler updates Payment/Invoice records and sends notifications.
 */

const Payment = require('../models/Payment');
const Load = require('../models/Load');
const { notifyUserSafe } = require('../utils/notifyUser');
const { centsToDollars, calculatePlatformFee, calculateCarrierPayout } = require('./paymentValidator');

/**
 * Handler map — each key is a Stripe event type, value is an async handler.
 * Handlers receive the full Stripe event object.
 */
const HANDLERS = {
  /**
   * Funds held successfully (manual capture: card authorized but not yet charged).
   * Transition: pending → in_escrow
   */
  'payment_intent.amount_capturable_updated': async (event) => {
    const pi = event.data.object;
    const payment = await Payment.findOne({ stripePaymentIntentId: pi.id });
    if (!payment || payment.status !== 'pending') return;

    payment.status = 'in_escrow';
    payment.stripeChargeId = pi.latest_charge || null;
    await payment.save();

    const loadId = pi.metadata?.loadId || payment.loadId;
    const displayAmount = centsToDollars(pi.amount);

    await notifyUserSafe(payment.shipperId, {
      type: 'payment_hold_confirmed',
      title: 'Payment Hold Confirmed',
      body: `$${displayAmount} held in escrow for Load #${loadId}`,
      link: `/dashboard/shipper/loads`,
      metadata: { loadId: loadId.toString(), amount: pi.amount },
    });

    await notifyUserSafe(payment.carrierId, {
      type: 'payment_hold_confirmed',
      title: 'Payment Secured',
      body: `$${displayAmount} held in escrow — will be released on delivery confirmation.`,
      link: `/dashboard/carrier/loads`,
      metadata: { loadId: loadId.toString(), amount: pi.amount },
    });
  },

  /**
   * Funds captured (manual capture completed or auto-capture succeeded).
   * Transition: in_escrow → captured  (or pending → captured for auto-capture)
   */
  'payment_intent.succeeded': async (event) => {
    const pi = event.data.object;
    const payment = await Payment.findOne({ stripePaymentIntentId: pi.id });
    if (!payment) return;

    // Only update if still in a pre-captured state
    if (!['pending', 'in_escrow'].includes(payment.status)) return;

    payment.status = 'captured';
    payment.stripeChargeId = pi.latest_charge || payment.stripeChargeId;
    await payment.save();

    const loadId = pi.metadata?.loadId || payment.loadId;
    const displayAmount = centsToDollars(pi.amount);

    await notifyUserSafe(payment.carrierId, {
      type: 'payment_captured',
      title: 'Payment Captured',
      body: `$${displayAmount} captured for Load #${loadId}. Transfer to your account is processing.`,
      link: `/dashboard/carrier/payments`,
      metadata: { loadId: loadId.toString(), amount: pi.amount },
    });
  },

  /**
   * Payment failed (card declined, insufficient funds, etc.).
   * Transition: pending → failed
   */
  'payment_intent.payment_failed': async (event) => {
    const pi = event.data.object;
    const payment = await Payment.findOne({ stripePaymentIntentId: pi.id });
    if (!payment) return;

    payment.status = 'failed';
    payment.failedAt = new Date();
    await payment.save();

    const loadId = pi.metadata?.loadId || payment.loadId;

    await notifyUserSafe(payment.shipperId, {
      type: 'payment_failed',
      title: 'Payment Failed',
      body: `Payment for Load #${loadId} failed. Please update your payment method and try again.`,
      link: `/dashboard/shipper/loads`,
      metadata: { loadId: loadId.toString() },
    });
  },

  /**
   * Hold cancelled (load cancelled before delivery).
   * Transition: in_escrow → cancelled
   */
  'payment_intent.canceled': async (event) => {
    const pi = event.data.object;
    const payment = await Payment.findOne({ stripePaymentIntentId: pi.id });
    if (!payment) return;

    payment.status = 'cancelled';
    await payment.save();

    const loadId = pi.metadata?.loadId || payment.loadId;

    await notifyUserSafe(payment.shipperId, {
      type: 'payment_cancelled',
      title: 'Payment Hold Released',
      body: `The payment hold for Load #${loadId} has been released.`,
      link: `/dashboard/shipper/loads`,
      metadata: { loadId: loadId.toString() },
    });
  },

  /**
   * Transfer to carrier's Connect account created.
   * Transition: captured → released
   */
  'transfer.created': async (event) => {
    const transfer = event.data.object;
    const loadId = transfer.metadata?.loadId;
    const paymentIntentId = transfer.metadata?.paymentIntentId;

    if (!paymentIntentId && !loadId) return;

    const query = paymentIntentId
      ? { stripePaymentIntentId: paymentIntentId }
      : { loadId };
    const payment = await Payment.findOne(query);
    if (!payment) return;

    payment.status = 'released';
    payment.stripeTransferId = transfer.id;
    payment.releasedAt = new Date();
    await payment.save();

    const displayAmount = centsToDollars(transfer.amount);

    await notifyUserSafe(payment.carrierId, {
      type: 'payment_released',
      title: 'Funds Transferred',
      body: `$${displayAmount} has been transferred to your connected account.`,
      link: `/dashboard/carrier/payments`,
      metadata: { loadId: (loadId || payment.loadId).toString(), amount: transfer.amount },
    });
  },

  /**
   * Dispute opened by cardholder.
   * Flags the load and notifies admin.
   */
  'charge.dispute.created': async (event) => {
    const dispute = event.data.object;
    const chargeId = dispute.charge;

    // Find payment by charge ID
    const payment = await Payment.findOne({ stripeChargeId: chargeId });
    if (!payment) return;

    payment.status = 'disputed';
    await payment.save();

    // Flag the load as disputed
    const load = await Load.findById(payment.loadId);
    if (load && load.status !== 'disputed') {
      load.status = 'disputed';
      await load.save();
    }

    const displayAmount = centsToDollars(dispute.amount);

    // Notify shipper
    await notifyUserSafe(payment.shipperId, {
      type: 'payment_disputed',
      title: 'Payment Dispute Opened',
      body: `A $${displayAmount} dispute has been opened for Load #${payment.loadId}. Our team is reviewing.`,
      link: `/dashboard/shipper/loads`,
      metadata: { loadId: payment.loadId.toString(), disputeId: dispute.id },
    });

    // Notify carrier
    await notifyUserSafe(payment.carrierId, {
      type: 'payment_disputed',
      title: 'Payment Dispute Opened',
      body: `A $${displayAmount} dispute has been opened for Load #${payment.loadId}. Payouts may be paused.`,
      link: `/dashboard/carrier/payments`,
      metadata: { loadId: payment.loadId.toString(), disputeId: dispute.id },
    });
  },

  /**
   * Refund processed.
   * Transition: captured/released → refunded
   */
  'charge.refunded': async (event) => {
    const charge = event.data.object;
    const payment = await Payment.findOne({ stripeChargeId: charge.id });
    if (!payment) return;

    payment.status = 'refunded';
    payment.refundedAt = new Date();
    await payment.save();

    const displayAmount = centsToDollars(charge.amount_refunded);

    await notifyUserSafe(payment.shipperId, {
      type: 'payment_refunded',
      title: 'Refund Processed',
      body: `$${displayAmount} has been refunded for Load #${payment.loadId}.`,
      link: `/dashboard/shipper/loads`,
      metadata: { loadId: payment.loadId.toString(), amount: charge.amount_refunded },
    });
  },
};

/**
 * Process a Stripe webhook event.
 *
 * @param {object} event - Verified Stripe event object
 * @returns {Promise<{ handled: boolean, type: string }>}
 */
async function handleWebhookEvent(event) {
  const handler = HANDLERS[event.type];
  if (handler) {
    try {
      await handler(event);
      return { handled: true, type: event.type };
    } catch (err) {
      console.error(`[webhookHandler] Error processing ${event.type}:`, err.message);
      // Re-throw so the webhook endpoint can return 500 and Stripe will retry
      throw err;
    }
  }
  return { handled: false, type: event.type };
}

module.exports = { handleWebhookEvent };
