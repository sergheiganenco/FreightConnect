const rateLimit = require('express-rate-limit');

// ── Optional shared Redis store for multi-instance rate limiting ──────────────
// When REDIS_URL is set and the optional packages are available, both limiters
// are backed by a shared Redis store so limits are enforced across all server
// instances. Otherwise we fall back to express-rate-limit's in-memory store.
// Fully guarded — the app must never crash or hang because of this.
let sharedStoreFactory = null; // function returning a NEW store instance per limiter
if (process.env.REDIS_URL) {
  try {
    const { RedisStore } = require('rate-limit-redis');
    const { createClient } = require('redis');
    const client = createClient({ url: process.env.REDIS_URL });
    client.on('error', (e) => console.warn('[RateLimiter] Redis error:', e.message));
    client.connect()
      .then(() => console.log('[RateLimiter] Redis-backed rate limiting enabled (multi-instance)'))
      .catch((e) => console.warn('[RateLimiter] Redis connect failed, using in-memory:', e.message));
    sharedStoreFactory = (prefix) => new RedisStore({
      sendCommand: (...args) => client.sendCommand(args),
      prefix,
    });
  } catch (e) {
    console.warn('[RateLimiter] rate-limit-redis/redis not available, using in-memory:', e.message);
    sharedStoreFactory = null;
  }
}

function makeLimiter(opts, prefix) {
  const config = { ...opts };
  if (sharedStoreFactory) {
    try {
      // Each limiter gets its OWN store instance (never share one RedisStore
      // object across limiters).
      config.store = sharedStoreFactory(prefix);
    } catch (e) {
      console.warn('[RateLimiter] store init failed, in-memory:', e.message);
    }
  }
  return rateLimit(config);
}

const authLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
}, 'rl:auth:');

const apiLimiter = makeLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  // Per-IP general API cap. Tune via RATE_LIMIT_MAX for pilots / heavy dashboards.
  max: Number(process.env.RATE_LIMIT_MAX) || 100,
  message: { error: 'Rate limit exceeded' },
  standardHeaders: true,
  legacyHeaders: false,
}, 'rl:api:');

module.exports = { authLimiter, apiLimiter };
