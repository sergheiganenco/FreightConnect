/**
 * Rating model
 *
 * Post-delivery ratings between shippers and carriers.
 * Each user can rate the other party once per load.
 *
 * Categories:
 *   - communication, punctuality, professionalism (universal)
 *   - cargoHandling (carrier-only)
 *   - paymentSpeed (shipper-only)
 */

const mongoose = require('mongoose');

const RatingSchema = new mongoose.Schema({
  // ── References ────────────────────────────────────────────────────────────
  loadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Load',
    required: true,
  },
  fromUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  toUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  fromRole: {
    type: String,
    enum: ['carrier', 'shipper'],
    required: true,
  },
  toRole: {
    type: String,
    enum: ['carrier', 'shipper'],
    required: true,
  },

  // ── Overall score ─────────────────────────────────────────────────────────
  overall: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },

  // ── Category scores ───────────────────────────────────────────────────────
  categories: {
    communication:    { type: Number, min: 1, max: 5 },
    punctuality:      { type: Number, min: 1, max: 5 },
    professionalism:  { type: Number, min: 1, max: 5 },
    cargoHandling:    { type: Number, min: 1, max: 5 }, // only when rating carriers
    paymentSpeed:     { type: Number, min: 1, max: 5 }, // only when rating shippers
  },

  // ── Comment & response ────────────────────────────────────────────────────
  comment: {
    type: String,
    maxlength: 500,
  },
  response: {
    type: String,
    maxlength: 500,
  },
  respondedAt: {
    type: Date,
  },

  // ── Visibility ────────────────────────────────────────────────────────────
  isPublic: {
    type: Boolean,
    default: true,
  },

  // ── Timestamps ────────────────────────────────────────────────────────────
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// ── Indexes ───────────────────────────────────────────────────────────────────
RatingSchema.index({ toUser: 1, createdAt: -1 });
RatingSchema.index({ loadId: 1, fromUser: 1 }, { unique: true }); // one rating per user per load
RatingSchema.index({ toUser: 1, overall: 1 });

// ── Static: aggregate averages for a user ─────────────────────────────────────
/**
 * Get average ratings for a user.
 * @param {ObjectId|string} userId
 * @returns {Promise<{overall: number, communication: number, punctuality: number, professionalism: number, count: number}>}
 */
RatingSchema.statics.getAverageForUser = async function (userId) {
  const result = await this.aggregate([
    { $match: { toUser: new mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: null,
        overall:         { $avg: '$overall' },
        communication:   { $avg: '$categories.communication' },
        punctuality:     { $avg: '$categories.punctuality' },
        professionalism: { $avg: '$categories.professionalism' },
        count:           { $sum: 1 },
      },
    },
  ]);

  if (!result.length) {
    return { overall: 0, communication: 0, punctuality: 0, professionalism: 0, count: 0 };
  }

  const r = result[0];
  return {
    overall:         Math.round(r.overall * 100) / 100,
    communication:   Math.round((r.communication || 0) * 100) / 100,
    punctuality:     Math.round((r.punctuality || 0) * 100) / 100,
    professionalism: Math.round((r.professionalism || 0) * 100) / 100,
    count:           r.count,
  };
};

module.exports = mongoose.model('Rating', RatingSchema);
