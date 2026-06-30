/**
 * TrackingEvent.js — Durable GPS breadcrumb / location history
 *
 * One document per stored ping. Forms an append-only trail of a carrier's
 * position over the life of a load, used for replay, audit, and dispute
 * resolution. Live position is kept on Load.carrierLocation (latest point);
 * this model is the durable history behind it.
 *
 * Deliberately NO TTL — these records are retained indefinitely so they can
 * back dispute/detention/insurance claims long after delivery.
 */

const mongoose = require('mongoose');

const TrackingEventSchema = new mongoose.Schema(
  {
    load: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Load',
      required: true,
      index: true,
    },
    carrier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    latitude:  { type: Number, required: true },
    longitude: { type: Number, required: true },

    speed:    { type: Number, default: null }, // km/h (optional, from GPS/ELD)
    heading:  { type: Number, default: null }, // degrees 0-360 (optional)
    accuracy: { type: Number, default: null }, // meters (optional)

    source: {
      type: String,
      enum: ['browser', 'mobile_app', 'eld', 'api', 'owntracks', 'traccar'],
      default: 'api',
    },

    recordedAt: { type: Date, default: Date.now, index: true },
  },
  {
    versionKey: false,
  }
);

// Latest-point lookups and time-range replay queries for a single load.
TrackingEventSchema.index({ load: 1, recordedAt: -1 });

module.exports =
  mongoose.models.TrackingEvent ||
  mongoose.model('TrackingEvent', TrackingEventSchema);
