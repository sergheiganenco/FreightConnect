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

  // Amount in dollars (app convention)
  amount:       { type: Number, required: true },
  platformFee:  { type: Number, default: 0 },
  carrierPayout:{ type: Number },   // amount - platformFee

  status: {
    type: String,
    enum: ['pending', 'in_escrow', 'released', 'refunded', 'failed'],
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

module.exports = mongoose.model('Payment', PaymentSchema);
