const mongoose = require('mongoose');

const PreferredCarrierSchema = new mongoose.Schema({
  shipper: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  carrier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  tier: {
    type: String,
    enum: ['gold', 'silver', 'standard'],
    default: 'standard',
  },
  firstLookHours: {
    type: Number,
    default: 0,
  },
  notes: {
    type: String,
    default: '',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  addedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

// Unique compound index — one entry per shipper+carrier pair
PreferredCarrierSchema.index({ shipper: 1, carrier: 1 }, { unique: true });

// Pre-save hook: set firstLookHours based on tier if not explicitly provided
PreferredCarrierSchema.pre('save', function (next) {
  if (this.isNew && this.firstLookHours === 0) {
    const tierDefaults = { gold: 2, silver: 1, standard: 0 };
    this.firstLookHours = tierDefaults[this.tier] || 0;
  }
  next();
});

module.exports = mongoose.model('PreferredCarrier', PreferredCarrierSchema);
