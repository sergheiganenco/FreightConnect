const mongoose = require('mongoose');

/**
 * OpsProposal — what the operations desk recommended for a case, and what a person then decided.
 * This is the "shadow mode" record: a case type earns automatic handling only when its proposals keep matching
 * the human decision. One row per case (kind + caseId).
 */
const OpsProposalSchema = new mongoose.Schema({
  kind:    { type: String, required: true, enum: ['claim', 'exception', 'carrier_verification', 'review', 'fraud'] },
  caseId:  { type: mongoose.Schema.Types.ObjectId, required: true },
  action:  { type: String, required: true, enum: ['approve', 'deny', 'resolve', 'dismiss'] }, // what the rules proposed
  rule:    { type: String, required: true }, // which rule proposed it (stable id, for per-rule accuracy)
  reason:  { type: String, required: true },
  source:  { type: String, enum: ['rules', 'ai'], default: 'rules' },
  outcome: { type: String, enum: ['approve', 'deny', 'resolve', 'dismiss', null], default: null }, // what the person decided
  agreed:  { type: Boolean, default: null },
  decidedAt: { type: Date, default: null },
}, { timestamps: true });

OpsProposalSchema.index({ kind: 1, caseId: 1 }, { unique: true });
OpsProposalSchema.index({ outcome: 1, kind: 1 }); // open proposals to settle; per-kind accuracy

module.exports = mongoose.model('OpsProposal', OpsProposalSchema);
