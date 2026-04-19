/**
 * TrackingLink — Public tracking portal tokens
 *
 * Shippers generate a unique token for a load so external parties
 * (consignees, brokers, customers) can track shipment status via a
 * public URL without needing a FreightConnect account.
 *
 * Token expires 7 days after the load is delivered (or a custom TTL).
 */

const mongoose = require('mongoose');
const crypto   = require('crypto');

const TrackingLinkSchema = new mongoose.Schema({
  token: {
    type:     String,
    required: true,
    unique:   true,
    default:  () => crypto.randomBytes(24).toString('hex'),
    index:    true,
  },
  loadId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Load',
    required: true,
    index:    true,
  },
  createdBy: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
  },
  expiresAt: {
    type:    Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    index:   true,
  },
  isActive: {
    type:    Boolean,
    default: true,
  },
}, { timestamps: true });

TrackingLinkSchema.index({ loadId: 1, isActive: 1 });

module.exports = mongoose.model('TrackingLink', TrackingLinkSchema);
