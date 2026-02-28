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
  specialInstructions: String,
  hazardousMaterial: Boolean,
  status: { type: String, default: 'open' },
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedTruckId: { type: String, default: null },
  deliveredAt: { type: Date, default: null },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

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

