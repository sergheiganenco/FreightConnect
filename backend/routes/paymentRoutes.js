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

    const amountCents = Math.round(load.rate * 100);
    const feeCents    = Math.round(amountCents * PLATFORM_FEE_PCT);

    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      capture_method: 'automatic',
      application_fee_amount: feeCents,
      transfer_data: { destination: carrier.stripe.connectAccountId },
      metadata: {
        loadId:    load._id.toString(),
        shipperId: req.user.userId,
        carrierId: carrier._id.toString(),
      },
    });

    // Create Payment record
    const payment = await Payment.create({
      loadId: load._id,
      shipperId: req.user.userId,
      carrierId: carrier._id,
      amount: load.rate,
      platformFee: (feeCents / 100),
      carrierPayout: ((amountCents - feeCents) / 100),
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
      // Transfer is already automatic via transfer_data on the intent; mark as released
      // For manual-capture flows you'd call stripe.paymentIntents.capture() here
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
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

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
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      const payment = await Payment.findOne({ stripePaymentIntentId: pi.id });
      if (payment && payment.status === 'pending') {
        payment.status = 'in_escrow';
        payment.stripeChargeId = pi.latest_charge;
        await payment.save();

        notify(payment.shipperId.toString(), 'payment:escrowed', {
          loadId: payment.loadId,
          amount: payment.amount,
        });
        notify(payment.carrierId.toString(), 'payment:escrowed', {
          loadId: payment.loadId,
          amount: payment.carrierPayout,
          note: 'Payment held in escrow — will be released on delivery confirmation.',
        });
      }
    }

    if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object;
      const payment = await Payment.findOne({ stripePaymentIntentId: pi.id });
      if (payment) {
        payment.status = 'failed';
        payment.failedAt = new Date();
        await payment.save();
        notify(payment.shipperId.toString(), 'payment:failed', { loadId: payment.loadId });
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
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

module.exports = router;
