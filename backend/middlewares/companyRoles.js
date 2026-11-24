/**
 * Company sub-account role guards.
 *
 * companyRole is 'owner' | 'dispatcher' | 'driver' and is carried on the JWT
 * (exposed by authMiddleware). Owners/dispatchers manage the company; drivers
 * run loads (status/deliver/POD/photos/HOS/GPS) but must not book, bid on, cancel or
 * assign freight, edit the fleet or driver roster, or manage the team. A person who
 * should book for the company is given the dispatcher role.
 *
 * Mount AFTER auth so req.user is populated.
 */

// Managers = owner or dispatcher (anything that isn't a driver). Old tokens with
// no companyRole default to 'owner' in authMiddleware, so existing accounts pass.
function managerOnly(req, res, next) {
  if (req.user && req.user.companyRole === 'driver') {
    return res.status(403).json({ error: 'Drivers cannot perform this management action' });
  }
  next();
}

module.exports = { managerOnly };
