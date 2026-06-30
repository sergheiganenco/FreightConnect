const mongoose = require('mongoose');

/**
 * ProcessedEvent — idempotency guard for webhooks and one-time money operations.
 * eventId is a Stripe event.id OR an internal idempotency key (e.g. 'accessorial_<chargeId>').
 * The unique index ensures the same event can only be processed once.
 */
const ProcessedEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true }, // Stripe event.id OR an internal idempotency key
  type:    { type: String, default: null },
  processedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('ProcessedEvent', ProcessedEventSchema);
