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
 * Must be mounted AFTER authMiddleware sets req.user.
 * Skips unauthenticated requests (those are handled by authMiddleware itself).
 */
const tosGuard = async (req, res, next) => {
  // Skip paths that don't require ToS acceptance
  const shouldSkip = SKIP_PATHS.some(p => req.originalUrl.startsWith(p));
  if (shouldSkip) return next();

  // If no user attached (unauthenticated route), skip — auth middleware will handle 401
  if (!req.user || !req.user.userId) return next();

  try {
    const user = await User.findById(req.user.userId).select('tosAccepted tosVersion').lean();
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
