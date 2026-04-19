/**
 * Structured JSON logger
 *
 * In production, outputs newline-delimited JSON for log aggregators.
 * In development, outputs human-readable colored lines.
 *
 * Usage:
 *   const logger = require('../utils/logger');
 *   logger.info('Load accepted', { loadId, carrierId });
 *   logger.error('Payment failed', { error: err.message, requestId: req.requestId });
 */

const isProd = process.env.NODE_ENV === 'production';

/**
 * Format and write a log entry.
 * @param {'info'|'warn'|'error'|'debug'} level
 * @param {string} msg - Human-readable message
 * @param {Object} meta - Structured metadata (requestId, userId, etc.)
 */
function write(level, msg, meta) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    msg,
    ...meta,
  };

  if (isProd) {
    // Newline-delimited JSON for production log pipelines
    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(JSON.stringify(entry) + '\n');
  } else {
    // Human-readable for local development
    const colors = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', debug: '\x1b[90m' };
    const reset = '\x1b[0m';
    const color = colors[level] || reset;
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    const stream = level === 'error' ? console.error : console.log;
    stream(`${color}[${entry.timestamp}] ${level.toUpperCase()}${reset} ${msg}${metaStr}`);
  }
}

/** @type {{ info: Function, warn: Function, error: Function, debug: Function }} */
const logger = {
  /**
   * Log an informational message.
   * @param {string} msg
   * @param {Object} [meta={}]
   */
  info: (msg, meta = {}) => write('info', msg, meta),

  /**
   * Log a warning.
   * @param {string} msg
   * @param {Object} [meta={}]
   */
  warn: (msg, meta = {}) => write('warn', msg, meta),

  /**
   * Log an error.
   * @param {string} msg
   * @param {Object} [meta={}]
   */
  error: (msg, meta = {}) => write('error', msg, meta),

  /**
   * Log a debug message (suppressed in production).
   * @param {string} msg
   * @param {Object} [meta={}]
   */
  debug: (msg, meta = {}) => {
    if (!isProd) write('debug', msg, meta);
  },
};

module.exports = logger;
