const mongoose = require('mongoose');

const LaneSchema = new mongoose.Schema({
  origin: { type: String, required: true },
  destination: { type: String, required: true },
  radiusMiles: { type: Number, default: 50 },
}, { _id: false });

const AlertPreferenceSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  },
  emailEnabled: {
    type: Boolean,
    default: true,
  },
  emailFrequency: {
    type: String,
    enum: ['realtime', '4hours', 'daily', 'never'],
    default: '4hours',
  },
  lanes: [LaneSchema],
  equipment: [String],
  minRate: {
    type: Number,
    default: 0,
  },
  lastDigestSentAt: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

module.exports = mongoose.model('AlertPreference', AlertPreferenceSchema);
