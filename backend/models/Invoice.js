const mongoose = require('mongoose');

const InvoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, unique: true },   // e.g. INV-20240001
  loadId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Load', required: true },
  shipperId:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  carrierId:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Financial fields — all in dollars (existing app convention)
  subtotal:    { type: Number, required: true },  // negotiated load rate
  platformFee: { type: Number, default: 0 },      // FreightConnect 2% fee
  total:       { type: Number, required: true },

  status: {
    type: String,
    enum: ['draft', 'issued', 'paid', 'void', 'refunded'],
    default: 'draft',
  },

  // Stripe references
  stripePaymentIntentId: String,
  stripeTransferId: String,      // payout to carrier Connect account

  // Dates
  issuedAt:   Date,
  paidAt:     Date,
  dueDate:    Date,

  lineItems: [{
    description: String,
    quantity:    { type: Number, default: 1 },
    unitAmount:  Number,
    total:       Number,
  }],

  notes: String,
}, { timestamps: true });

// Auto-generate invoice number before save
InvoiceSchema.pre('save', async function (next) {
  if (!this.invoiceNumber) {
    const count = await this.constructor.countDocuments();
    const year  = new Date().getFullYear();
    this.invoiceNumber = `INV-${year}${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

module.exports = mongoose.model('Invoice', InvoiceSchema);
