const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getIO } = require('../utils/socket');

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

/**
 * Returns { active, mustChangePassword }. active is true, false (deactivated),
 * or null (account not found).
 */
async function resolveAccount(userId) {
  const key = String(userId);
  const cached = activeCache.get(key);
  if (cached && Date.now() - cached.at < ACTIVE_TTL_MS) return cached;

  const u = await User.findById(userId).select('active mustChangePassword parentAccountId').lean();
  let active = u ? u.active !== false : null; // missing field => treat as active
  // Deactivating a company owner switches off its dispatcher/driver logins too
  // (takes effect within the cache TTL for sessions already in flight).
  if (active && u.parentAccountId) {
    const owner = await User.findById(u.parentAccountId).select('active').lean();
    if (!owner || owner.active === false) active = false;
  }
  const entry = {
    active,
    mustChangePassword: !!(u && u.mustChangePassword),
    at: Date.now(),
  };
  if (entry.active !== null) activeCache.set(key, entry);
  return entry;
}

/**
 * The ONE account-status decision, shared by JWT auth, API-key auth and the
 * socket handshake. Returns null (ok) | 'deactivated' | 'not_found' |
 * 'password_change_required'. Throws on DB error — each caller picks its own
 * failure mode (JWT/socket-event: fail open; API key/handshake: fail closed).
 */
async function accountBlockReason(userId) {
  const { active, mustChangePassword } = await resolveAccount(userId);
  if (active === false) return 'deactivated';
  if (active === null) return 'not_found';
  if (mustChangePassword) return 'password_change_required';
  return null;
}

/**
 * Call after any `active` change. Busts the cache for the user and (if they own a
 * company) every sub-account — a sub-account's status depends on its owner — and,
 * when `disconnect` is true, drops their live sockets (they join `user_<id>`).
 * `io` is injectable for tests; defaults to the app singleton.
 */
async function revokeSessions(userId, { disconnect = false, io = getIO() } = {}) {
  const subs = await User.find({ parentAccountId: userId }).select('_id').lean();
  const ids = [String(userId), ...subs.map((s) => String(s._id))];
  ids.forEach(invalidateActive);
  if (disconnect && io) ids.forEach((id) => io.in(`user_${id}`).disconnectSockets(true));
  return ids;
}

// While a temporary password is in force the account may only read its own
// identity and change the password — enforced here, not just by the UI redirect.
const PASSWORD_CHANGE_ALLOWED = [
  ['POST', '/users/change-password'],
  ['GET', '/users/me'],
  ['GET', '/users/whoami'],
  // ToS must stay acceptable first: tosGuard blocks change-password until it is.
  ['POST', '/tos/accept'],
  ['GET', '/tos/status'],
];

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
    const blocked = await accountBlockReason(decoded.userId);
    if (blocked === 'deactivated') {
      return res.status(401).json({ error: 'This account has been deactivated', code: 'account_deactivated' });
    }
    if (blocked === 'not_found') {
      return res.status(401).json({ error: 'Account not found' });
    }
    if (blocked === 'password_change_required') {
      const path = req.originalUrl.split('?')[0].replace(/\/$/, '');
      const allowed = PASSWORD_CHANGE_ALLOWED.some(([m, p]) => req.method === m && path.endsWith(p));
      if (!allowed) {
        return res.status(403).json({ error: 'You must change your temporary password before continuing', code: 'password_change_required' });
      }
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
auth.resolveAccount = resolveAccount;
auth.accountBlockReason = accountBlockReason;
auth.revokeSessions = revokeSessions;
module.exports = auth;
