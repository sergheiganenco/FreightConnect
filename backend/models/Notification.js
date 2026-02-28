/**
 * Notification model
 *
 * Persists every in-app notification so users can review their history
 * even if they were offline when the event fired.
 *
 * Types:
 *   load:matched       — new load matched carrier preferences
 *   load:accepted      — carrier accepted shipper's load
 *   load:status        — load status changed (in-transit, delivered, etc.)
 *   bid:new            — new bid placed on your load (shipper)
 *   bid:accepted       — your bid was accepted (carrier)
 *   bid:rejected       — your bid was rejected (carrier)
 *   bid:countered      — shipper countered your bid (carrier)
 *   bid:counter_accepted — carrier accepted your counter (shipper)
 *   payment:escrowed   — payment placed in escrow (carrier notification)
 *   payment:released   — payout released to carrier
 *   doc:generated      — document auto-generated for your load
 *   exception:new      — new exception filed on your load
 *   exception:updated  — exception status changed
 *   exception:note     — new note added to an exception
 *   insurance:expiring — insurance expiring soon (carrier)
 *   insurance:lapsed   — insurance has lapsed (carrier)
 */

const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type:     { type: String, required: true },
  title:    { type: String, required: true },
  body:     { type: String, default: '' },
  link:     { type: String, default: null },   // optional frontend route to navigate to
  read:     { type: Boolean, default: false, index: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },  // arbitrary extra data
}, { timestamps: true });

// Composite index for fast unread fetches per user
NotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

// TTL — auto-delete notifications older than 90 days
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('Notification', NotificationSchema);
