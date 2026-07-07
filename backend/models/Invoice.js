const mongoose = require('mongoose');

const InvoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, unique: true },   // e.g. INV-20240001
  loadId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Load', required: true },
  shipperId:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  carrierId:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Canonical money fields — integer cents (source of truth).
  subtotalCents:    { type: Number },
  platformFeeCents: { type: Number, default: 0 },
  totalCents:       { type: Number },

  // Dollar shadow fields (backward-compat with existing readers/UI).
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

  // Automated email tracking
  emailedAt: { type: Date, default: null },
}, { timestamps: true });

// Derive canonical cents from the dollar shadow fields when not set explicitly,
// and generate a race-free invoice number via an atomic counter.
InvoiceSchema.pre('save', async function (next) {
  try {
    if (this.subtotalCents == null && this.subtotal != null) this.subtotalCents = Math.round(this.subtotal * 100);
    if (this.platformFeeCents == null && this.platformFee != null) this.platformFeeCents = Math.round(this.platformFee * 100);
    if (this.totalCents == null && this.total != null) this.totalCents = Math.round(this.total * 100);

    if (!this.invoiceNumber) {
      const Counter = require('./Counter');
      const year = new Date().getFullYear();
      const seq = await Counter.next(`invoice-${year}`);
      this.invoiceNumber = `INV-${year}${String(seq).padStart(4, '0')}`;
    }
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('Invoice', InvoiceSchema);
