/**
 * Audit logging middleware for compliance
 *
 * Logs every mutating API request (POST, PUT, PATCH, DELETE) to the
 * AuditLog MongoDB collection. Designed as a function factory so each
 * route can declare its entity and action semantics.
 *
 * Usage (in a route file):
 *   const { auditLog } = require('../middlewares/auditLogger');
 *
 *   router.post('/', authMiddleware, auditLog('load', 'CREATE'), async (req, res) => { ... });
 *   router.put('/:id', authMiddleware, auditLog('load', 'UPDATE'), async (req, res) => { ... });
 *   router.delete('/:id', authMiddleware, auditLog('load', 'DELETE'), async (req, res) => { ... });
 */

const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

/**
 * Fields that must never appear in audit log body summaries. Keys are matched
 * case-insensitively (lowercased), so every entry here MUST be lowercase — the
 * previous camelCase entries (cardNumber, apiKey, …) could never match.
 */
const SENSITIVE_FIELDS = new Set([
  'password', 'token', 'secret', 'ssn', 'ssnlast4', 'cvv',
  'cardnumber', 'accountnumber', 'routingnumber', 'apikey', 'refreshtoken',
  'accesstoken', 'stripetoken', 'bankaccount',
  // Domain PII (tax IDs, CDL) — also encrypted at rest, so must not leak here.
  'ein', 'tin', 'taxid', 'licensenumber', 'mfatoken', 'otp', 'code',
]);

/**
 * Build a truncated body summary, stripping sensitive fields.
 * @param {Object} body - Request body
 * @returns {string} JSON string, max 500 characters
 */
function buildBodySummary(body) {
  if (!body || typeof body !== 'object') return '';

  const safe = {};
  for (const [key, value] of Object.entries(body)) {
    if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
      safe[key] = '[REDACTED]';
    } else {
      safe[key] = value;
    }
  }

  const json = JSON.stringify(safe);
  return json.length > 500 ? json.slice(0, 497) + '...' : json;
}

/**
 * Factory that returns an Express middleware logging the request to AuditLog.
 * The log is fire-and-forget so it never blocks the response.
 *
 * @param {string} entity - Domain entity being acted on (e.g. 'load', 'user', 'bid')
 * @param {string} action - Semantic action: CREATE | READ | UPDATE | DELETE
 * @returns {import('express').RequestHandler}
 */
const auditLog = (entity, action) => {
  return async (req, res, next) => {
    // Fire-and-forget: do not await, do not block the response
    try {
      const entry = {
        userId: req.user ? req.user.userId : null,
        role: req.user ? req.user.role : 'anonymous',
        action,
        entity,
        entityId: req.params.id || req.params.loadId || null,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip || req.connection?.remoteAddress || '',
        userAgent: req.headers['user-agent'] || '',
        bodySummary: buildBodySummary(req.body),
        requestId: req.requestId || '',
      };

      // Non-blocking write
      AuditLog.create(entry).catch((err) => {
        logger.error('Audit log write failed', { error: err.message, path: req.originalUrl });
      });
    } catch (err) {
      logger.error('Audit log middleware error', { error: err.message });
    }

    next();
  };
};

// ── Global request auditing ──────────────────────────────────────────────────
// The factory above must be attached per-route; this variant audits EVERY
// mutating request in one place. It records on res 'finish' so req.user (set by
// each route's auth middleware) is populated, and infers the entity from the URL.

const METHOD_ACTION = { POST: 'CREATE', PUT: 'UPDATE', PATCH: 'UPDATE', DELETE: 'DELETE' };

const ENTITY_MAP = {
  loads: 'load', users: 'user', bids: 'bid', payments: 'payment', documents: 'document',
  chat: 'chat', exceptions: 'exception', contracts: 'contract', appointments: 'appointment',
  trips: 'trip', eld: 'eld', drivers: 'driver', tax: 'tax', verification: 'verification',
  capacity: 'capacity', partnerships: 'partnership', factoring: 'factoring', admin: 'admin',
  tracking: 'tracking', ratings: 'rating', reefer: 'reefer', edi: 'edi', expenses: 'expense',
  quickpay: 'quickpay', 'preferred-carriers': 'preferred_carrier', 'return-loads': 'return_load',
};

// Never write these to the audit trail: webhooks/health are machine calls, and
// GPS location writes are high-frequency (every ~15s per truck) — auditing each
// would flood the collection.
const SKIP_PREFIXES = [
  '/api/payments/webhook', '/api/eld-integration/webhook', '/api/health',
  '/api/tracking/ingest', '/api/tracking/location',
];
// Record the action but NOT the body for these (auth/credential/PII payloads).
const NO_BODY_PREFIXES = [
  '/api/users/login', '/api/users/signup', '/api/users/reset-password',
  '/api/users/forgot-password', '/api/users/refresh-token', '/api/users/mfa',
  '/api/users/push-token', '/api/tax/w9', '/api/verification',
];

function inferEntity(path) {
  const m = path.match(/^\/api\/([a-z0-9-]+)/i);
  if (!m) return 'other';
  const seg = m[1].toLowerCase();
  return ENTITY_MAP[seg] || seg;
}

function extractEntityId(path) {
  const m = path.match(/\/([a-f\d]{24})(?=\/|$|\?)/i); // first Mongo ObjectId in the path
  return m ? m[1] : null;
}

/**
 * Global audit middleware — mount once on `/api` before the routes.
 * @returns {import('express').RequestHandler}
 */
function auditRequests() {
  return (req, res, next) => {
    const action = METHOD_ACTION[req.method];
    if (!action) return next(); // only mutating requests
    if (SKIP_PREFIXES.some((p) => req.originalUrl.startsWith(p))) return next();

    res.on('finish', () => {
      try {
        // Only record mutations that actually took effect (2xx/3xx).
        if (res.statusCode >= 400) return;
        const noBody = NO_BODY_PREFIXES.some((p) => req.originalUrl.startsWith(p));
        AuditLog.create({
          userId: req.user ? req.user.userId : null,
          role: req.user ? req.user.role : 'anonymous',
          action,
          entity: inferEntity(req.originalUrl),
          entityId: extractEntityId(req.originalUrl),
          method: req.method,
          path: req.originalUrl,
          ip: req.ip || req.connection?.remoteAddress || '',
          userAgent: req.headers['user-agent'] || '',
          bodySummary: noBody ? '[REDACTED]' : buildBodySummary(req.body),
          requestId: req.requestId || '',
        }).catch((err) => logger.error('Audit log write failed', { error: err.message, path: req.originalUrl }));
      } catch (_) { /* auditing must never affect the response */ }
    });

    next();
  };
}

module.exports = { auditLog, auditRequests, inferEntity, extractEntityId };
