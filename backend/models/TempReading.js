/**
 * TempReading — Reefer Temperature Log Entry
 *
 * Carriers log temperature (and optional humidity) readings during
 * in-transit reefer loads. Each reading is checked against the load's
 * target range and an alert is fired if out of tolerance.
 */

const mongoose = require('mongoose');

const TempReadingSchema = new mongoose.Schema({
  load:    { type: mongoose.Schema.Types.ObjectId, ref: 'Load', required: true, index: true },
  carrier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  tempC:    { type: Number, required: true }, // always stored in Celsius
  humidity: { type: Number },                 // % relative humidity (optional)

  location: { type: String },
  notes:    { type: String },

  recordedAt: { type: Date, default: Date.now, index: true },

  // Alert tracking
  isAlert:      { type: Boolean, default: false },
  alertMessage: { type: String },
}, { timestamps: false });

// Compound index for efficient time-series queries per load
TempReadingSchema.index({ load: 1, recordedAt: -1 });

module.exports = mongoose.model('TempReading', TempReadingSchema);
