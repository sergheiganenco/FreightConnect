const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  channelType: {
    type: String,
    enum: ['load_thread', 'direct', 'community'],
    required: true,
    index: true,
  },
  channelId: {
    type: String,
    required: true,
    index: true,
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null, // null = system message
  },
  content: {
    type: String,
    required: true,
    maxlength: 2000,
  },
  messageType: {
    type: String,
    enum: ['text', 'status_update', 'photo', 'location', 'system', 'load_share'],
    default: 'text',
  },
  attachments: [{
    url: String,
    filename: String,
    mimeType: String,
    size: Number,
  }],
  location: {
    latitude: Number,
    longitude: Number,
  },
  sharedLoadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Load',
    default: null,
  },
  readBy: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    readAt: { type: Date, default: Date.now },
  }],
  edited: { type: Boolean, default: false },
  editedAt: Date,
  deleted: { type: Boolean, default: false },
}, { timestamps: true });

MessageSchema.index({ channelId: 1, createdAt: -1 });
MessageSchema.index({ sender: 1, createdAt: -1 });

module.exports = mongoose.model('Message', MessageSchema);
