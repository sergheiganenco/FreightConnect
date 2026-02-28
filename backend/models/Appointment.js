/**
 * Appointment — Pickup & Delivery Scheduling
 *
 * Tracks formal appointment requests and confirmations for load
 * pickup/delivery at facilities. Complements Load.pickupTimeWindow
 * and Load.deliveryTimeWindow with confirmed slot management.
 */

const mongoose = require('mongoose');

const AppointmentSchema = new mongoose.Schema({
  load:         { type: mongoose.Schema.Types.ObjectId, ref: 'Load', required: true, index: true },
  shipper:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  carrier:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  // Pickup appointment
  pickup: {
    requestedAt:  Date,            // When carrier requested the slot
    scheduledAt:  Date,            // Agreed-upon pickup time
    confirmedAt:  Date,            // When shipper confirmed
    facilityName: String,
    contactName:  String,
    contactPhone: String,
    notes:        String,
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'rescheduled', 'missed', 'cancelled'],
      default: 'pending',
    },
  },

  // Delivery appointment
  delivery: {
    requestedAt:  Date,
    scheduledAt:  Date,
    confirmedAt:  Date,
    facilityName: String,
    contactName:  String,
    contactPhone: String,
    notes:        String,
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'rescheduled', 'missed', 'cancelled'],
      default: 'pending',
    },
  },

  // History of changes
  history: [{
    action:      { type: String },  // 'requested', 'confirmed', 'rescheduled', 'cancelled', 'missed'
    type:        { type: String },  // 'pickup' | 'delivery'
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timestamp:   { type: Date, default: Date.now },
    notes:       String,
  }],
}, { timestamps: true });

// Index for quick lookup of all appointments in a date range
AppointmentSchema.index({ 'pickup.scheduledAt': 1 });
AppointmentSchema.index({ 'delivery.scheduledAt': 1 });

module.exports = mongoose.model('Appointment', AppointmentSchema);
