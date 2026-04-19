const mongoose = require('mongoose');
const { Schema, Types: { ObjectId } } = mongoose;

const EXPENSE_CATEGORIES = [
  'fuel',
  'tolls',
  'maintenance',
  'insurance',
  'truck_payment',
  'permits',
  'parking',
  'meals',
  'equipment',
  'tires',
  'washing',
  'scales',
  'lumper',
  'detention',
  'office',
  'phone',
  'subscriptions',
  'other',
];

const ExpenseSchema = new Schema({
  carrier: { type: ObjectId, ref: 'User', required: true, index: true },

  // Optional links to trip / load for per-trip expense tracking
  loadId: { type: ObjectId, ref: 'Load', default: null },
  tripId: { type: ObjectId, ref: 'Trip', default: null },

  // Core fields
  category: {
    type: String,
    enum: EXPENSE_CATEGORIES,
    required: true,
  },
  amountCents: { type: Number, required: true, min: 1 }, // always in cents
  vendor:      { type: String, default: '' },             // "Shell", "Pilot", etc.
  description: { type: String, default: '' },
  date:        { type: Date, required: true, index: true },

  // Receipt attachment (reuses existing upload infrastructure)
  receiptUrl:  { type: String, default: null },
  receiptName: { type: String, default: null },

  // Location (optional — where the expense happened)
  location: { type: String, default: '' },

  // Mileage log entry (for IRS actual-mileage deduction)
  mileage: {
    odometerStart: { type: Number, default: null },
    odometerEnd:   { type: Number, default: null },
    miles:         { type: Number, default: null },
    purpose:       { type: String, default: '' }, // "Load #xyz pickup", etc.
  },

  // Tax deductibility flag — defaults to true for business expenses
  isDeductible: { type: Boolean, default: true },
}, { timestamps: true });

// Compound indexes for common queries
ExpenseSchema.index({ carrier: 1, date: -1 });
ExpenseSchema.index({ carrier: 1, category: 1 });
ExpenseSchema.index({ carrier: 1, date: 1, category: 1 }); // for date-range + category filters

// Statics: category labels for frontend display
ExpenseSchema.statics.CATEGORIES = EXPENSE_CATEGORIES;
ExpenseSchema.statics.CATEGORY_LABELS = {
  fuel:          'Fuel',
  tolls:         'Tolls',
  maintenance:   'Maintenance & Repairs',
  insurance:     'Insurance',
  truck_payment: 'Truck Payment / Lease',
  permits:       'Permits & Licenses',
  parking:       'Parking',
  meals:         'Meals (per diem)',
  equipment:     'Equipment & Supplies',
  tires:         'Tires',
  washing:       'Truck Wash',
  scales:        'Scale / Weigh Station',
  lumper:        'Lumper Fees',
  detention:     'Detention Fees',
  office:        'Office Expenses',
  phone:         'Phone / Internet',
  subscriptions: 'Subscriptions / Software',
  other:         'Other',
};

module.exports = mongoose.model('Expense', ExpenseSchema);
