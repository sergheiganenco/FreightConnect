const mongoose = require('mongoose');

/**
 * Settlement — a driver pay statement for a period.
 *
 * A carrier company (companyOwnerId) pays a driver (driverId matches
 * User.drivers[].driverId) for the delivered loads assigned to them in a
 * period. `payType` and every per-line rate is a SNAPSHOT taken at generation
 * time so that later edits to the driver's pay profile never mutate a
 * historical settlement.
 *
 * Money is integer cents everywhere. Statuses: draft → finalized → paid, with
 * void as a terminal escape hatch (a voided settlement frees its loads to be
 * re-settled — generation only excludes loads on NON-void settlements).
 */

// Per-line deduction (advance, fuel, insurance escrow, lease, etc.).
const DeductionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['advance', 'fuel', 'insurance', 'escrow', 'lease', 'other'],
    required: true,
  },
  description: { type: String },
  amountCents: { type: Number, default: 0 }, // integer cents
}, { _id: false });

// One line per delivered load in the period.
const LineItemSchema = new mongoose.Schema({
  loadId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Load' },
  loadTitle:   { type: String },
  origin:      { type: String },
  destination: { type: String },
  deliveredAt: { type: Date },
  loadRevenueCents: { type: Number }, // the load's gross rate in cents (basis for % pay)
  miles:       { type: Number, default: 0 },
  rateType:    { type: String }, // snapshot of payType at generation
  rateValue:   { type: Number }, // snapshot of the pay figure (pct / perMileCents / perLoadCents / flatCents)
  grossCents:  { type: Number }, // computed driver gross for this line
  deductions:  { type: [DeductionSchema], default: [] },
  deductionsCents: { type: Number, default: 0 },
  netCents:    { type: Number },
}, { _id: false });

const SettlementSchema = new mongoose.Schema({
  // e.g. STMT-20260001 — derived from an atomic Counter (race-free, gap-free).
  settlementNumber: { type: String, unique: true },

  companyOwnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  driverId:   { type: String, required: true }, // matches User.drivers[].driverId
  driverName: { type: String },

  periodStart: { type: Date, required: true },
  periodEnd:   { type: Date, required: true },

  // SNAPSHOT of the driver's pay model at generation time.
  payType: { type: String, enum: ['per_mile', 'per_load', 'percentage', 'flat'] },

  lineItems: { type: [LineItemSchema], default: [] },

  // Aggregates (integer cents) — sum of the line items.
  grossCents:      { type: Number, default: 0 },
  deductionsCents: { type: Number, default: 0 },
  netCents:        { type: Number, default: 0 },

  status: {
    type: String,
    enum: ['draft', 'finalized', 'paid', 'void'],
    default: 'draft',
  },

  notes:  { type: String },
  pdfUrl: { type: String, default: null },

  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  finalizedAt: { type: Date },
  paidAt:      { type: Date },
  payMethod:   { type: String, enum: ['ach', 'check', 'cash', 'other'] },
  paidReference: { type: String },
}, { timestamps: true });

// Compound indexes for the common query patterns (settlementNumber's unique
// index is created by the field-level `unique: true` above — no duplicate here).
SettlementSchema.index({ companyOwnerId: 1, driverId: 1, periodStart: -1 });
SettlementSchema.index({ companyOwnerId: 1, status: 1 });

// Derive a race-free settlement number from an atomic counter, mirroring the
// Invoice numbering pattern (STMT-<year><4-digit seq>).
SettlementSchema.pre('save', async function (next) {
  try {
    if (this.isNew && !this.settlementNumber) {
      const Counter = require('./Counter');
      const year = new Date().getFullYear();
      const seq = await Counter.next(`settlement-${year}`);
      this.settlementNumber = `STMT-${year}${String(seq).padStart(4, '0')}`;
    }
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('Settlement', SettlementSchema);
