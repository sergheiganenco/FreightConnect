/**
 * FactoringRequest — Freight Invoice Factoring
 *
 * Carriers submit delivered load invoices to FreightConnect Finance for
 * immediate advance payment (at a discounted rate), instead of waiting
 * 30-60 days for shipper payment.
 *
 * Flow:
 *   Carrier submits request (loads + invoiceTotal)
 *   → Admin reviews + approves or rejects
 *   → Admin marks as funded (advance sent to carrier's bank/Stripe)
 *   → Shipper pays normally → status becomes collected
 */

const mongoose = require('mongoose');

const HistorySchema = new mongoose.Schema({
  action:      String,
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  timestamp:   { type: Date, default: Date.now },
  details:     String,
}, { _id: false });

const FactoringRequestSchema = new mongoose.Schema({
  carrier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  // Loads being factored (must be delivered, belonging to this carrier)
  loads: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Load' }],

  // Financial amounts — stored in cents to avoid floating point
  invoiceTotalCents: { type: Number, required: true },  // sum of load rates
  advancePct:        { type: Number, default: 95 },     // % advanced (e.g. 95%)
  advanceCents:      { type: Number, required: true },   // carrier receives this
  feeCents:          { type: Number, required: true },   // factoring fee (retained)

  // Status lifecycle
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'funded', 'collected'],
    default: 'pending',
    index: true,
  },

  // Admin decision fields
  reviewedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt:      { type: Date, default: null },
  rejectionReason: { type: String, default: null },

  // Funding
  fundedAt:   { type: Date, default: null },
  fundingRef: { type: String, default: null }, // Stripe transfer ID or bank ref

  // Carrier notes
  notes: { type: String },

  // Factoring entity (extensible for real integrations)
  factoringCompany: { type: String, default: 'FreightConnect Finance' },

  history: [HistorySchema],
}, { timestamps: true });

FactoringRequestSchema.index({ carrier: 1, status: 1 });
FactoringRequestSchema.index({ createdAt: -1 });

module.exports = mongoose.model('FactoringRequest', FactoringRequestSchema);
