/**
 * FuelPurchase — per-jurisdiction fuel receipts for IFTA reporting.
 *
 * One record per pump receipt. `jurisdiction` is the US state/DC where the fuel
 * was purchased (tax paid at the pump). `carrier` is the acting COMPANY id
 * (companyOwnerId), so dispatchers/drivers under a company all roll up together.
 *
 * Money convention (matches Payment / Trip.fuelStops): canonical integer cents.
 */

const mongoose = require('mongoose');
const { Schema, Types: { ObjectId } } = mongoose;

// 48 contiguous states + DC (IFTA covers the lower-48 + participating provinces;
// AK and HI are excluded because they are non-contiguous / non-IFTA).
const US_JURISDICTIONS = [
  'AL', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA',
  'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA',
  'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD',
  'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

const FUEL_TYPES = ['diesel', 'gasoline', 'biodiesel', 'propane', 'lng', 'cng', 'other'];

const FuelPurchaseSchema = new Schema({
  // Acting company (owner) id — companyOwnerId || userId at the route layer.
  carrier: { type: ObjectId, ref: 'User', required: true, index: true },

  // Optional link back to the trip the fuel was bought on.
  tripId: { type: ObjectId, ref: 'Trip', default: null },

  date: { type: Date, required: true, index: true },

  jurisdiction: { type: String, enum: US_JURISDICTIONS, required: true },

  gallons: {
    type: Number,
    required: true,
    validate: { validator: (v) => v > 0, message: 'gallons must be greater than 0' },
  },

  fuelType: { type: String, enum: FUEL_TYPES, default: 'diesel' },

  // Money — canonical integer cents (never floats).
  totalCostCents:      { type: Number, default: 0 },
  pricePerGallonCents: { type: Number, default: 0 },

  vendor:     { type: String },
  receiptUrl: { type: String },
}, { timestamps: true });

// Common queries: recent receipts for a company, and quarter+jurisdiction rollups.
FuelPurchaseSchema.index({ carrier: 1, date: -1 });
FuelPurchaseSchema.index({ carrier: 1, jurisdiction: 1, date: 1 });

// Expose the allow-lists so routes can validate without re-declaring them.
FuelPurchaseSchema.statics.US_JURISDICTIONS = US_JURISDICTIONS;
FuelPurchaseSchema.statics.FUEL_TYPES = FUEL_TYPES;

module.exports = mongoose.model('FuelPurchase', FuelPurchaseSchema);
