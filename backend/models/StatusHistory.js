const mongoose = require('mongoose');

/**
 * StatusHistory — immutable audit trail for all status changes across entities.
 *
 * Every status transition (load, bid, payment, exception, contract) is recorded
 * here for compliance, debugging, and analytics.
 */
const StatusHistorySchema = new mongoose.Schema({
  entityType: {
    type: String,
    required: true,
    enum: ['load', 'bid', 'payment', 'exception', 'contract'],
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  fromStatus: {
    type: String,
    required: true,
  },
  toStatus: {
    type: String,
    required: true,
  },
  changedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null, // null for system-initiated transitions
  },
  reason: {
    type: String,
    default: null,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

// Query patterns: "show all transitions for entity X" and "show all changes by user Y"
StatusHistorySchema.index({ entityType: 1, entityId: 1, timestamp: -1 });
StatusHistorySchema.index({ changedBy: 1 });

/**
 * Record a status transition in the audit trail.
 *
 * @param {string}   entityType  - One of: load, bid, payment, exception, contract
 * @param {ObjectId} entityId    - The _id of the entity that changed
 * @param {string}   fromStatus  - Previous status value
 * @param {string}   toStatus    - New status value
 * @param {ObjectId} [userId]    - The user who triggered the change (null for system)
 * @param {string}   [reason]    - Optional human-readable reason
 * @param {Object}   [metadata]  - Optional extra context (e.g. bid amount, carrier name)
 * @returns {Promise<Document>}  - The saved StatusHistory document
 */
StatusHistorySchema.statics.record = async function (
  entityType,
  entityId,
  fromStatus,
  toStatus,
  userId = null,
  reason = null,
  metadata = null
) {
  return this.create({
    entityType,
    entityId,
    fromStatus,
    toStatus,
    changedBy: userId,
    reason,
    metadata,
  });
};

module.exports = mongoose.model('StatusHistory', StatusHistorySchema);
