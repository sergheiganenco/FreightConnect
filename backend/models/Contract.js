/**
 * Contract model — Dedicated lanes & recurring freight commitments
 *
 * A shipper commits to a recurring volume on a specific lane at agreed rates.
 * Carriers are assigned (or auto-matched) to cover the volume.
 * Loads can be auto-posted on a schedule from the contract template.
 *
 * Status: draft → pending_approval → active | paused | expired | cancelled | terminated
 */

const mongoose = require('mongoose');

const ContractSchema = new mongoose.Schema({
  // Contract identification
  contractNumber: { type: String, unique: true, required: true },
  title:          { type: String, required: true },

  // Parties
  shipper: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  assignedCarriers: [{
    carrier:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    allocation: Number,  // % of volume this carrier handles
    assignedAt: Date,
    status: { type: String, enum: ['pending', 'active', 'paused', 'removed'], default: 'pending' },
  }],
  useAutoMatching: { type: Boolean, default: false },

  // Lane definition
  lane: {
    origin: {
      name:      { type: String, required: true },
      address:   String,
      city:      { type: String, required: true },
      state:     { type: String, required: true },
      zip:       String,
      latitude:  Number,
      longitude: Number,
    },
    destination: {
      name:      { type: String, required: true },
      address:   String,
      city:      { type: String, required: true },
      state:     { type: String, required: true },
      zip:       String,
      latitude:  Number,
      longitude: Number,
    },
    distanceMiles:          Number,
    estimatedTransitHours:  Number,
  },

  // Equipment and requirements
  equipmentType:          { type: String, required: true },
  hazardousMaterial:      { type: Boolean, default: false },
  temperatureControlled:  { type: Boolean, default: false },
  temperatureRange: {
    min: Number,  // °F
    max: Number,
  },
  specialRequirements: [String],

  // Rate structure
  pricing: {
    rateType: { type: String, enum: ['flat', 'per_mile', 'per_unit'], default: 'flat' },
    rateCents: { type: Number, required: true },
    fuelSurcharge: {
      type:             { type: String, enum: ['none', 'fixed', 'doeIndex'], default: 'none' },
      fixedAmountCents: Number,
      doeBasePrice:     Number,
      doeFactor:        Number,
    },
    accessorialRates: {
      detentionPerHourCents:  { type: Number, default: 7500 },
      detentionFreeHours:     { type: Number, default: 2 },
      layoverCents:           { type: Number, default: 30000 },
      lumperMaxCents:         Number,
      tonuCents:              { type: Number, default: 25000 },
    },
    rateReviewDate: Date,
    rateHistory: [{
      rateCents:      Number,
      effectiveFrom:  Date,
      effectiveTo:    Date,
      reason:         String,
    }],
  },

  // Volume commitment
  volume: {
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'biweekly', 'monthly'],
      required: true,
    },
    loadsPerPeriod:         { type: Number, required: true },
    minimumLoadsPerPeriod:  Number,
    maximumLoadsPerPeriod:  Number,
    currentPeriodStart:     Date,
    currentPeriodLoadsPosted:    { type: Number, default: 0 },
    currentPeriodLoadsCompleted: { type: Number, default: 0 },
  },

  // Auto-posting schedule
  autoPost: {
    enabled: { type: Boolean, default: false },
    schedule: {
      daysOfWeek: [{ type: Number }],  // 0=Sun … 6=Sat
      postTime:   String,              // HH:mm
      timezone:   String,
    },
    loadTemplate: {
      title:                    String,
      pickupTimeWindowStart:    String,  // HH:mm
      pickupTimeWindowEnd:      String,
      deliveryTimeWindowStart:  String,
      deliveryTimeWindowEnd:    String,
      loadWeight:               Number,
      loadDimensions: {
        length: Number,
        width:  Number,
        height: Number,
      },
      commodityType:        String,
      specialInstructions:  String,
    },
  },

  // Contract terms
  terms: {
    startDate:             { type: Date, required: true },
    endDate:               { type: Date, required: true },
    autoRenew:             { type: Boolean, default: false },
    autoRenewTermMonths:   { type: Number, default: 12 },
    cancellationNoticeDays:{ type: Number, default: 30 },
    paymentTerms: {
      type: String,
      enum: ['escrow', 'net15', 'net30', 'net45', 'net60'],
      default: 'escrow',
    },
  },

  // Status
  status: {
    type: String,
    enum: ['draft', 'pending_approval', 'active', 'paused', 'expired', 'cancelled', 'terminated'],
    default: 'draft',
    index: true,
  },

  // Performance tracking
  performance: {
    totalLoadsPosted:       { type: Number, default: 0 },
    totalLoadsCompleted:    { type: Number, default: 0 },
    averageOnTimeRate:      { type: Number, default: 100 },
    averageTenderAcceptRate:{ type: Number, default: 100 },
    totalRevenueCents:      { type: Number, default: 0 },
    averageTransitHours:    Number,
    claimsCount:            { type: Number, default: 0 },
  },

  // Audit trail
  history: [{
    action:      String,
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timestamp:   { type: Date, default: Date.now },
    details:     String,
  }],

}, { timestamps: true });

ContractSchema.index({ shipper: 1, status: 1 });
ContractSchema.index({ 'assignedCarriers.carrier': 1, status: 1 });
ContractSchema.index({ 'lane.origin.state': 1, 'lane.destination.state': 1 });
ContractSchema.index({ 'terms.endDate': 1 });

module.exports = mongoose.model('Contract', ContractSchema);
