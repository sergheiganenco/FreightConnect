const mongoose = require('mongoose');

/**
 * LedgerEntry — double-entry accounting ledger.
 * Every money movement records TWO entries (one debit + one credit) so the books
 * always balance. All amounts are integer cents — never floating point.
 */
const LedgerEntrySchema = new mongoose.Schema({
  // Grouping: all entries from one event share a transactionId
  transactionId: { type: String, required: true, index: true },
  loadId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Load', default: null, index: true },
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
  // Accounts: escrow_holding, carrier_payable, platform_revenue, shipper_funds, refunds, accessorial_payable
  account:   { type: String, required: true, enum: ['escrow_holding', 'carrier_payable', 'platform_revenue', 'shipper_funds', 'refunds', 'accessorial_payable'], index: true },
  direction: { type: String, required: true, enum: ['debit', 'credit'] },
  amountCents: { type: Number, required: true },
  currency:  { type: String, default: 'usd' },
  entryType: { type: String, required: true }, // 'escrow_hold','escrow_capture','carrier_payout','platform_fee','accessorial_settle','refund'
  description: String,
  stripeRef: { type: String, default: null }, // PaymentIntent/Transfer/Refund id
  createdAt: { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model('LedgerEntry', LedgerEntrySchema);
