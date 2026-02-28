/**
 * EDIDocument — Electronic Data Interchange Records
 *
 * Stores raw X12 EDI transmissions (inbound) and generated EDI output
 * (outbound) along with parsed/structured data and link to the resulting Load.
 *
 * Supported transaction sets:
 *   204 — Motor Carrier Load Tender         (shipper → carrier, inbound)
 *   214 — Transportation Carrier Status     (carrier → shipper, outbound)
 *   210 — Motor Carrier Freight Invoice     (carrier → shipper, outbound)
 */

const mongoose = require('mongoose');

const EDIDocumentSchema = new mongoose.Schema({
  direction: { type: String, enum: ['inbound', 'outbound'], required: true },
  type:      { type: String, enum: ['204', '214', '210'], required: true },

  // Who submitted / who it belongs to
  shipper: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  carrier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Related load (set once load is created or linked)
  load: { type: mongoose.Schema.Types.ObjectId, ref: 'Load', default: null, index: true },

  // Raw EDI content (X12 text)
  rawContent: { type: String, required: true },

  // Parsed/structured data (populated by ediParser)
  parsedData: { type: mongoose.Schema.Types.Mixed, default: null },

  // Processing lifecycle
  status: {
    type: String,
    enum: ['received', 'parsed', 'load_created', 'sent', 'error'],
    default: 'received',
    index: true,
  },
  errorMessage: { type: String, default: null },

  // Control identifiers from ISA header
  senderISAId:   { type: String },
  receiverISAId: { type: String },
  isaControlNum: { type: String },
  interchangeDate: { type: String },

  // For outbound: the status code used (214 only)
  statusCode: { type: String },
}, { timestamps: true });

EDIDocumentSchema.index({ shipper: 1, createdAt: -1 });
EDIDocumentSchema.index({ type: 1, status: 1 });

module.exports = mongoose.model('EDIDocument', EDIDocumentSchema);
