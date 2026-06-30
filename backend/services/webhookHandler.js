/**
 * Centralized Stripe Webhook Event Handler
 *
 * Maps Stripe event types to handler functions.
 * Each handler updates Payment/Invoice records and sends notifications.
 */

const Payment = require('../models/Payment');
const Load = require('../models/Load');
const User = require('../models/User');
const { notifyUserSafe, notifyAdmins } = require('../utils/notifyUser');
const { centsToDollars, calculatePlatformFee, calculateCarrierPayout } = require('./paymentValidator');
const ledgerService = require('./ledgerService');

/**
 * Path B — an off-session accessorial (detention) collection succeeded. Mark the
 * charge collected and settle it to the carrier (funded by the collection).
 */
async function handleAccessorialCollected(pi) {
  const { loadId, chargeId } = pi.metadata || {};
  if (!loadId || !chargeId) return;
  const load = await Load.findById(loadId);
  if (!load) return;
  const charge = load.accessorialCharges.id(chargeId);
  if (!charge) return;
  if (charge.shipperPaymentStatus !== 'collected') {
    charge.shipperPaymentStatus = 'collected';
    charge.shipperPaymentIntentId = pi.id;
    await load.save();
  }
  // Settle to the carrier. settleAccessorialCharge requires status 'approved'
  // and is idempotent. Lazy-require breaks the paymentRoutes ↔ webhookHandler cycle.
  try {
    const { settleAccessorialCharge } = require('../routes/paymentRoutes');
    if (typeof settleAccessorialCharge === 'function') {
      await settleAccessorialCharge(loadId, chargeId);
    }
  } catch (e) {
    console.error('[webhookHandler] accessorial settle after collection failed:', e.message);
  }
}

/** Path B — an off-session accessorial collection failed. Flag + notify. */
async function handleAccessorialFailed(pi) {
  const { loadId, chargeId } = pi.metadata || {};
  if (!loadId || !chargeId) return;
  const load = await Load.findById(loadId);
  if (!load) return;
  const charge = load.accessorialCharges.id(chargeId);
  if (!charge) return;
  charge.shipperPaymentStatus = 'failed';
  await load.save();
  await notifyUserSafe(load.postedBy, {
    type: 'accessorial_payment_failed',
    title: 'Accessorial Payment Failed',
    body: `Your ${charge.type} payment of $${(charge.amountCents / 100).toFixed(2)} on "${load.title}" could not be collected. Please update your payment method.`,
    link: '/dashboard/shipper/loads',
    metadata: { loadId: String(load._id), chargeId: String(chargeId) },
  });
  await notifyAdmins({
    type: 'accessorial_payment_failed',
    title: 'Accessorial collection failed',
    body: `Load ${load._id}: ${charge.type} $${(charge.amountCents / 100).toFixed(2)} collection failed — carrier not yet paid.`,
    link: '/dashboard/admin',
    metadata: { loadId: String(load._id), chargeId: String(chargeId) },
  });
}

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

    // Path B — the card was saved with setup_future_usage; persist it so we can
    // charge accessorials (detention) off-session later.
    if (pi.payment_method) {
      await User.findByIdAndUpdate(payment.shipperId, { 'stripe.defaultPaymentMethodId': pi.payment_method });
    }

    // Flip the Load escrow flags now that funds are confirmed held at booking
    await Load.findOneAndUpdate(
      { escrowPaymentIntentId: pi.id },
      { escrowFunded: true, escrowFundedAt: new Date() }
    );

    const loadId = pi.metadata?.loadId || payment.loadId;
    const displayAmount = centsToDollars(pi.amount);

    // Ledger: shipper funds move into escrow holding. Never let a ledger failure
    // break the actual escrow state transition above.
    try {
      await ledgerService.record({
        transactionId: `escrow_hold_${pi.id}`,
        loadId,
        paymentId: payment._id,
        entryType: 'escrow_hold',
        amountCents: pi.amount,
        debitAccount: 'shipper_funds',
        creditAccount: 'escrow_holding',
        description: `Escrow hold for Load ${loadId}`,
        stripeRef: pi.id,
      });
    } catch (e) {
      console.error('[webhookHandler] ledger escrow_hold failed:', e.message);
    }

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

    // Path B — off-session accessorial collection (no Payment record).
    if (pi.metadata && pi.metadata.type === 'accessorial_collect') {
      return handleAccessorialCollected(pi);
    }

    const payment = await Payment.findOne({ stripePaymentIntentId: pi.id });
    if (!payment) return;

    // Only update if still in a pre-captured state
    if (!['pending', 'in_escrow'].includes(payment.status)) return;

    payment.status = 'captured';
    payment.stripeChargeId = pi.latest_charge || payment.stripeChargeId;
    await payment.save();

    const loadId = pi.metadata?.loadId || payment.loadId;
    const displayAmount = centsToDollars(pi.amount);

    // Ledger: captured escrow is split into the platform fee portion and the
    // carrier payable portion. Both legs debit escrow_holding so the total
    // captured drains out of holding and lands in revenue + carrier payable.
    try {
      const feeCents = payment.platformFeeCents != null
        ? payment.platformFeeCents
        : calculatePlatformFee(pi.amount);
      const payoutCents = payment.carrierPayoutCents != null
        ? payment.carrierPayoutCents
        : calculateCarrierPayout(pi.amount);

      if (feeCents > 0) {
        await ledgerService.record({
          transactionId: `escrow_capture_${pi.id}`,
          loadId,
          paymentId: payment._id,
          entryType: 'escrow_capture',
          amountCents: feeCents,
          debitAccount: 'escrow_holding',
          creditAccount: 'platform_revenue',
          description: `Platform fee on capture for Load ${loadId}`,
          stripeRef: pi.id,
        });
      }
      await ledgerService.record({
        transactionId: `escrow_capture_${pi.id}`,
        loadId,
        paymentId: payment._id,
        entryType: 'escrow_capture',
        amountCents: payoutCents,
        debitAccount: 'escrow_holding',
        creditAccount: 'carrier_payable',
        description: `Carrier payable on capture for Load ${loadId}`,
        stripeRef: pi.id,
      });
    } catch (e) {
      console.error('[webhookHandler] ledger escrow_capture failed:', e.message);
    }

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

    // Path B — off-session accessorial collection failed.
    if (pi.metadata && pi.metadata.type === 'accessorial_collect') {
      return handleAccessorialFailed(pi);
    }

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
  // Idempotency: Stripe retries webhooks. Mark the event once; if it was already
  // processed, short-circuit so we never double-apply money movements.
  const dup = await ledgerService.markProcessedOnce(event.id, event.type);
  if (dup) return { handled: true, duplicate: true, type: event.type };

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
