const mongoose = require('mongoose');

const ReviewQueueSchema = new mongoose.Schema({
  type:      { type: String, required: true, enum: ['carrier_suspension', 'fraud_flag', 'other'], index: true },
  subjectUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  severity:  { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'high' },
  status:    { type: String, enum: ['pending', 'approved', 'dismissed'], default: 'pending', index: true },
  reason:    { type: String, default: null },
  riskScore: { type: Number, default: null },
  details:   { type: mongoose.Schema.Types.Mixed, default: null }, // breakdown of why flagged
  recommendedAction: { type: String, default: null }, // e.g. 'suspend'
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  reviewNote: { type: String, default: null },
  createdAt: { type: Date, default: Date.now, index: true },
});

// Prevent duplicate open reviews for the same subject+type
ReviewQueueSchema.index({ subjectUser: 1, type: 1, status: 1 });

module.exports = mongoose.model('ReviewQueue', ReviewQueueSchema);
