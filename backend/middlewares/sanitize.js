/**
 * NoSQL injection prevention middleware
 *
 * Recursively strips keys that start with `$` from req.body, req.query,
 * and req.params to prevent MongoDB operator injection attacks such as
 * { "password": { "$gt": "" } }.
 *
 * Usage (in app.js):
 *   const { sanitizeInput } = require('./middlewares/sanitize');
 *   app.use(sanitizeInput);
 */

const logger = require('../utils/logger');

/**
 * Recursively remove any object keys that begin with `$`.
 * Handles nested objects and arrays. Returns a sanitized copy
 * (does not mutate the original).
 * @param {*} obj - Value to sanitize
 * @returns {*} Sanitized value
 */
function stripDollarKeys(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(stripDollarKeys);
  }

  const clean = {};
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$')) {
      // Silently drop the dangerous key
      continue;
    }
    clean[key] = stripDollarKeys(obj[key]);
  }
  return clean;
}

/**
 * Express middleware that sanitizes req.body, req.query, and req.params
 * against NoSQL injection operators.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const sanitizeInput = (req, res, next) => {
  try {
    if (req.body && typeof req.body === 'object') {
      req.body = stripDollarKeys(req.body);
    }
    if (req.query && typeof req.query === 'object') {
      req.query = stripDollarKeys(req.query);
    }
    if (req.params && typeof req.params === 'object') {
      req.params = stripDollarKeys(req.params);
    }
  } catch (err) {
    logger.error('Sanitize middleware error', { error: err.message });
  }
  next();
};

module.exports = { sanitizeInput, stripDollarKeys };
