/**
 * DwellEvent — Facility Check-in / Check-out + Detention Tracking
 *
 * Real-world trucking:
 *   1. Driver arrives at facility → checks in (arrivedAt)
 *   2. Loading/unloading begins → dock assigned (dockInAt)
 *   3. Loading/unloading complete → dock release (dockOutAt)
 *   4. Driver departs facility → checks out (departedAt)
 *
 * Detention accrues when total dwell time exceeds free hours.
 * "Dwell time" = departedAt - arrivedAt (or now, if still on-site).
 *
 * Industry standard: 2 hours free, then $75/hour.
 * Contracts can override via pricing.accessorialRates.
 *
 * Facility reputation = average dwell time across all events at that facility.
 */

const mongoose = require('mongoose');
const { Schema, Types: { ObjectId } } = mongoose;

const DwellEventSchema = new Schema({
  load:    { type: ObjectId, ref: 'Load', required: true, index: true },
  carrier: { type: ObjectId, ref: 'User', required: true, index: true },
  shipper: { type: ObjectId, ref: 'User', required: true },

  // Which stop? pickup or delivery (or multi-stop index)
  stopType:  { type: String, enum: ['pickup', 'delivery'], required: true },
  stopIndex: { type: Number, default: 0 }, // for multi-stop loads

  // Facility info (denormalized for aggregation)
  facilityName:    { type: String, default: '' },
  facilityAddress: { type: String, default: '' },

  // ── Timestamps: the 4-step check-in flow ─────────────────────────────────
  arrivedAt:  { type: Date, default: null }, // driver checks in at gate
  dockInAt:   { type: Date, default: null }, // assigned a dock / loading starts
  dockOutAt:  { type: Date, default: null }, // loading complete
  departedAt: { type: Date, default: null }, // driver leaves facility

  // ── Calculated detention ──────────────────────────────────────────────────
  dwellMinutes:        { type: Number, default: 0 },  // total minutes on-site
  freeMinutes:         { type: Number, default: 120 }, // default 2 hours
  detentionMinutes:    { type: Number, default: 0 },   // max(0, dwell - free)
  detentionRateCents:  { type: Number, default: 7500 }, // per hour, default $75
  detentionFeeCents:   { type: Number, default: 0 },    // auto-calculated

  // ── Impact assessment ─────────────────────────────────────────────────────
  // When detention delays the next load, we record that here
  nextLoadId:       { type: ObjectId, ref: 'Load', default: null },
  nextLoadImpact: {
    originalPickupAt:  { type: Date, default: null },
    estimatedDelayMin: { type: Number, default: 0 },
    hosRestRequired:   { type: Boolean, default: false }, // delay + drive pushes past 11h
    hosRestMinutes:    { type: Number, default: 0 },      // 600 min = 10h mandatory rest
    totalImpactMin:    { type: Number, default: 0 },      // detention + drive + rest
    status: {
      type: String,
      enum: ['none', 'at_risk', 'delayed', 'resolved'],
      default: 'none',
    },
  },

  // ── Contract reference for custom rates ──────────────────────────────────
  contractId: { type: ObjectId, ref: 'Contract', default: null },

  // Notes
  notes: { type: String, default: '' },
}, { timestamps: true });

// Indexes for facility reputation queries
DwellEventSchema.index({ facilityName: 1, stopType: 1 });
DwellEventSchema.index({ carrier: 1, createdAt: -1 });
DwellEventSchema.index({ shipper: 1, facilityName: 1 });

module.exports = mongoose.model('DwellEvent', DwellEventSchema);
