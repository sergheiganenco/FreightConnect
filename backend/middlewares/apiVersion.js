/**
 * API versioning middleware
 *
 * Reads the `X-API-Version` request header and attaches `req.apiVersion`
 * (defaults to `"v1"`). Route handlers can use this value to branch
 * behaviour for breaking changes without duplicating route files.
 *
 * Usage (in app.js):
 *   const { apiVersion } = require('./middlewares/apiVersion');
 *   app.use(apiVersion);
 *
 * In a route handler:
 *   if (req.apiVersion === 'v2') { ... }
 */

const SUPPORTED_VERSIONS = ['v1'];
const DEFAULT_VERSION = 'v1';

/**
 * Express middleware that extracts and validates the API version.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const apiVersion = (req, res, next) => {
  const header = req.headers['x-api-version'];
  const version = header && typeof header === 'string' ? header.trim().toLowerCase() : DEFAULT_VERSION;

  if (header && !SUPPORTED_VERSIONS.includes(version)) {
    return res.status(400).json({
      error: `Unsupported API version "${header}". Supported: ${SUPPORTED_VERSIONS.join(', ')}`,
    });
  }

  req.apiVersion = version;
  res.setHeader('X-API-Version', version);
  next();
};

module.exports = { apiVersion, SUPPORTED_VERSIONS, DEFAULT_VERSION };
