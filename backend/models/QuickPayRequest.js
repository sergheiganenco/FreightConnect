/**
 * QuickPayRequest — Early payment for carriers
 *
 * Carriers request accelerated payment (2 business days instead of 30+)
 * in exchange for a small fee (default 3%). Admin approves and marks
 * as paid once the Stripe transfer is initiated.
 *
 * Flow:
 *   Carrier requests QuickPay on a delivered load
 *   → Admin reviews + approves or rejects
 *   → Admin marks as paid (triggers Stripe transfer in production)
 */

const mongoose = require('mongoose');

const QuickPayRequestSchema = new mongoose.Schema({
  carrier: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
    index:    true,
  },
  loadId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Load',
    required: true,
    index:    true,
  },
  invoiceId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Invoice',
    required: true,
  },

  // Financial — stored in cents
  originalAmountCents: { type: Number, required: true },
  quickPayFeePct:      { type: Number, default: 3 },        // 3%
  quickPayFeeCents:    { type: Number, required: true },
  payoutAmountCents:   { type: Number, required: true },     // original - fee

  status: {
    type:    String,
    enum:    ['requested', 'approved', 'paid', 'rejected'],
    default: 'requested',
    index:   true,
  },

  requestedAt: { type: Date, default: Date.now },
  approvedAt:  { type: Date, default: null },
  approvedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  paidAt:      { type: Date, default: null },
  rejectedAt:  { type: Date, default: null },
  rejectedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  rejectionReason: { type: String, default: null },
}, { timestamps: true });

QuickPayRequestSchema.index({ carrier: 1, status: 1 });
QuickPayRequestSchema.index({ loadId: 1 }, { unique: true }); // one QuickPay per load

module.exports = mongoose.model('QuickPayRequest', QuickPayRequestSchema);
