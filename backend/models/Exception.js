/**
 * Exception model
 *
 * Types:   dispute | delay | cargo_damage | missed_pickup | overcharge | other
 * Status:  open → investigating → resolved | dismissed
 * Filed by: carrier or shipper; resolved by admin (or auto-flagged by system)
 */

const mongoose = require('mongoose');

const NoteSchema = new mongoose.Schema({
  author:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  authorRole:{ type: String, enum: ['carrier', 'shipper', 'admin', 'system'] },
  content:   { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const ExceptionSchema = new mongoose.Schema({
  // ── References ────────────────────────────────────────────────────────────
  loadId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Load',   required: true },
  filedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',   required: true },
  filedByRole:{ type: String, enum: ['carrier', 'shipper', 'system'], required: true },
  assignedTo:{ type: mongoose.Schema.Types.ObjectId, ref: 'User',   default: null }, // admin

  // ── Classification ────────────────────────────────────────────────────────
  type: {
    type: String,
    enum: ['dispute', 'delay', 'cargo_damage', 'missed_pickup', 'overcharge', 'other'],
    required: true,
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium',
  },

  // ── Content ───────────────────────────────────────────────────────────────
  title:       { type: String, required: true },
  description: { type: String, required: true },
  claimAmount: { type: Number, default: null }, // optional $ claim (disputes, damages)

  // ── Status lifecycle ──────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['open', 'investigating', 'resolved', 'dismissed'],
    default: 'open',
  },
  resolution: { type: String, default: null },  // admin notes on close
  resolvedAt: { type: Date,   default: null },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // ── Thread ────────────────────────────────────────────────────────────────
  notes: [NoteSchema],

  // ── Auto-detection flag ───────────────────────────────────────────────────
  autoFlagged: { type: Boolean, default: false }, // true if system-created

}, { timestamps: true });

// Index for fast lookups by load, status, type
ExceptionSchema.index({ loadId: 1 });
ExceptionSchema.index({ status: 1, createdAt: -1 });
ExceptionSchema.index({ filedBy: 1 });

module.exports = mongoose.model('Exception', ExceptionSchema);
