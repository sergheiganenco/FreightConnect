/**
 * Claim model — cargo claims (damage / loss / shortage / overage)
 *
 * Filed by:  the carrier or shipper party on a booked load.
 * Against:   the OTHER party (respondent) — companies, not bare users.
 * Status:    open → investigating → resolved | denied | withdrawn
 * Resolved by: admin (sets resolution + resolvedAmountCents in integer cents).
 *
 * All money is stored as INTEGER CENTS (never floats).
 */

const mongoose = require('mongoose');

const NoteSchema = new mongoose.Schema({
  author:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  authorRole: { type: String, enum: ['carrier', 'shipper', 'admin', 'system'] },
  content:    { type: String, required: true },
  createdAt:  { type: Date, default: Date.now },
}, { _id: true });

const ClaimSchema = new mongoose.Schema({
  // ── References ────────────────────────────────────────────────────────────
  loadId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Load', required: true },
  claimant:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // filing company (owner id)
  claimantRole: { type: String, enum: ['carrier', 'shipper'], required: true },
  respondent:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // other company (owner id)

  // ── Classification ────────────────────────────────────────────────────────
  type: {
    type: String,
    enum: ['damage', 'loss', 'shortage', 'overage'],
    required: true,
  },

  // ── Content ───────────────────────────────────────────────────────────────
  amountCents:  { type: Number, required: true }, // claimed amount, INTEGER CENTS
  description:  { type: String, required: true },
  evidenceUrls: { type: [String], default: [] },

  // ── Status lifecycle ──────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['open', 'investigating', 'resolved', 'denied', 'withdrawn'],
    default: 'open',
  },
  resolution:         { type: String, default: null }, // admin notes on close
  resolvedAmountCents:{ type: Number, default: null }, // approved payout, INTEGER CENTS
  resolvedAt:         { type: Date },
  resolvedBy:         { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // ── Thread ────────────────────────────────────────────────────────────────
  notes: [NoteSchema],

}, { timestamps: true });

// Indexes for fast lookups by load, status, and each party.
ClaimSchema.index({ loadId: 1 });
ClaimSchema.index({ status: 1, createdAt: -1 });
ClaimSchema.index({ claimant: 1 });
ClaimSchema.index({ respondent: 1 });

module.exports = mongoose.model('Claim', ClaimSchema);
