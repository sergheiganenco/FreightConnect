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

/** Fields that must never appear in audit log body summaries */
const SENSITIVE_FIELDS = new Set([
  'password', 'token', 'secret', 'ssn', 'cardNumber', 'cvv',
  'accountNumber', 'routingNumber', 'apiKey', 'refreshToken',
  'accessToken', 'stripeToken', 'bankAccount',
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

module.exports = { auditLog };
