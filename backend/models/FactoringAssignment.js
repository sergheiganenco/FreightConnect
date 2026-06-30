const mongoose = require('mongoose');

/**
 * Factoring Notice of Assignment (NOA).
 *
 * LEGAL ENCODING — UCC Article 9 §9-406 payment redirection.
 * This is an ENCODING of expected §9-406 behavior, NOT legal advice. Once a
 * debtor (here, the platform paying on a load) receives a valid Notice of
 * Assignment, paying anyone other than the assignee (the factoring company)
 * does NOT discharge the debt — the platform could be forced to pay AGAIN to
 * the factor. The NOA document itself, its validity, releases, and the
 * resolution of competing claims MUST be reviewed by legal counsel. This
 * model + the factoringPaymentRouter service enforce the SAFE payout behavior
 * (hold when uncertain) so the platform is never the party that double-pays.
 *
 * NOTE: This is DIFFERENT from FactoringRequest.js — that model is a carrier
 * requesting an advance FROM the platform. This model is an EXTERNAL factor
 * directing where the carrier's earnings must be remitted. They complement,
 * not collide.
 */
const FactoringAssignmentSchema = new mongoose.Schema({
  carrier:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  factorCompanyName: { type: String, required: true },
  factorRemitTo:  { type: String, default: null },   // bank/ACH remit-to or address (free text; no raw bank secrets logged)
  factorContactEmail: { type: String, default: null },
  factorContactPhone: { type: String, default: null },
  noaDocumentUrl: { type: String, default: null },   // uploaded NOA letter
  effectiveDate:  { type: Date, default: null },
  status: { type: String, enum: ['pending_verification','active','released','rejected','disputed'], default: 'pending_verification', index: true },
  verifiedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  verifiedAt:  { type: Date, default: null },
  releasedAt:  { type: Date, default: null },
  releaseDocumentUrl: { type: String, default: null },
  disputeReason: { type: String, default: null },
  history: [{ action: String, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now }, note: String }],
}, { timestamps: true });

// Helpful for the payee lookup
FactoringAssignmentSchema.index({ carrier: 1, status: 1 });

module.exports = mongoose.model('FactoringAssignment', FactoringAssignmentSchema);
