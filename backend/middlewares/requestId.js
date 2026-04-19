/**
 * Request ID middleware
 *
 * Attaches a unique UUID v4 to every incoming request as `req.requestId`
 * and mirrors it in the `X-Request-ID` response header. Enables
 * distributed tracing across logs, error reports, and downstream services.
 *
 * If the client already sends an `X-Request-ID` header (e.g. from a
 * reverse proxy), that value is reused instead of generating a new one.
 *
 * Usage (in app.js):
 *   const { requestId } = require('./middlewares/requestId');
 *   app.use(requestId);
 */

const crypto = require('crypto');

/**
 * Generate a UUID v4 using Node's built-in crypto module.
 * @returns {string} UUID v4 string
 */
function uuidv4() {
  return crypto.randomUUID();
}

/**
 * Express middleware that assigns a unique request ID.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const requestId = (req, res, next) => {
  const id = req.headers['x-request-id'] || uuidv4();
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
};

module.exports = { requestId };
