/**
 * Payment Routes — Stripe Connect escrow flow
 *
 * Flow:
 *  1. Carrier → POST /connect/onboard  → gets Stripe Connect Express onboarding URL
 *  2. Stripe  → GET  /connect/refresh  → re-sends onboarding link (if expired)
 *  3. Shipper → POST /intent/:loadId   → creates PaymentIntent (escrow hold)
 *  4. Stripe  → POST /webhook          → handles payment_intent.succeeded, transfer events
 *  5. System  → POST /release/:loadId  → releases escrow to carrier after delivery
 *  6. Any     → GET  /my              → paginated payment history
 *  7. Any     → GET  /invoice/:loadId → get invoice for a load
 */

const express = require('express');
const router = express.Router();
const auth = require('../middlewares/authMiddleware');
const User = require('../models/User');
const Load = require('../models/Load');
const Payment = require('../models/Payment');
const Invoice = require('../models/Invoice');
const { getIO } = require('../utils/socket');
const escrowService = require('../services/escrowService');
const { handleWebhookEvent } = require('../services/webhookHandler');
const { validateAmountCents, calculatePlatformFee, calculateCarrierPayout, centsToDollars } = require('../services/paymentValidator');
const { notifyUserSafe, notifyAdmins } = require('../utils/notifyUser');
const ledgerService = require('../services/ledgerService');
const { resolvePayee } = require('../services/factoringPaymentRouter');

// ── Stripe client (graceful degradation if key missing) ──────────────────────
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
} else {
  console.warn('[payments] STRIPE_SECRET_KEY not set — Stripe features disabled');
}

const PLATFORM_FEE_PCT = 0.02; // 2% platform fee
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

function stripeRequired(req, res, next) {
  if (!stripe) return res.status(503).json({ error: 'Payment system not configured. Set STRIPE_SECRET_KEY.' });
  next();
}

function notify(userId, event, payload) {
  try { getIO().to(`user_${userId}`).emit(event, payload); } catch (_) {}
}

// ────────────────────────────────────────────────────────────────────────────
// POST /api/payments/connect/onboard — carrier starts Stripe Connect onboarding
// ────────────────────────────────────────────────────────────────────────────
router.post('/connect/onboard', auth, stripeRequired, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });

    const user = await User.findById(req.user.userId);
    let accountId = user.stripe?.connectAccountId;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: user.email,
        capabilities: { transfers: { requested: true } },
        business_type: 'company',
        metadata: { userId: user._id.toString() },
      });
      accountId = account.id;
      await User.findByIdAndUpdate(user._id, { 'stripe.connectAccountId': accountId });
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${FRONTEND_URL}/dashboard/carrier/payments?onboard=refresh`,
      return_url:  `${FRONTEND_URL}/dashboard/carrier/payments?onboard=success`,
      type: 'account_onboarding',
    });

    res.json({ url: accountLink.url });
  } catch (err) {
    console.error('Connect onboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/payments/connect/status — carrier checks their Connect account status
// ────────────────────────────────────────────────────────────────────────────
router.get('/connect/status', auth, stripeRequired, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
    const user = await User.findById(req.user.userId);
    if (!user.stripe?.connectAccountId) {
      return res.json({ connected: false, payoutsEnabled: false });
    }
    const account = await stripe.accounts.retrieve(user.stripe.connectAccountId);
    const payoutsEnabled = account.payouts_enabled;
    // Keep DB in sync
    await User.findByIdAndUpdate(user._id, {
      'stripe.connectPayoutsEnabled': payoutsEnabled,
      'stripe.connectOnboardingDone': account.details_submitted,
    });
    res.json({
      connected: true,
      payoutsEnabled,
      detailsSubmitted: account.details_submitted,
      chargesEnabled: account.charges_enabled,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/payments/intent/:loadId — shipper creates escrow PaymentIntent
// ────────────────────────────────────────────────────────────────────────────
router.post('/intent/:loadId', auth, stripeRequired, async (req, res) => {
  try {
    if (req.user.role !== 'shipper') return res.status(403).json({ error: 'Shippers only' });

    const load = await Load.findById(req.params.loadId).populate('acceptedBy');
    if (!load) return res.status(404).json({ error: 'Load not found' });
    if (load.postedBy.toString() !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    if (load.status !== 'accepted') return res.status(409).json({ error: 'Load must be accepted before payment' });

    // Check carrier has Connect account with payouts enabled
    const carrier = await User.findById(load.acceptedBy);
    if (!carrier?.stripe?.connectAccountId) {
      return res.status(409).json({ error: 'Carrier has not completed payment onboarding yet' });
    }

    // Check for existing pending payment
    const existing = await Payment.findOne({ loadId: load._id, status: { $in: ['pending', 'in_escrow'] } });
    if (existing) {
      return res.json({ clientSecret: existing.stripeClientSecret, paymentId: existing._id });
    }

    const amountCents = load.rateCents != null ? load.rateCents : Math.round(load.rate * 100);
    const feeCents    = calculatePlatformFee(amountCents);
    const payoutCents = calculateCarrierPayout(amountCents);

    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      capture_method: 'manual',  // TRUE ESCROW — hold funds, capture on delivery
      metadata: {
        loadId:    load._id.toString(),
        shipperId: req.user.userId,
        carrierId: carrier._id.toString(),
        type:      'freight_escrow',
      },
    });

    // Create Payment record
    const payment = await Payment.create({
      loadId: load._id,
      shipperId: req.user.userId,
      carrierId: carrier._id,
      amountCents,
      platformFeeCents: feeCents,
      carrierPayoutCents: payoutCents,
      amount: load.rate,
      platformFee: centsToDollars(feeCents),
      carrierPayout: centsToDollars(payoutCents),
      status: 'pending',
      stripePaymentIntentId: intent.id,
      stripeClientSecret: intent.client_secret,
    });

    res.json({ clientSecret: intent.client_secret, paymentId: payment._id });
  } catch (err) {
    console.error('Create intent error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/payments/fund-escrow/:loadId — shipper authorizes the escrow hold
// (creates or reuses a manual-capture PaymentIntent and returns a clientSecret
//  for the shipper to confirm via Stripe Elements on the client).
// ────────────────────────────────────────────────────────────────────────────
router.post('/fund-escrow/:loadId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'shipper') return res.status(403).json({ error: 'Shippers only' });

    const load = await Load.findById(req.params.loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });
    if (load.postedBy.toString() !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    if (load.status !== 'accepted') return res.status(409).json({ error: 'Load must be accepted before funding' });

    // Record the shipper's mandate authorizing later off-session accessorial
    // charges (detention/lumper). Required before any Path B collection.
    if (req.body && req.body.mandateAccepted) {
      await User.findByIdAndUpdate(req.user.userId, {
        'stripe.accessorialMandate': {
          acceptedAt: new Date(),
          version: req.body.mandateVersion || 'v1',
          ip: req.ip || (req.headers && req.headers['x-forwarded-for']) || null,
        },
      });
    }

    const result = await createEscrowHoldForLoad(load._id);

    if (result.error) {
      // Stripe not configured → surface a clear 503; other helper errors → 502
      if (/not configured/i.test(result.error)) {
        return res.status(503).json({ error: 'Payment system not configured' });
      }
      return res.status(502).json({ error: result.error });
    }

    res.json({
      clientSecret: result.clientSecret,
      paymentIntentId: result.paymentIntentId,
      alreadyFunded: result.funded === true,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || process.env.REACT_APP_STRIPE_PUBLIC_KEY || null,
    });
  } catch (err) {
    console.error('[payments] fund-escrow failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/payments/release/:loadId — release escrow to carrier (called on delivery)
// ────────────────────────────────────────────────────────────────────────────
router.post('/release/:loadId', auth, async (req, res) => {
  try {
    const load = await Load.findById(req.params.loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });

    // Only shipper who owns the load or admin can trigger release
    const isShipper = req.user.role === 'shipper' && load.postedBy.toString() === req.user.userId;
    const isAdmin   = req.user.role === 'admin';
    if (!isShipper && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

    const payment = await Payment.findOne({ loadId: load._id, status: 'in_escrow' });
    if (!payment) return res.status(404).json({ error: 'No escrowed payment found for this load' });

    if (stripe) {
      // Capture the held funds
      await stripe.paymentIntents.capture(payment.stripePaymentIntentId);

      // Transfer to carrier minus platform fee
      const carrier = await User.findById(payment.carrierId);
      if (carrier?.stripe?.connectAccountId) {
        const payoutCents = payment.carrierPayoutCents || Math.round(payment.carrierPayout * 100);
        await stripe.transfers.create({
          amount: payoutCents,
          currency: 'usd',
          destination: carrier.stripe.connectAccountId,
          transfer_group: `load_${load._id}`,
          metadata: { loadId: load._id.toString() },
        });
      }
    }

    payment.status = 'released';
    payment.releasedAt = new Date();
    await payment.save();

    // Generate invoice
    const invoice = await generateInvoice(load, payment);

    notify(payment.carrierId.toString(), 'payment:released', {
      loadId: load._id,
      amount: payment.carrierPayout,
      invoiceId: invoice._id,
    });

    res.json({ success: true, payment, invoice });
  } catch (err) {
    console.error('Release payment error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/payments/my — paginated payment history for current user
// ────────────────────────────────────────────────────────────────────────────
router.get('/my', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const filter = req.user.role === 'shipper'
      ? { shipperId: req.user.userId }
      : req.user.role === 'carrier'
      ? { carrierId: req.user.userId }
      : {};

    const [payments, total] = await Promise.all([
      Payment.find(filter)
        .populate('loadId', 'title origin destination')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit)),
      Payment.countDocuments(filter),
    ]);

    res.json({ payments, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/payments/invoice/:loadId — get invoice for a load
// ────────────────────────────────────────────────────────────────────────────
router.get('/invoice/:loadId', auth, async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ loadId: req.params.loadId })
      .populate('shipperId', 'name companyName email')
      .populate('carrierId', 'name companyName email');
    // No invoice yet is a normal state (pre-payment) — return 200 null so the
    // UI's routine probe doesn't spam the browser console with 404 errors.
    if (!invoice) return res.json(null);

    // Only shipper, carrier, or admin can view
    const userId = req.user.userId;
    if (
      invoice.shipperId._id.toString() !== userId &&
      invoice.carrierId._id.toString() !== userId &&
      req.user.role !== 'admin'
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/payments/webhook — Stripe webhook (uses req.rawBody captured by express.json verify)
// ────────────────────────────────────────────────────────────────────────────
router.post('/webhook', async (req, res) => {
  if (!stripe) return res.status(200).end();

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody || req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const result = await handleWebhookEvent(event);
    if (!result.handled) {
      console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error('[Webhook] Handler error:', err.message);
  }

  res.json({ received: true });
});

// ────────────────────────────────────────────────────────────────────────────
// Internal helper — generate invoice after payment release
// ────────────────────────────────────────────────────────────────────────────
async function generateInvoice(load, payment) {
  const existing = await Invoice.findOne({ loadId: load._id });
  if (existing) return existing;

  const invoice = await Invoice.create({
    loadId:    load._id,
    shipperId: payment.shipperId,
    carrierId: payment.carrierId,
    subtotal:  payment.amount,
    platformFee: payment.platformFee,
    total:     payment.amount,
    status:    'paid',
    paidAt:    new Date(),
    issuedAt:  new Date(),
    stripePaymentIntentId: payment.stripePaymentIntentId,
    lineItems: [{
      description: `Freight service: ${load.title} (${load.origin} → ${load.destination})`,
      quantity:    1,
      unitAmount:  payment.amount,
      total:       payment.amount,
    }],
  });
  return invoice;
}

/**
 * Returns true if the shipper has a usable payment method on file
 * (Stripe customer with default payment method, OR a funded escrow capability).
 */
async function shipperHasPaymentMethod(shipperId) {
  try {
    const user = await User.findById(shipperId).select('stripe');
    if (!user) return false;
    // Consider payment assured if shipper has a Stripe customer id (card on file)
    return Boolean(user.stripe && user.stripe.customerId);
  } catch (_) {
    return false;
  }
}

/**
 * Create (or reuse) a manual-capture escrow hold for a load at booking time.
 * Returns { funded, paymentIntentId, clientSecret, error }.
 * funded=true only once the hold is confirmed (via webhook). At creation time
 * funded=false but a clientSecret is returned for the shipper to confirm.
 */
async function createEscrowHoldForLoad(loadId) {
  try {
    if (!stripe) return { funded: false, error: 'Stripe not configured' };
    const load = await Load.findById(loadId);
    if (!load) return { funded: false, error: 'Load not found' };

    // Reuse existing hold if present
    const existing = await Payment.findOne({ loadId: load._id, status: { $in: ['pending', 'in_escrow'] } });
    if (existing) {
      return { funded: existing.status === 'in_escrow', paymentIntentId: existing.stripePaymentIntentId, clientSecret: existing.stripeClientSecret };
    }

    const amountCents = load.rateCents != null ? load.rateCents : Math.round(load.rate * 100);
    const feeCents = calculatePlatformFee(amountCents);
    const payoutCents = calculateCarrierPayout(amountCents);

    // Ensure the shipper has a Stripe customer so the card can be SAVED for
    // later off-session accessorial (detention) charges — Path B prerequisite.
    const shipper = await User.findById(load.postedBy).select('stripe email name');
    let customerId = shipper && shipper.stripe && shipper.stripe.customerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: shipper && shipper.email,
        name: shipper && shipper.name,
        metadata: { userId: String(load.postedBy) },
      });
      customerId = customer.id;
      await User.findByIdAndUpdate(load.postedBy, { 'stripe.customerId': customerId });
    }

    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      capture_method: 'manual',  // hold/authorize, capture on delivery
      customer: customerId,
      // Save the card for later merchant-initiated accessorial charges (Path B).
      setup_future_usage: 'off_session',
      metadata: { loadId: String(load._id), shipperId: String(load.postedBy), carrierId: String(load.acceptedBy || ''), type: 'freight_escrow' },
    });

    await Payment.create({
      loadId: load._id,
      shipperId: load.postedBy,
      carrierId: load.acceptedBy,
      amountCents, platformFeeCents: feeCents, carrierPayoutCents: payoutCents,
      amount: amountCents / 100, platformFee: feeCents / 100, carrierPayout: payoutCents / 100,
      status: 'pending',
      stripePaymentIntentId: intent.id,
      stripeClientSecret: intent.client_secret,
    });

    await Load.findByIdAndUpdate(load._id, { escrowPaymentIntentId: intent.id });
    return { funded: false, paymentIntentId: intent.id, clientSecret: intent.client_secret };
  } catch (err) {
    return { funded: false, error: err.message };
  }
}

/**
 * Settle (pay out) an approved accessorial charge to the carrier.
 * For simplicity, creates a Stripe transfer to the carrier's connect account.
 * Returns { ok, transferId, error }.
 */
async function settleAccessorialCharge(loadId, chargeId) {
  try {
    const load = await Load.findById(loadId);
    if (!load) return { ok: false, error: 'Load not found' };
    const charge = load.accessorialCharges.id(chargeId);
    if (!charge) return { ok: false, error: 'Charge not found' };
    if (charge.status !== 'approved') return { ok: false, error: 'Charge not approved' };

    // Idempotency: guard against double-paying the same accessorial charge.
    // If already processed, return without transferring again.
    const alreadyProcessed = await ledgerService.markProcessedOnce('accessorial_' + chargeId, 'accessorial_settle');
    if (alreadyProcessed) return { ok: true, alreadySettled: true };

    // UCC §9-406 (see factoringPaymentRouter.js): if a factoring Notice of
    // Assignment is on file, the carrier's earnings (including accessorials)
    // may NOT be paid to the carrier. FAIL SAFE — if the resolver throws, HOLD.
    let payee;
    try {
      payee = await resolvePayee(load.acceptedBy);
    } catch (e) {
      console.error('[settleAccessorialCharge] resolvePayee failed — holding:', e.message);
      payee = { payTo: 'hold', reason: 'Could not resolve factoring status — held for safety' };
    }

    // ── Path B: active verified NOA → owe the factor, do NOT pay carrier ──
    // Charge stays 'approved' (NOT 'paid'); it is owed to the factor and
    // settled out-of-band via AP.
    if (payee.payTo === 'factor') {
      const factorName = payee.assignment?.factorCompanyName || 'factor';
      const remitTo = payee.assignment?.factorRemitTo || 'remit-to on file';
      try {
        await ledgerService.record({
          transactionId: 'accessorial_' + chargeId,
          loadId: load._id,
          entryType: 'factor_remit',
          amountCents: charge.amountCents,
          debitAccount: 'accessorial_payable',
          creditAccount: 'factor_payable',
          description: `Accessorial (${charge.type}) REDIRECTED to factor "${factorName}" (${remitTo}) for Load ${load._id} per NOA (§9-406)`,
          stripeRef: null,
        });
      } catch (e) {
        console.error('[settleAccessorialCharge] ledger factor_remit record failed:', e.message);
      }
      charge.note = `Redirected to factor "${factorName}" per NOA (§9-406) — pay out-of-band, not carrier.`;
      await load.save();
      await notifyAdmins({
        type: 'factoring:remit_due',
        title: 'Factor remittance due (accessorial)',
        body: `Load ${load._id}: $${(charge.amountCents / 100).toFixed(2)} accessorial owed to factor "${factorName}" — pay AP, NOT carrier.`,
        link: '/dashboard/admin',
        metadata: { loadId: String(load._id), chargeId: String(chargeId), amountCents: charge.amountCents, factorCompanyName: factorName },
      });
      return { ok: true, redirectedToFactor: true };
    }

    // ── Path C: hold (pending NOA, competing claims, or resolver failure) ──
    if (payee.payTo === 'hold') {
      try {
        await ledgerService.record({
          transactionId: 'accessorial_' + chargeId,
          loadId: load._id,
          entryType: 'payout_held',
          amountCents: charge.amountCents,
          debitAccount: 'accessorial_payable',
          creditAccount: 'payout_held',
          description: `Accessorial (${charge.type}) HELD for Load ${load._id}: ${payee.reason || 'factoring NOA unresolved'} (§9-406)`,
          stripeRef: null,
        });
      } catch (e) {
        console.error('[settleAccessorialCharge] ledger payout_held record failed:', e.message);
      }
      await notifyAdmins({
        type: 'factoring:payout_held',
        title: 'Accessorial payout held — NOA review',
        body: `Load ${load._id}: $${(charge.amountCents / 100).toFixed(2)} accessorial withheld. ${payee.reason || 'Factoring NOA unresolved.'}`,
        link: '/dashboard/admin',
        metadata: { loadId: String(load._id), chargeId: String(chargeId), amountCents: charge.amountCents, reason: payee.reason },
      });
      return { ok: true, held: true, reason: payee.reason };
    }

    // ── Path A: no NOA → normal carrier settlement (prior behavior) ──
    let transferId;
    if (stripe) {
      const carrier = await User.findById(load.acceptedBy).select('stripe');
      if (carrier?.stripe?.connectAccountId) {
        const transfer = await stripe.transfers.create({
          amount: charge.amountCents,
          currency: 'usd',
          destination: carrier.stripe.connectAccountId,
          transfer_group: `load_${load._id}`,
          metadata: { loadId: String(load._id), accessorialType: charge.type },
        });
        transferId = transfer.id;
      }
    }
    charge.status = 'paid';
    charge.paidAt = new Date();
    await load.save();

    // Ledger: accessorial payable is settled to the carrier. Never let a ledger
    // failure undo the actual transfer/state change above.
    try {
      await ledgerService.record({
        transactionId: 'accessorial_' + chargeId,
        loadId: load._id,
        entryType: 'accessorial_settle',
        amountCents: charge.amountCents,
        debitAccount: 'accessorial_payable',
        creditAccount: 'carrier_payable',
        description: `Accessorial (${charge.type}) settled for Load ${load._id}`,
        stripeRef: transferId || null,
      });
    } catch (e) {
      console.error('[settleAccessorialCharge] ledger record failed:', e.message);
    }

    return { ok: true, transferId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = router;
module.exports.shipperHasPaymentMethod = shipperHasPaymentMethod;
module.exports.createEscrowHoldForLoad = createEscrowHoldForLoad;
module.exports.settleAccessorialCharge = settleAccessorialCharge;
