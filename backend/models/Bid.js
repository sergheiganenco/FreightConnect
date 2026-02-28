const mongoose = require('mongoose');

const BidHistorySchema = new mongoose.Schema({
  actor:  { type: String, enum: ['carrier', 'shipper'], required: true },
  action: { type: String, enum: ['placed', 'countered', 'accepted', 'rejected', 'withdrawn'], required: true },
  amount: Number,
  note:   String,
  at:     { type: Date, default: Date.now },
}, { _id: false });

const BidSchema = new mongoose.Schema({
  loadId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Load', required: true },
  carrierId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Current state
  amount:        { type: Number, required: true },   // carrier's latest bid (dollars)
  counterAmount: { type: Number, default: null },    // shipper's counter-offer
  message:       { type: String, maxlength: 500 },   // carrier's note

  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'countered', 'withdrawn'],
    default: 'pending',
  },

  // Full audit trail
  history: [BidHistorySchema],
}, { timestamps: true });

// One active bid per carrier per load
BidSchema.index({ loadId: 1, carrierId: 1 }, { unique: true });

module.exports = mongoose.model('Bid', BidSchema);
