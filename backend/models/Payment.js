const mongoose = require('mongoose');

/**
 * Payment — tracks each Stripe transaction for a load.
 * A load can have multiple payment events (authorized → captured → transferred).
 */
const PaymentSchema = new mongoose.Schema({
  loadId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Load', required: true },
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
  shipperId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  carrierId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Canonical money fields — integer cents (source of truth)
  amountCents:        { type: Number },
  platformFeeCents:   { type: Number, default: 0 },
  carrierPayoutCents: { type: Number },   // amountCents - platformFeeCents

  // Dollar shadow fields (backward-compat, app convention)
  amount:       { type: Number, required: true },
  platformFee:  { type: Number, default: 0 },
  carrierPayout:{ type: Number },   // amount - platformFee

  status: {
    type: String,
    // captured  = funds captured into escrow, carrier payout not yet transferred
    // cancelled = authorization hold released (load cancelled before delivery)
    // disputed  = cardholder chargeback opened
    enum: ['pending', 'in_escrow', 'captured', 'released', 'refunded', 'cancelled', 'disputed', 'failed'],
    default: 'pending',
  },

  // Stripe IDs
  stripePaymentIntentId: { type: String, index: true },
  stripeClientSecret:    String,   // returned to frontend for card element
  stripeTransferId:      String,   // payout to carrier after delivery
  stripeChargeId:        String,

  releasedAt: Date,
  refundedAt: Date,
  failedAt:   Date,
}, { timestamps: true });

// Indexes for common query patterns
PaymentSchema.index({ loadId: 1 });
PaymentSchema.index({ carrierId: 1, status: 1 });
PaymentSchema.index({ shipperId: 1, status: 1 });
PaymentSchema.index({ status: 1 });

module.exports = mongoose.model('Payment', PaymentSchema);
