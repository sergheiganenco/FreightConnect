/**
 * A document a driver has to be able to produce at the roadside or a manager has to keep current:
 * registration, annual inspection, insurance card, IFTA licence, permits, medical card and so on.
 * The file itself is private (public/documents/compliance, never served statically).
 */
const mongoose = require('mongoose');
const { Schema, Types: { ObjectId } } = mongoose;

const KINDS = [
  'registration', 'annual_inspection', 'insurance_card', 'ifta_license', 'irp_cab_card', 'permit',
  'lease_agreement', 'cdl', 'medical_card', 'hazmat_endorsement', 'twic', 'other',
];

const ComplianceDocSchema = new Schema({
  company:     { type: ObjectId, ref: 'User', required: true },
  subjectType: { type: String, enum: ['company', 'truck', 'trailer', 'driver'], required: true },
  subjectId:   { type: String, maxlength: 60, default: '' },   // truckId / trailer number / driverId; '' for company
  kind:        { type: String, enum: KINDS, required: true },
  label:       { type: String, maxlength: 120 },
  number:      { type: String, maxlength: 80 },
  expiresAt:   { type: Date, default: null },
  file:        { type: String, default: null },   // stored name inside the private folder
  mimeType:    { type: String, default: null },
  uploadedBy:  { type: ObjectId, ref: 'User' },
}, { timestamps: true });

ComplianceDocSchema.index({ company: 1, subjectType: 1, subjectId: 1 });
ComplianceDocSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('ComplianceDoc', ComplianceDocSchema);
module.exports.KINDS = KINDS;
