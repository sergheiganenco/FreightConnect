const ApiKey = require('../models/ApiKey');
const User = require('../models/User');

// In-memory rate limit tracking (per API key hash)
const rateLimitStore = new Map();

/**
 * API key authentication middleware.
 * Checks x-api-key header or api_key query param.
 * If no key is present, falls through to let JWT auth handle it.
 */
const apiKeyAuth = async (req, res, next) => {
  const rawKey = req.headers['x-api-key'] || req.query.api_key;
  if (!rawKey) return next(); // No API key — fall through to JWT auth

  try {
    const apiKey = await ApiKey.findByRawKey(rawKey);
    if (!apiKey) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    // Check active
    if (!apiKey.isActive) {
      return res.status(401).json({ error: 'API key is deactivated' });
    }

    // Check expiry
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return res.status(401).json({ error: 'API key has expired' });
    }

    // Rate limit check (sliding window per hour)
    const now = Date.now();
    const windowMs = 60 * 60 * 1000; // 1 hour
    const keyId = apiKey._id.toString();
    let bucket = rateLimitStore.get(keyId);

    if (!bucket || now - bucket.windowStart > windowMs) {
      bucket = { windowStart: now, count: 0 };
      rateLimitStore.set(keyId, bucket);
    }

    bucket.count += 1;
    if (bucket.count > apiKey.rateLimit) {
      return res.status(429).json({
        error: 'API key rate limit exceeded',
        limit: apiKey.rateLimit,
        windowMs,
      });
    }

    // Look up user
    const user = await User.findById(apiKey.userId).select('-password');
    if (!user) {
      return res.status(401).json({ error: 'API key owner not found' });
    }

    // Attach req.user (same shape as JWT auth)
    req.user = {
      userId: user._id.toString(),
      role: user.role,
    };

    // Attach API key metadata for permission checks
    req.apiKey = {
      id: apiKey._id,
      permissions: apiKey.permissions,
      name: apiKey.name,
    };

    // Update usage stats (fire-and-forget)
    ApiKey.updateOne(
      { _id: apiKey._id },
      { $set: { lastUsedAt: new Date() }, $inc: { usageCount: 1 } }
    ).catch(() => {});

    next();
  } catch (err) {
    console.error('[apiKeyAuth] Error:', err.message);
    return res.status(500).json({ error: 'Server error during API key authentication' });
  }
};

/**
 * Permission checker middleware.
 * Use after apiKeyAuth + authMiddleware.
 * If the request was authenticated via API key, checks that the key
 * includes the required permission. JWT-authenticated requests pass through.
 */
const requirePermission = (permission) => (req, res, next) => {
  if (req.apiKey && !req.apiKey.permissions.includes(permission)) {
    return res.status(403).json({
      error: `API key missing required permission: ${permission}`,
    });
  }
  next();
};

module.exports = { apiKeyAuth, requirePermission };
