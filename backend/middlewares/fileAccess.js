/**
 * fileAccess.js — nobody opens a stored document without being signed in.
 *
 * Files under /documents are opened by the browser as plain links (new tab, <a href>), which cannot carry the
 * Authorization header. So every time a session is confirmed (login, token refresh, GET /users/me) the server also sets
 * an HttpOnly cookie scoped to /documents. It is signed with a key derived from JWT_SECRET, so it is NOT a session
 * token: it cannot be used on the API, and script on the page cannot read it.
 *
 * A file named after a load (<loadId>-bol.pdf, -ratecon.pdf, -invoice.pdf, -pod.*) is served only to that load's
 * shipper company, carrier company, or an admin; a settlement statement only to its carrier company or an admin.
 * ponytail: other uploads (timestamp-named) are open to any signed-in user who knows the URL; add an owner registry
 * (file -> company) if those ever need per-company checks.
 */
const jwt = require('jsonwebtoken');

const COOKIE = 'fc_files';
const DAY_MS = 24 * 60 * 60 * 1000;
const fileSecret = () => `${process.env.JWT_SECRET}:files`;

/** Call wherever a session is issued or confirmed. `user` = req.user-like { userId, role, companyOwnerId }. */
function setFileCookie(res, { userId, role, companyOwnerId, companyRole }) {
  try {
    const token = jwt.sign({ uid: String(userId), role, cid: String(companyOwnerId || userId), cr: companyRole || 'owner' }, fileSecret(), { expiresIn: '1d' });
    res.cookie(COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: DAY_MS, path: '/documents',
    });
  } catch (err) { console.error('[fileAccess] cookie not set:', err.message); }
}
function clearFileCookie(res) { res.clearCookie(COOKIE, { path: '/documents' }); }

function identityOf(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie || '');
  if (m) {
    try { const c = jwt.verify(decodeURIComponent(m[1]), fileSecret()); return { uid: c.uid, role: c.role, cid: c.cid, cr: c.cr }; } catch (_) { /* fall through */ }
  }
  // API clients (the phone app) send the session token itself.
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try { const c = jwt.verify(h.slice(7), process.env.JWT_SECRET); return { uid: String(c.userId), role: c.role, cid: String(c.companyOwnerId || c.userId), cr: c.companyRole || 'owner' }; } catch (_) { /* not signed in */ }
  }
  return null;
}

const same = (a, b) => a != null && b != null && String(a) === String(b);

async function requireFileAccess(req, res, next) {
  try {
    const who = identityOf(req);
    if (!who) return res.status(401).type('text/plain').send('Sign in to open this document.');
    // A deactivated or deleted account loses its documents at once, like it loses the API (same cached check).
    const blocked = await require('./authMiddleware').accountBlockReason(who.uid);
    if (blocked === 'deactivated' || blocked === 'not_found') { clearFileCookie(res); return res.status(401).type('text/plain').send('Sign in to open this document.'); }
    // Judge the SAME name the file server will serve: decode it once, and refuse anything that is not one plain file
    // name (no folders, no dot segments, no encoded separators), so no spelling of a path can dodge the check below.
    let name;
    try { name = decodeURIComponent(req.path); } catch (_) { return res.status(400).end(); }
    if (!/^\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes('..')) return res.status(404).end();
    req.url = name; // served exactly as checked
    const m = /^\/([a-f0-9]{24})-/i.exec(name);
    if (m && who.role !== 'admin') {
      if (/-settlement\.pdf$/i.test(name)) {
        const s = await require('../models/Settlement').findById(m[1]).select('companyOwnerId').lean();
        // Same rule as the settlements API: the owning company's managers only, never its drivers.
        if (!s || !same(s.companyOwnerId, who.cid) || who.cr === 'driver') return res.status(404).end();
      } else {
        const load = await require('../models/Load').findById(m[1]).select('postedBy acceptedBy').lean();
        // A 24-hex prefix that is not a load is not a load document: fall through to the signed-in rule.
        if (load && !same(load.postedBy, who.cid) && !same(load.acceptedBy, who.cid)) return res.status(404).end();
      }
    }
    res.setHeader('Cache-Control', 'private, no-store');
    next();
  } catch (err) {
    console.error('[fileAccess] failed:', err.message);
    res.status(500).end();
  }
}

module.exports = { setFileCookie, clearFileCookie, requireFileAccess };
