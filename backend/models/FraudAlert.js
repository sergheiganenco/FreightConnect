/**
 * FraudAlert — Fraud detection alerts for admin review
 *
 * Created automatically by the fraud detection service when suspicious
 * patterns are detected. Admins review and act on alerts.
 */

const mongoose = require('mongoose');
const { Schema, Types: { ObjectId } } = mongoose;

const FraudAlertSchema = new Schema({
  user: { type: ObjectId, ref: 'User', required: true, index: true },

  type: {
    type: String,
    enum: [
      'double_brokering',
      'identity_fraud',
      'price_manipulation',
      'unusual_activity',
      'velocity_abuse',
    ],
    required: true,
  },

  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    required: true,
  },

  description: { type: String, required: true },

  // Flexible JSON blob of supporting data (load IDs, timestamps, stats, etc.)
  evidence: { type: Schema.Types.Mixed, default: {} },

  status: {
    type: String,
    enum: ['open', 'investigating', 'confirmed', 'dismissed'],
    default: 'open',
  },

  reviewedBy: { type: ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },

  autoAction: {
    type: String,
    enum: ['none', 'warning', 'suspended'],
    default: 'none',
  },
}, { timestamps: true });

// Indexes for admin queries
FraudAlertSchema.index({ status: 1, severity: 1, createdAt: -1 });
FraudAlertSchema.index({ type: 1, status: 1 });
FraudAlertSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model('FraudAlert', FraudAlertSchema);
