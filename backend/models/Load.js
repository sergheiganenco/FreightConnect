const mongoose = require('mongoose');

const LoadSchema = new mongoose.Schema({
  title: { type: String, required: true },
  origin: { type: String, required: true },
  originLat: Number,
  originLng: Number,
  destination: { type: String, required: true },
  destinationLat: Number,
  destinationLng: Number,
  rate: { type: Number, required: true },
  equipmentType: { type: String, required: true },
  pickupTimeWindow: {
    start: Date,
    end: Date,
  },
  deliveryTimeWindow: {
    start: Date,
    end: Date,
  },
  loadWeight: Number,
  loadDimensions: {
    length: Number,
    width: Number,
    height: Number,
  },
  commodityType: String,
  commodityCategory: String,
  specialInstructions: String,
  hazardousMaterial: Boolean,
  hazmatClass: String,
  hazmatPackingGroup: String,
  dangerousGoodsUN: String,

  // ── Enterprise / extended fields ──────────────────────────────────────────
  paymentTerms: String,
  currency: { type: String, default: 'USD' },
  specialHandling: [String],
  accessorials: [String],
  insuranceRequired: Number,
  cargoValue: Number,
  loadVisibility: { type: String, default: 'public', enum: ['public', 'preferred', 'private'] },
  allowCarrierBidding: { type: Boolean, default: true },
  expirationDateTime: Date,
  notes: String,
  carrierInstructions: String,
  documentsRequired: [String],

  // ── Reference numbers ─────────────────────────────────────────────────────
  poNumber: String,
  shipperReferenceNumber: String,
  consigneeReference: String,

  // ── Overweight acknowledgment ─────────────────────────────────────────────
  overweightAcknowledged: { type: Boolean, default: false },
  overweightPermitNumber: String,

  // ── Pickup / delivery facility details ────────────────────────────────────
  pickupFacilityName: String,
  pickupAddress: String,
  pickupContactName: String,
  pickupContactPhone: String,
  deliveryFacilityName: String,
  deliveryAddress: String,
  deliveryContactName: String,
  deliveryContactPhone: String,

  status: { type: String, default: 'open', enum: ['open', 'accepted', 'in-transit', 'delivered', 'cancelled', 'disputed', 'resolved'] },
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedTruckId: { type: String, default: null },
  deliveredAt: { type: Date, default: null },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

  // ── Cancellation fields ───────────────────────────────────────────────────
  cancelledBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cancelledByRole: { type: String, enum: ['carrier', 'shipper', 'admin'], default: null },
  cancelReason:    { type: String, default: null },
  cancelledAt:     { type: Date, default: null },

  // ── Dispute fields ────────────────────────────────────────────────────────
  disputedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  disputedByRole:   { type: String, enum: ['carrier', 'shipper', 'admin'], default: null },
  disputeReason:    { type: String, default: null },
  disputeType:      { type: String, enum: ['general', 'cargo_damage', 'short_delivery', 'overcharge', 'freight_misdescription', 'payment', 'service'], default: null },
  disputeClaimCents: { type: Number, default: 0 },
  disputeFiledAt:   { type: Date, default: null },
  disputeResolution: { type: String, enum: ['carrier_fault', 'shipper_fault', 'split', 'dismissed'], default: null },
  disputeResolvedAt: { type: Date, default: null },
  disputeResolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  disputeNotes:      { type: String, default: null },
  disputeCarrierPayoutPercent: { type: Number, default: null },

  // ── AI Agent Flags ────────────────────────────────────────────────────────
  matchNotificationSent: { type: Boolean, default: false },
  autoDispatched:        { type: Boolean, default: false },
  autoDispatchedAt:      { type: Date, default: null },
  autoDispatchScore:     { type: Number, default: null },

  // ── Auto-generated document paths ─────────────────────────────────────────
  // Paths are relative to backend static serving (e.g. /documents/uploads/xxx.pdf)
  documents: {
    rateConfirmation: { type: String, default: null }, // generated on load accept
    bol:              { type: String, default: null }, // generated on delivery
    pod:              { type: String, default: null }, // uploaded by carrier
  },

  // ── Contract reference ────────────────────────────────────────────────────
  contractId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', default: null, index: true },
  isContractLoad: { type: Boolean, default: false },

  // ── Reefer / Temperature Control ─────────────────────────────────────────
  reefer: {
    enabled:      { type: Boolean, default: false },
    targetMinC:   Number,   // target range in Celsius
    targetMaxC:   Number,
    alertOnDeviation: { type: Boolean, default: true },
    notes:        String,   // e.g. "Keep frozen, do not stack"
  },

  // ── Live Carrier Location ─────────────────────────────────────────────────
  carrierLocation: {
    latitude:  Number,
    longitude: Number,
    speed:     Number,          // km/h (optional, from GPS)
    heading:   Number,          // degrees 0-360 (optional)
    accuracy:  Number,          // meters (optional)
    source:    { type: String, enum: ['browser', 'mobile_app', 'eld', 'api'], default: 'browser' },
    updatedAt: { type: Date, default: null },
  },

  // ── Multi-Stop Loads ──────────────────────────────────────────────────────
  stops: [{
    sequence:     { type: Number, required: true },
    type:         { type: String, enum: ['pickup', 'delivery'], required: true },
    address:      { type: String, required: true },
    lat:          Number,
    lng:          Number,
    timeWindow:   { start: Date, end: Date },
    contactName:  String,
    contactPhone: String,
    notes:        String,
    status: {
      type:    String,
      enum:    ['pending', 'arrived', 'departed', 'skipped'],
      default: 'pending',
    },
    arrivedAt:  Date,
    departedAt: Date,
  }],
}, { timestamps: true });

// Indexes for common query patterns
LoadSchema.index({ status: 1, createdAt: -1 });
LoadSchema.index({ postedBy: 1, status: 1 });
LoadSchema.index({ acceptedBy: 1, status: 1 });
LoadSchema.index({ equipmentType: 1, status: 1 });
LoadSchema.index({ 'pickupTimeWindow.start': 1 });
LoadSchema.index({ originLat: 1, originLng: 1 });
LoadSchema.index({ destinationLat: 1, destinationLng: 1 });

module.exports = mongoose.model('Load', LoadSchema);

