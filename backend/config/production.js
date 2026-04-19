/**
 * Production configuration module for FreightConnect.
 *
 * Usage in app.js:
 *   if (process.env.NODE_ENV === 'production') {
 *     require('./config/production')(app);
 *   }
 */
const path = require('path');
const compression = require('compression');
const express = require('express');

module.exports = function applyProductionConfig(app) {
  // ── Trust proxy ────────────────────────────────────────────────────────────
  // Required behind Railway / Render / nginx / ALB reverse proxies so that
  // req.ip, req.protocol, and rate-limiter see the real client IP.
  app.set('trust proxy', 1);

  // ── Gzip / Brotli compression ──────────────────────────────────────────────
  // Compress all responses > 1 KB.  Static assets are typically pre-compressed
  // by nginx, but this covers API JSON responses as well.
  app.use(compression({
    level: 6,                 // balance between speed and ratio
    threshold: 1024,          // don't bother below 1 KB
    filter: (req, res) => {
      // Skip compression for server-sent events
      if (req.headers['accept'] === 'text/event-stream') return false;
      return compression.filter(req, res);
    },
  }));

  // ── HTTPS redirect ─────────────────────────────────────────────────────────
  // When behind a TLS-terminating proxy (Railway, Render, ALB, nginx), the
  // proxy sets X-Forwarded-Proto.  Redirect plain HTTP to HTTPS.
  app.use((req, res, next) => {
    if (req.get('X-Forwarded-Proto') === 'http') {
      return res.redirect(301, `https://${req.get('Host')}${req.originalUrl}`);
    }
    next();
  });

  // ── Serve frontend static build ───────────────────────────────────────────
  // In the Docker image the CRA build is copied to /app/frontend-build.
  // Outside Docker (e.g. local prod test) it may be at ../frontend/build.
  const buildPath = path.resolve(__dirname, '..', 'frontend-build');
  const fallbackPath = path.resolve(__dirname, '..', '..', 'frontend', 'build');
  const fs = require('fs');
  const staticPath = fs.existsSync(buildPath) ? buildPath : fallbackPath;

  app.use(express.static(staticPath, {
    maxAge: '1y',             // aggressive caching — CRA files are content-hashed
    index: false,             // don't auto-serve index.html (catch-all does it)
  }));

  console.log(`[Production] Serving frontend from ${staticPath}`);
  console.log('[Production] HTTPS redirect enabled, trust proxy = 1, compression on');
};
