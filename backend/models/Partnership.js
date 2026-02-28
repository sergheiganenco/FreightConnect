/**
 * Partnership model
 *
 * Represents a carrier-to-carrier network connection.
 * Either carrier can initiate; the other accepts/declines.
 *
 * Status: pending → accepted | declined
 */

const mongoose = require('mongoose');

const PartnershipSchema = new mongoose.Schema({
  requestedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requestedTo:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined'],
    default: 'pending',
    index: true,
  },
  message: { type: String, default: '' }, // optional intro message

  // Accepted partnerships unlock contact info & preferred rates between parties
  preferredRateDiscount: { type: Number, default: 0 }, // % discount offered to partner
}, { timestamps: true });

// Ensure unique pair — no duplicate requests
PartnershipSchema.index({ requestedBy: 1, requestedTo: 1 }, { unique: true });

module.exports = mongoose.model('Partnership', PartnershipSchema);
