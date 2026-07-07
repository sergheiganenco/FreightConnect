/**
 * IftaReport — quarterly IFTA worksheet (manual entry, pre-seeded from data).
 *
 * One draft per (carrier company, year, quarter). The worksheet is seeded from
 * FuelPurchase (tax-paid gallons per jurisdiction) and completed Trips (miles
 * hint + jurisdictions travelled), then the carrier fills in per-jurisdiction
 * miles by hand. Once `status` is finalized/filed the figures are frozen and
 * recompute no longer touches them.
 *
 * This is a record-keeping aid, NOT an official filing or tax advice.
 */

const mongoose = require('mongoose');
const { Schema, Types: { ObjectId } } = mongoose;

// 48 contiguous states + DC (kept in sync with FuelPurchase).
const US_JURISDICTIONS = [
  'AL', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA',
  'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA',
  'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD',
  'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

// One row per jurisdiction the carrier operated in during the quarter.
const JurisdictionLineSchema = new Schema({
  jurisdiction:   { type: String, enum: US_JURISDICTIONS },
  totalMiles:     { type: Number, default: 0 },   // manual entry
  taxableMiles:   { type: Number, default: 0 },   // manual entry
  taxPaidGallons: { type: Number, default: 0 },   // seeded from FuelPurchase
  taxRateCents:   { type: Number, default: null }, // per-gallon tax rate (cents)
}, { _id: false });

const IftaReportSchema = new Schema({
  // Acting company (owner) id — companyOwnerId || userId at the route layer.
  carrier: { type: ObjectId, ref: 'User', required: true, index: true },

  year:    { type: Number, required: true },
  quarter: { type: Number, required: true, min: 1, max: 4 },

  fleetMpg:    { type: Number, default: 6.5 },
  milesSource: { type: String, enum: ['manual', 'odometer', 'gps_estimated'], default: 'manual' },

  iftaLicenseNumber: { type: String },
  baseJurisdiction:  { type: String },

  jurisdictions: [JurisdictionLineSchema],

  // Rollups (recomputed on each build/save while draft).
  totalMiles:           { type: Number, default: 0 },
  totalTaxableGallons:  { type: Number, default: 0 },
  totalTaxPaidGallons:  { type: Number, default: 0 },
  netTaxableGallons:    { type: Number, default: 0 },

  status:      { type: String, enum: ['draft', 'finalized', 'filed'], default: 'draft' },
  finalizedAt: { type: Date },
}, { timestamps: true });

// One worksheet per company per quarter.
IftaReportSchema.index({ carrier: 1, year: 1, quarter: 1 }, { unique: true });

IftaReportSchema.statics.US_JURISDICTIONS = US_JURISDICTIONS;

module.exports = mongoose.model('IftaReport', IftaReportSchema);
