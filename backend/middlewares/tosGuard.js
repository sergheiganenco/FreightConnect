const jwt = require('jsonwebtoken');
const User = require('../models/User');

const CURRENT_TOS_VERSION = '1.0';

// Paths that skip ToS check entirely (unauthenticated or special routes)
const SKIP_PATHS = [
  '/api/users/login',
  '/api/users/signup',
  '/api/health',
  '/api/tos',
  '/api/tracking-portal',
];

/**
 * Middleware that ensures the authenticated user has accepted the current ToS version.
 *
 * Mounted globally BEFORE route-level JWT auth (app.js), so req.user is only
 * pre-set for API-key clients (apiKeyAuth). For JWT/browser/mobile traffic we
 * peek at the bearer token ourselves — otherwise this guard never sees a user
 * and is dead code for the entire web/mobile app. Invalid or missing tokens
 * fall through untouched; authMiddleware still owns the 401 semantics.
 */
const tosGuard = async (req, res, next) => {
  // Skip paths that don't require ToS acceptance
  const shouldSkip = SKIP_PATHS.some(p => req.originalUrl.startsWith(p));
  if (shouldSkip) return next();

  // Resolve the acting user: apiKeyAuth may have set req.user; otherwise
  // decode the JWT (verify-only peek — no req.user side effects).
  let userId = req.user && req.user.userId;
  if (!userId) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token) {
      try {
        userId = jwt.verify(token, process.env.JWT_SECRET).userId;
      } catch (_) {
        // invalid/expired token — authMiddleware will reply 401 downstream
      }
    }
  }

  // No identifiable user (unauthenticated route) — auth middleware handles 401
  if (!userId) return next();

  try {
    const user = await User.findById(userId).select('tosAccepted tosVersion').lean();
    if (!user) return next(); // user not found — let downstream handle

    if (!user.tosAccepted || user.tosVersion !== CURRENT_TOS_VERSION) {
      return res.status(403).json({
        error: 'Terms of Service acceptance required',
        tosRequired: true,
        currentVersion: CURRENT_TOS_VERSION,
      });
    }

    next();
  } catch (err) {
    console.error('[tosGuard] Error checking ToS status:', err.message);
    next(); // fail open — don't block on DB errors
  }
};

module.exports = tosGuard;
module.exports.CURRENT_TOS_VERSION = CURRENT_TOS_VERSION;
