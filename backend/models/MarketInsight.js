/**
 * MarketInsight — stores lane-level supply/demand data produced by PricingAgent.
 *
 * Lane format: "IL-TX" (origin_state-dest_state, uppercase).
 * All rate fields are in cents.
 * Documents auto-expire via TTL index on validUntil.
 */

const mongoose = require('mongoose');

const MarketInsightSchema = new mongoose.Schema({
  lane:                  { type: String, required: true },           // e.g. "IL-TX"
  equipmentType:         { type: String, required: true },           // e.g. "Dry Van"
  openLoads:             { type: Number, default: 0 },
  availableCarriers:     { type: Number, default: 0 },
  avgRateCentsPerMile:   { type: Number, default: 0 },               // cents
  heatScore:             { type: Number, default: 50, min: 0, max: 100 },
  trend:                 { type: String, enum: ['rising', 'stable', 'falling'], default: 'stable' },
  suggestedRateMinCents: { type: Number, default: 0 },
  suggestedRateMaxCents: { type: Number, default: 0 },
  calculatedAt:          { type: Date, default: Date.now },
  validUntil:            { type: Date, required: true },
}, { timestamps: true });

// Compound lookup index + TTL auto-delete
MarketInsightSchema.index({ lane: 1, equipmentType: 1, calculatedAt: -1 });
MarketInsightSchema.index({ validUntil: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('MarketInsight', MarketInsightSchema);
