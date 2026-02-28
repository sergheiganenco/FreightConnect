const mongoose = require('mongoose');
const { Schema, Types: { ObjectId } } = mongoose;

// ── W-9 / 1099 filing info submitted by carrier ────────────────────────────
const W9Schema = new Schema({
  legalName:      { type: String, required: true },
  businessName:   String,
  taxClassification: {
    type: String,
    enum: ['individual', 'sole_proprietor', 'llc_single', 'llc_partnership', 'llc_corp', 'c_corp', 's_corp', 'partnership', 'trust', 'other'],
    required: true,
  },
  ein:            String,    // Employer Identification Number (masked)
  ssn:            String,    // last 4 only, never full SSN stored
  address:        String,
  city:           String,
  state:          String,
  zip:            String,
  certifiedAt:    { type: Date, default: Date.now },
  exemptPayeeCode: String,
  fatcaCode:      String,
}, { _id: false });

// ── Annual tax summary record ──────────────────────────────────────────────
const TaxRecordSchema = new Schema({
  user:      { type: ObjectId, ref: 'User', required: true, index: true },
  role:      { type: String, enum: ['carrier', 'shipper'], required: true },
  taxYear:   { type: Number, required: true },           // e.g. 2025

  // Carrier fields
  totalEarningsCents:  { type: Number, default: 0 },    // gross platform earnings
  platformFeeCents:    { type: Number, default: 0 },    // fees paid to platform
  netEarningsCents:    { type: Number, default: 0 },    // totalEarnings - platformFee
  loadCount:           { type: Number, default: 0 },
  estimatedMilesDriven: { type: Number, default: 0 },   // from accepted loads (rough)
  requires1099:        { type: Boolean, default: false }, // true if earnings >= $600

  // Shipper fields
  totalSpendCents:     { type: Number, default: 0 },
  loadPostedCount:     { type: Number, default: 0 },

  // W-9 (carrier only)
  w9:        { type: W9Schema, default: null },
  w9Status:  { type: String, enum: ['not_submitted', 'submitted', 'verified', 'rejected'], default: 'not_submitted' },

  // 1099 generation (admin triggers)
  form1099Status: { type: String, enum: ['not_required', 'pending', 'generated', 'sent'], default: 'not_required' },
  form1099Url:    String,
  generatedAt:    Date,
  sentAt:         Date,

  // Audit
  lastCalculatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

TaxRecordSchema.index({ user: 1, taxYear: -1 }, { unique: true });

module.exports = mongoose.model('TaxRecord', TaxRecordSchema);
