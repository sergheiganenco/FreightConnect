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
  // Canonical money field (integer cents). `rate` (float dollars) kept for backward-compat.
  rateCents: { type: Number, default: null },
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
  cancelledByRole: { type: String, enum: ['carrier', 'shipper', 'admin', null], default: null },
  cancelReason:    { type: String, default: null },
  cancelledAt:     { type: Date, default: null },

  // ── Dispute fields ────────────────────────────────────────────────────────
  disputedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  disputedByRole:   { type: String, enum: ['carrier', 'shipper', 'admin', null], default: null },
  disputeReason:    { type: String, default: null },
  disputeType:      { type: String, enum: ['general', 'cargo_damage', 'short_delivery', 'overcharge', 'freight_misdescription', 'payment', 'service', null], default: null },
  disputeClaimCents: { type: Number, default: 0 },
  disputeFiledAt:   { type: Date, default: null },
  disputeResolution: { type: String, enum: ['carrier_fault', 'shipper_fault', 'split', 'dismissed', null], default: null },
  disputeResolvedAt: { type: Date, default: null },
  disputeResolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  disputeNotes:      { type: String, default: null },
  disputeCarrierPayoutPercent: { type: Number, default: null },

  // ── Anti-fraud / trust fields ─────────────────────────────────────────────
  acceptanceFingerprint: {
    carrierId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    at: { type: Date, default: null },
  },
  riskFlags: { type: [String], default: [] },
  paymentAssured: { type: Boolean, default: false },

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

  // ── Funded escrow at booking ──────────────────────────────────────────────
  escrowFunded:           { type: Boolean, default: false },
  escrowFundedAt:         { type: Date, default: null },
  escrowPaymentIntentId:  { type: String, default: null },

  // ── Driver assignment (fleet carriers) ────────────────────────────────────
  assignedDriverId:   { type: String, default: null },   // matches User.drivers[].driverId
  assignedDriverName: { type: String, default: null },

  // ── Equipment subtype + endorsement requirements ──────────────────────────
  equipmentSubtype:    { type: String, default: null },  // e.g. 'multi_temp','frozen','produce','tarp','chains','power_only','drop_hook','oversize'
  requiredEndorsements:{ type: [String], default: [] },  // e.g. ['hazmat','tanker','doubles_triples']

  // ── Reconsignment (delivery change mid-transit) ───────────────────────────
  reconsignment: {
    changed:             { type: Boolean, default: false },
    originalDestination: { type: String, default: null },
    newDestination:      { type: String, default: null },
    newDestinationLat:   { type: Number, default: null },
    newDestinationLng:   { type: Number, default: null },
    reason:              { type: String, default: null },
    feeChargedCents:     { type: Number, default: 0 },
    changedAt:           { type: Date, default: null },
    changedBy:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },

  // ── Redelivery (receiver closed / missed / refused) ───────────────────────
  redelivery: {
    required:          { type: Boolean, default: false },
    reason:            { type: String, default: null },   // 'receiver_closed','missed_appointment','refused'
    originalDeliveryAt:{ type: Date, default: null },
    rescheduledFor:    { type: Date, default: null },
    feeChargedCents:   { type: Number, default: 0 },
    count:             { type: Number, default: 0 },
    history: [{
      reason:        String,
      at:            { type: Date, default: Date.now },
      rescheduledFor:Date,
    }],
  },

  // ── Accessorial charges (detention, lumper, TONU, layover, reconsign, redelivery) ──
  accessorialCharges: [{
    type:        { type: String, enum: ['detention','lumper','tonu','layover','reconsignment','redelivery','other'], required: true },
    description: { type: String, default: null },
    amountCents: { type: Number, required: true },
    status:      { type: String, enum: ['pending','approved','rejected','paid'], default: 'pending' },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    requestedAt: { type: Date, default: Date.now },
    approvedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt:  { type: Date, default: null },
    paidAt:      { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    evidenceUrls:[String],

    // ── Detention auto-collect (system-generated charges) ────────────────────
    // `source` distinguishes carrier-requested accessorials from server-authored
    // detention charges. Detention charges are NEVER carrier-creatable: their
    // amount comes only from the DwellEvent's server-computed fee (provenance lock).
    source:       { type: String, enum: ['carrier','system_detention'], default: 'carrier' },
    dwellEventId: { type: mongoose.Schema.Types.ObjectId, ref: 'DwellEvent', default: null },
    proposedAt:   { type: Date, default: null },
    // Frozen evidence snapshot shown to the shipper at proposal time.
    evidence: {
      arrivedAt:          { type: Date,   default: null },
      dockInAt:           { type: Date,   default: null },
      dockOutAt:          { type: Date,   default: null },
      departedAt:         { type: Date,   default: null },
      dwellMinutes:       { type: Number, default: 0 },
      freeMinutes:        { type: Number, default: 0 },
      detentionMinutes:   { type: Number, default: 0 },
      detentionRateCents: { type: Number, default: 0 },
      facilityName:       { type: String, default: '' },
      source:             { type: String, default: 'auto' },
    },
    // Hash of the (amount + evidence) the shipper is shown; approval must echo it.
    evidenceHash: { type: String, default: null },
    rejectedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rejectedAt:   { type: Date, default: null },
    // Tamper-evident approval record — this, not the click, is the chargeback defense.
    approvalAudit: {
      approverUserId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      approvedAt:          { type: Date,   default: null },
      amountCentsApproved: { type: Number, default: null },
      evidenceHashShown:   { type: String, default: null },
    },
    // Path B — real shipper collection (off-session card-on-file charge).
    shipperPaymentIntentId: { type: String, default: null },
    shipperPaymentStatus:   { type: String, enum: ['none','requires_action','collected','failed'], default: 'none' },
  }],
}, { timestamps: true });

// Keep rateCents in sync with rate (so existing code that sets `rate` still works)
LoadSchema.pre('save', function(next) {
  if (this.rate != null && (this.rateCents == null || this.isModified('rate'))) {
    this.rateCents = Math.round(this.rate * 100);
  }
  next();
});

// Indexes for common query patterns
LoadSchema.index({ status: 1, createdAt: -1 });
LoadSchema.index({ postedBy: 1, status: 1 });
LoadSchema.index({ acceptedBy: 1, status: 1 });
LoadSchema.index({ equipmentType: 1, status: 1 });
LoadSchema.index({ status: 1, equipmentType: 1 });
LoadSchema.index({ 'pickupTimeWindow.start': 1 });
LoadSchema.index({ originLat: 1, originLng: 1 });
LoadSchema.index({ destinationLat: 1, destinationLng: 1 });

module.exports = mongoose.model('Load', LoadSchema);

