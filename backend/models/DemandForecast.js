/**
 * DemandForecast — stores lane-level demand predictions from DemandForecastAgent.
 *
 * Each document covers one lane + equipment type and contains 7-day predictions.
 * Auto-expires via TTL index on validUntil.
 */

const mongoose = require('mongoose');

const PredictionSchema = new mongoose.Schema({
  date:           { type: Date, required: true },
  predictedLoads: { type: Number, required: true },
  confidence:     { type: Number, min: 0, max: 1, default: 0.5 }, // 0–1 scale
}, { _id: false });

const DemandForecastSchema = new mongoose.Schema({
  lane:           { type: String, required: true },         // e.g. "IL-TX"
  equipmentType:  { type: String, required: true },
  predictions:    [PredictionSchema],
  historicalAvg:  { type: Number, default: 0 },             // avg daily loads
  seasonalFactor: { type: Number, default: 1.0 },           // multiplier
  calculatedAt:   { type: Date, default: Date.now },
  validUntil:     { type: Date, required: true },
}, { timestamps: true });

DemandForecastSchema.index({ lane: 1, equipmentType: 1 });
DemandForecastSchema.index({ validUntil: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('DemandForecast', DemandForecastSchema);
