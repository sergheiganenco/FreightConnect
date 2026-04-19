/**
 * AuditLog model
 *
 * Records every mutating API request (POST/PUT/PATCH/DELETE) for
 * compliance and forensic analysis. Entries auto-expire after 365 days.
 */

const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  role:        { type: String, default: 'anonymous' },
  action:      { type: String, enum: ['CREATE', 'READ', 'UPDATE', 'DELETE'], required: true },
  entity:      { type: String, required: true },
  entityId:    { type: String, default: null },
  method:      { type: String, enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], required: true },
  path:        { type: String, required: true },
  ip:          { type: String, default: '' },
  userAgent:   { type: String, default: '' },
  bodySummary: { type: String, default: '', maxlength: 500 },
  requestId:   { type: String, default: '' },
  timestamp:   { type: Date, default: Date.now },
});

// Query indexes
AuditLogSchema.index({ entity: 1, timestamp: -1 });
AuditLogSchema.index({ userId: 1, timestamp: -1 });

// Auto-delete after 365 days
AuditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
