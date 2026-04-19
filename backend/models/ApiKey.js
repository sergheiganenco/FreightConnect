const mongoose = require('mongoose');
const crypto = require('crypto');

const ApiKeySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  key: {
    type: String,
    unique: true,
    required: true,
  },
  prefix: {
    type: String,
    required: true,
  },
  permissions: {
    type: [String],
    default: [],
    enum: [
      'loads:read', 'loads:write',
      'tracking:read', 'tracking:write',
      'documents:read', 'documents:write',
      'rates:read',
      'analytics:read',
      'webhooks:manage',
    ],
  },
  rateLimit: {
    type: Number,
    default: 1000, // requests per hour
  },
  lastUsedAt: {
    type: Date,
  },
  usageCount: {
    type: Number,
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  expiresAt: {
    type: Date,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Indexes
ApiKeySchema.index({ key: 1 }, { unique: true });
ApiKeySchema.index({ userId: 1 });
ApiKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Generate a secure random API key in fc_live_xxxxx format.
 * @returns {string} Raw API key (show to user once, then discard)
 */
ApiKeySchema.statics.generateKey = function () {
  const random = crypto.randomBytes(32).toString('hex');
  return `fc_live_${random}`;
};

/**
 * SHA-256 hash of a raw key for secure storage.
 * @param {string} rawKey
 * @returns {string} hex digest
 */
ApiKeySchema.statics.hashKey = function (rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
};

/**
 * Look up an API key document by raw (unhashed) key.
 * @param {string} rawKey
 * @returns {Promise<Document|null>}
 */
ApiKeySchema.statics.findByRawKey = async function (rawKey) {
  const hashed = this.hashKey(rawKey);
  return this.findOne({ key: hashed });
};

module.exports = mongoose.model('ApiKey', ApiKeySchema);
