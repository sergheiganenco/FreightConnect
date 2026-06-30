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
const ledgerService = require('./ledgerService');
const { resolvePayee } = require('./factoringPaymentRouter');
const { notifyUserSafe, notifyAdmins } = require('../utils/notifyUser');
const Load = require('../models/Load');
const User = require('../models/User');

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

    // 1. Capture the held funds. This ALWAYS happens — the shipper's money is
    //    collected into escrow regardless of who the carrier-side payout goes to.
    const captured = await stripe.paymentIntents.capture(paymentIntentId);
    const chargeId = captured.latest_charge;
    const amountCents = captured.amount;
    const payoutCents = calculateCarrierPayout(amountCents);

    // 2. Determine who is allowed to receive the carrier-side payout.
    //    UCC §9-406 (see factoringPaymentRouter.js): if a factoring Notice of
    //    Assignment is on file we must NOT pay the carrier directly. We derive
    //    the carrierId from the captured intent metadata so this requires no
    //    signature change for existing callers/tests.
    //    FAIL SAFE: if the resolver throws for any reason, HOLD — never fall
    //    through to paying the carrier and risk a §9-406 double-payment.
    const carrierId = captured.metadata && captured.metadata.carrierId;
    let payee;
    try {
      payee = await resolvePayee(carrierId);
    } catch (e) {
      console.error('[escrowService] resolvePayee failed — holding payout:', e.message);
      payee = { payTo: 'hold', reason: 'Could not resolve factoring status — held for safety' };
    }

    // ── Path A: no NOA → normal carrier payout (BYTE-FOR-BYTE prior behavior) ──
    if (payee.payTo === 'carrier') {
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

      // Ledger: the carrier payable is paid out (drains carrier_payable into the
      // escrow_holding clearing account), and the platform fee is recognized as
      // revenue (drains the fee portion of escrow_holding). Both legs are balanced.
      // A ledger failure must NEVER break an actual payout — log and continue.
      try {
        const feeCents = calculatePlatformFee(amountCents);
        await ledgerService.record({
          transactionId: `carrier_payout_${transfer.id}`,
          loadId,
          entryType: 'carrier_payout',
          amountCents: payoutCents,
          debitAccount: 'carrier_payable',
          creditAccount: 'escrow_holding',
          description: `Carrier payout for Load ${loadId}`,
          stripeRef: transfer.id,
        });
        if (feeCents > 0) {
          await ledgerService.record({
            transactionId: `carrier_payout_${transfer.id}`,
            loadId,
            entryType: 'platform_fee',
            amountCents: feeCents,
            debitAccount: 'platform_revenue',
            creditAccount: 'escrow_holding',
            description: `Platform fee recognized for Load ${loadId}`,
            stripeRef: transfer.id,
          });
        }
      } catch (e) {
        console.error('[escrowService] ledger captureEscrow record failed:', e.message);
      }

      return {
        success: true,
        chargeId,
        transferId: transfer.id,
        payoutCents,
      };
    }

    // ── Path B: active verified NOA → pay the FACTOR, never the carrier ──
    // We do NOT auto-transfer to a random account. The platform owes the factor
    // via its own AP (out-of-band ACH/check). We record the obligation and
    // alert admin to remit it.
    if (payee.payTo === 'factor') {
      const factorName = payee.assignment?.factorCompanyName || 'factor';
      const remitTo = payee.assignment?.factorRemitTo || 'remit-to on file';
      try {
        await ledgerService.record({
          transactionId: `factor_remit_${loadId}_${chargeId}`,
          loadId,
          entryType: 'factor_remit',
          amountCents: payoutCents,
          debitAccount: 'carrier_payable',
          creditAccount: 'factor_payable',
          description: `Carrier payout REDIRECTED to factor "${factorName}" (${remitTo}) for Load ${loadId} per NOA (§9-406)`,
          stripeRef: null,
        });
      } catch (e) {
        console.error('[escrowService] ledger factor_remit record failed:', e.message);
      }
      await notifyAdmins({
        type: 'factoring:remit_due',
        title: 'Factor remittance due',
        body: `Load ${loadId}: $${(payoutCents / 100).toFixed(2)} owed to factor "${factorName}" — pay out-of-band (AP), NOT to carrier.`,
        link: '/dashboard/admin',
        metadata: { loadId, payoutCents, assignmentId: payee.assignment?._id, factorCompanyName: factorName },
      });

      return {
        success: true,
        chargeId,
        transferId: null,
        payoutCents,
        redirectedToFactor: true,
      };
    }

    // ── Path C: hold (pending NOA, competing claims, or resolver failure) ──
    // DO NOT transfer to anyone. Funds are captured into escrow; the carrier-side
    // disbursement is WITHHELD pending NOA resolution. Paying now is the exact
    // §9-406 risk.
    try {
      await ledgerService.record({
        transactionId: `payout_held_${loadId}_${chargeId}`,
        loadId,
        entryType: 'payout_held',
        amountCents: payoutCents,
        debitAccount: 'carrier_payable',
        creditAccount: 'payout_held',
        description: `Carrier payout HELD for Load ${loadId}: ${payee.reason || 'factoring NOA unresolved'} (§9-406)`,
        stripeRef: null,
      });
    } catch (e) {
      console.error('[escrowService] ledger payout_held record failed:', e.message);
    }
    await notifyAdmins({
      type: 'factoring:payout_held',
      title: 'Carrier payout held — NOA review',
      body: `Load ${loadId}: $${(payoutCents / 100).toFixed(2)} withheld. ${payee.reason || 'Factoring NOA unresolved.'}`,
      link: '/dashboard/admin',
      metadata: { loadId, payoutCents, reason: payee.reason, assignmentId: payee.assignment?._id },
    });

    return {
      success: true,
      chargeId,
      transferId: null,
      payoutCents,
      held: true,
      reason: payee.reason,
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
   * Path B — collect an approved accessorial (e.g. detention) from the shipper
   * OFF-SESSION (Merchant-Initiated Transaction) against their saved card.
   *
   * Does NOT mutate the charge — pure orchestration; the caller persists the
   * returned status. Stripe is injectable for testing.
   *
   * Preconditions (else a non-ok code the caller can fall back on):
   *   - Stripe configured           → else { code: 'stripe_unavailable' }
   *   - shipper customer + saved PM  → else { code: 'no_payment_method' }
   *   - shipper accepted the mandate → else { code: 'no_mandate' }
   *
   * @returns {Promise<{ ok, requiresAction?, status?, clientSecret?, paymentIntentId?, code?, error?, declineCode? }>}
   */
  async collectAccessorialFromShipper(loadId, chargeId, stripeClient) {
    let stripe;
    try { stripe = stripeClient || getStripe(); }
    catch (_) { return { ok: false, code: 'stripe_unavailable' }; }
    if (!stripe) return { ok: false, code: 'stripe_unavailable' };

    const load = await Load.findById(loadId).select('postedBy accessorialCharges');
    if (!load) return { ok: false, code: 'not_found', error: 'Load not found' };
    const charge = load.accessorialCharges.id(chargeId);
    if (!charge) return { ok: false, code: 'not_found', error: 'Charge not found' };

    const shipper = await User.findById(load.postedBy).select('stripe');
    const customerId = shipper && shipper.stripe && shipper.stripe.customerId;
    const pmId = shipper && shipper.stripe && shipper.stripe.defaultPaymentMethodId;
    const mandateAt = shipper && shipper.stripe && shipper.stripe.accessorialMandate
      && shipper.stripe.accessorialMandate.acceptedAt;
    if (!customerId || !pmId) return { ok: false, code: 'no_payment_method' };
    if (!mandateAt) return { ok: false, code: 'no_mandate' };

    try {
      const intent = await stripe.paymentIntents.create({
        amount: charge.amountCents,
        currency: 'usd',
        customer: customerId,
        payment_method: pmId,
        off_session: true,
        confirm: true,
        description: `FREIGHT ${String(charge.type).toUpperCase()}`,
        metadata: { loadId: String(load._id), chargeId: String(chargeId), type: 'accessorial_collect' },
      }, { idempotencyKey: `accessorial_collect_${chargeId}` });

      if (intent.status === 'succeeded') {
        return { ok: true, status: 'collected', paymentIntentId: intent.id };
      }
      if (intent.status === 'requires_action') {
        return { ok: false, requiresAction: true, status: 'requires_action', clientSecret: intent.client_secret, paymentIntentId: intent.id };
      }
      return { ok: false, code: 'unexpected_status', status: 'failed', error: `Unexpected payment status: ${intent.status}`, paymentIntentId: intent.id };
    } catch (err) {
      // Off-session SCA surfaces as a thrown error with the PI attached.
      if (err && err.code === 'authentication_required' && err.raw && err.raw.payment_intent) {
        const pi = err.raw.payment_intent;
        return { ok: false, requiresAction: true, status: 'requires_action', clientSecret: pi.client_secret, paymentIntentId: pi.id };
      }
      return { ok: false, code: 'card_error', status: 'failed', error: err.message, declineCode: err.decline_code };
    }
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
