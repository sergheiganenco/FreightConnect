const mongoose = require('mongoose');

const ChannelSchema = new mongoose.Schema({
  channelType: {
    type: String,
    enum: ['load_thread', 'direct', 'community'],
    required: true,
    index: true,
  },
  channelId: {
    type: String,
    required: true,
    unique: true,
  },
  participants: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: { type: String, enum: ['carrier', 'shipper', 'admin'] },
    joinedAt: { type: Date, default: Date.now },
    muted: { type: Boolean, default: false },
  }],
  loadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Load',
    default: null,
  },
  communityInfo: {
    name: String,
    description: String,
    region: String,
    equipmentType: String,
    minTrustScore: { type: Number, default: 50 },
    moderators: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  status: {
    type: String,
    enum: ['active', 'archived', 'locked'],
    default: 'active',
  },
  lastMessageAt: Date,
  lastMessagePreview: String,
  archiveAfter: Date,
}, { timestamps: true });

ChannelSchema.index({ 'participants.user': 1 });
ChannelSchema.index({ loadId: 1 });
ChannelSchema.index({ status: 1, lastMessageAt: -1 });

module.exports = mongoose.model('Channel', ChannelSchema);
