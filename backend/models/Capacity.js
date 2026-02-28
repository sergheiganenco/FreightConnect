/**
 * Capacity model
 *
 * A carrier posts available truck capacity so other carriers acting as
 * small brokers can find and contact them for sub-contracting.
 *
 * Status lifecycle: active → booked | expired | cancelled
 */

const mongoose = require('mongoose');

const CapacitySchema = new mongoose.Schema({
  // ── Who posted ────────────────────────────────────────────────────────────
  carrierId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  // ── Truck info ────────────────────────────────────────────────────────────
  equipmentType: {
    type: String,
    required: true,
    enum: ['Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Lowboy', 'Box Truck', 'Power Only', 'Tanker', 'Other'],
  },
  truckId: { type: String, default: null },     // optional — links to carrier's fleet
  weightCapacity: { type: Number, default: null }, // lbs

  // ── Availability window ───────────────────────────────────────────────────
  availableFrom: { type: Date, required: true },
  availableTo:   { type: Date, required: true },

  // ── Preferred lanes ───────────────────────────────────────────────────────
  originCity:   { type: String, required: true },
  originState:  { type: String, required: true },
  destCity:     { type: String, default: null },   // null = any destination
  destState:    { type: String, default: null },
  preferredRegions: [{ type: String }],            // e.g. ['Midwest', 'Southeast']

  // ── Rate ─────────────────────────────────────────────────────────────────
  ratePerMile:    { type: Number, default: null },  // optional asking rate
  minLoadValue:   { type: Number, default: null },  // minimum load rate willing to take

  // ── Status ───────────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['active', 'booked', 'expired', 'cancelled'],
    default: 'active',
    index: true,
  },

  // ── Contact + notes ───────────────────────────────────────────────────────
  notes:        { type: String, default: '' },
  contactPhone: { type: String, default: null },

  // ── Booking ───────────────────────────────────────────────────────────────
  bookedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  bookedAt:  { type: Date, default: null },

}, { timestamps: true });

// Compound index for fast board queries
CapacitySchema.index({ status: 1, availableFrom: 1 });
CapacitySchema.index({ originState: 1, status: 1 });
CapacitySchema.index({ equipmentType: 1, status: 1 });

module.exports = mongoose.model('Capacity', CapacitySchema);
