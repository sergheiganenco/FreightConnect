/**
 * What happens to the money when a load is delivered — one function for every delivery path
 * (the normal status route used by the web app and the phone, and the fleet page).
 *
 * Charges the shipper's card hold and pays the carrier (or holds / redirects for a factoring notice).
 * The payment record only ever advances to what actually happened; nothing is marked paid when the
 * payment provider is off or the charge fails. Never throws: delivery must not fail because of money.
 *
 * @returns {Promise<{ settled: boolean, reason?: string, status?: string }>}
 */
const Payment = require('../models/Payment');
const Invoice = require('../models/Invoice');
const User = require('../models/User');
const { getIO } = require('../utils/socket');

async function settleOnDelivery(loadId) {
  try {
    const payment = await Payment.findOne({ loadId, status: 'in_escrow' });
    if (!payment) return { settled: false, reason: 'no_hold' };
    if (!process.env.STRIPE_SECRET_KEY || !payment.stripePaymentIntentId) return { settled: false, reason: 'payments_off' };

    const carrier = await User.findById(payment.carrierId).select('stripe');
    const connectId = carrier && carrier.stripe && carrier.stripe.connectAccountId;
    if (!connectId) {
      // Left as a hold. The operations desk lists delivered loads whose hold was never collected.
      console.warn(`[deliver] Load ${loadId}: card hold in place but the carrier has no payout account; not collected.`);
      return { settled: false, reason: 'no_payout_account' };
    }

    const escrowService = require('./escrowService');
    let result;
    try {
      result = await escrowService.captureEscrow(payment.stripePaymentIntentId, String(loadId), connectId);
    } catch (e) {
      console.error(`[deliver] Load ${loadId}: charging the card hold failed; left as a hold:`, e.message);
      return { settled: false, reason: 'capture_failed' };
    }
    if (result.chargeId) payment.stripeChargeId = result.chargeId;
    if (result.transferId) {
      payment.status = 'released';
      payment.stripeTransferId = result.transferId;
      payment.releasedAt = new Date();
    } else {
      // Charged, but the payout was redirected to a factor, held, or the transfer failed.
      payment.status = 'captured';
      payment.payoutRoute = result.redirectedToFactor ? 'factor' : (result.payoutError ? 'carrier' : 'held');
    }
    await payment.save();

    // The shipper was charged in every outcome above, so the invoice is real.
    const load = await require('../models/Load').findById(loadId).select('title origin destination');
    if (!(await Invoice.findOne({ loadId }))) {
      await Invoice.create({
        loadId,
        shipperId: payment.shipperId,
        carrierId: payment.carrierId,
        subtotalCents: payment.amountCents,
        platformFeeCents: payment.platformFeeCents,
        totalCents: payment.amountCents,
        subtotal: payment.amount,
        platformFee: payment.platformFee,
        total: payment.amount,
        status: 'paid',
        paidAt: new Date(),
        issuedAt: new Date(),
        stripePaymentIntentId: payment.stripePaymentIntentId,
        lineItems: [{
          description: `Freight: ${load ? `${load.title} (${load.origin} → ${load.destination})` : loadId}`,
          quantity: 1,
          unitAmount: payment.amount,
          total: payment.amount,
        }],
      });
    }
    const io = getIO();
    if (io) {
      // Only tell the carrier they were paid if funds actually transferred to them.
      if (payment.status === 'released') io.to(`user_${payment.carrierId}`).emit('payment:released', { loadId, amount: payment.carrierPayout });
      io.to(`user_${payment.shipperId}`).emit('payment:released', { loadId, amount: payment.amount });
    }
    return { settled: true, status: payment.status };
  } catch (err) {
    console.error('[deliver] payment on delivery failed (non-fatal):', err.message);
    return { settled: false, reason: 'error' };
  }
}

module.exports = { settleOnDelivery };
