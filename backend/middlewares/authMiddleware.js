const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * A short TTL cache of userId -> active, so we don't hit the DB on every authed
 * request. This bounds how long a just-deactivated account can keep acting to the
 * TTL (revocation is made immediate by invalidateActive() on deactivation).
 */
const ACTIVE_TTL_MS = 60 * 1000;
const activeCache = new Map();

function invalidateActive(userId) {
  if (userId) activeCache.delete(String(userId));
}

/** Returns true (active), false (deactivated), or null (account not found). */
async function resolveActive(userId) {
  const key = String(userId);
  const cached = activeCache.get(key);
  if (cached && Date.now() - cached.at < ACTIVE_TTL_MS) return cached.active;

  const u = await User.findById(userId).select('active').lean();
  const active = u ? u.active !== false : null; // missing field => treat as active
  if (active !== null) activeCache.set(key, { active, at: Date.now() });
  return active;
}

const auth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or invalid' });
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Account-status revocation: a deactivated (or deleted) account's still-valid
  // token must stop working immediately, not linger until the 1-day expiry.
  try {
    const active = await resolveActive(decoded.userId);
    if (active === false) {
      return res.status(401).json({ error: 'This account has been deactivated', code: 'account_deactivated' });
    }
    if (active === null) {
      return res.status(401).json({ error: 'Account not found' });
    }
  } catch (_) {
    // DB error → fail OPEN so a transient DB issue can't lock everyone out. Login
    // already blocks new sessions for deactivated accounts.
  }

  req.user = {
    userId: decoded.userId,
    role: decoded.role,
    companyRole: decoded.companyRole || 'owner',
    // The company an account acts for (owner id). Sub-account tokens carry it;
    // older tokens (owners only) fall back to their own id — same thing.
    companyOwnerId: decoded.companyOwnerId || decoded.userId,
  };
  next();
};

auth.invalidateActive = invalidateActive;
module.exports = auth;
