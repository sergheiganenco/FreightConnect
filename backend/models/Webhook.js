const mongoose = require('mongoose');
const crypto = require('crypto');

const WebhookSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  url: {
    type: String,
    required: true,
    validate: {
      validator: (v) => /^https:\/\/.+/i.test(v),
      message: 'Webhook URL must use HTTPS',
    },
  },
  events: {
    type: [String],
    required: true,
    enum: [
      'load.created', 'load.accepted', 'load.in_transit', 'load.delivered', 'load.cancelled',
      'bid.new', 'bid.accepted', 'bid.rejected', 'bid.countered',
      'payment.released', 'payment.received',
      'document.generated', 'document.uploaded',
      'exception.filed', 'exception.resolved',
    ],
  },
  secret: {
    type: String,
    required: true,
    default: () => crypto.randomBytes(32).toString('hex'),
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  failureCount: {
    type: Number,
    default: 0,
  },
  lastDeliveryAt: {
    type: Date,
  },
  lastFailureAt: {
    type: Date,
  },
  lastFailureReason: {
    type: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Indexes
WebhookSchema.index({ userId: 1 });
WebhookSchema.index({ events: 1 });

module.exports = mongoose.model('Webhook', WebhookSchema);
