/**
 * Integration: tosGuard must bite JWT traffic (production mounting order).
 *
 * The audit found tosGuard was dead code for browser/mobile users: it is
 * mounted BEFORE route-level JWT auth, so req.user is never set when it runs
 * (only API-key clients got checked). The guard must peek at the bearer token
 * itself. Mirrors app.js order: apiKeyAuth → tosGuard → route auth.
 */

require('../setup');
const express = require('express');
const request = require('supertest');

const { createTestUser, generateToken } = require('../helpers');
const { apiKeyAuth } = require('../../middlewares/apiKeyAuth');
const tosGuard = require('../../middlewares/tosGuard');
const auth = require('../../middlewares/authMiddleware');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(apiKeyAuth);          // same order as app.js
  app.use('/api/', tosGuard);   // mounted before route-level auth, like production
  app.get('/api/protected', auth, (req, res) => res.json({ ok: true }));
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  return app;
}

describe('tosGuard — JWT traffic enforcement', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  test('blocks a JWT user who has NOT accepted the current ToS (403 tosRequired)', async () => {
    const user = await createTestUser({ role: 'carrier' }); // no tosAccepted
    const res = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${generateToken(user)}`);

    expect(res.status).toBe(403);
    expect(res.body.tosRequired).toBe(true);
  });

  test('blocks a JWT user on an OUTDATED ToS version', async () => {
    const user = await createTestUser({
      role: 'shipper',
      tosAccepted: true,
      tosVersion: '0.9',
    });
    const res = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${generateToken(user)}`);

    expect(res.status).toBe(403);
    expect(res.body.tosRequired).toBe(true);
  });

  test('passes a JWT user who accepted the current ToS', async () => {
    const user = await createTestUser({
      role: 'carrier',
      tosAccepted: true,
      tosVersion: tosGuard.CURRENT_TOS_VERSION,
    });
    const res = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${generateToken(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('unauthenticated request falls through to auth middleware (401, not ToS 403)', async () => {
    const res = await request(app).get('/api/protected');
    expect(res.status).toBe(401);
  });

  test('garbage bearer token falls through to auth middleware (401, no crash)', async () => {
    const res = await request(app)
      .get('/api/protected')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  test('skip paths (e.g. /api/health) stay open regardless of ToS', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });
});
