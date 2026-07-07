/**
 * Integration: the global audit middleware records mutating requests, redacts
 * credential bodies, skips failures, and the admin endpoint can read the trail.
 */

require('../setup');
const express = require('express');
const request = require('supertest');
const AuditLog = require('../../models/AuditLog');
const { createTestUser, generateToken } = require('../helpers');
const { auditRequests, inferEntity, extractEntityId } = require('../../middlewares/auditLogger');
const auth = require('../../middlewares/authMiddleware');

// Small helper: audit writes happen on res 'finish' (fire-and-forget), so give the
// async AuditLog.create a moment to land before asserting.
const settle = () => new Promise((r) => setTimeout(r, 60));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/', auditRequests());
  // A couple of authed mutating routes + one that 400s.
  app.post('/api/loads/:id/thing', auth, (req, res) => res.json({ ok: true }));
  app.post('/api/users/login', (req, res) => res.json({ ok: true }));
  app.post('/api/widgets', auth, (req, res) => res.status(400).json({ error: 'bad' }));
  app.get('/api/loads', auth, (req, res) => res.json({ ok: true })); // read — not audited
  app.use('/api/admin', require('../../routes/adminRoutes'));
  return app;
}

describe('audit trail', () => {
  let app, user, token;
  beforeEach(async () => {
    app = buildApp();
    user = await createTestUser({ role: 'carrier' });
    token = generateToken(user);
  });

  test('helpers infer entity + id from the path', () => {
    expect(inferEntity('/api/loads/abc/accept')).toBe('load');
    expect(inferEntity('/api/users/team')).toBe('user');
    expect(extractEntityId('/api/loads/5f9d88b9c1234567890abcde/accept')).toBe('5f9d88b9c1234567890abcde');
    expect(extractEntityId('/api/loads')).toBeNull();
  });

  test('records a successful mutating request with the actor + entity', async () => {
    const id = '5f9d88b9c1234567890abcde';
    await request(app).post(`/api/loads/${id}/thing`).set('Authorization', `Bearer ${token}`).send({ note: 'hi' });
    await settle();

    const log = await AuditLog.findOne({ path: `/api/loads/${id}/thing` });
    expect(log).toBeTruthy();
    expect(log.action).toBe('CREATE');
    expect(log.entity).toBe('load');
    expect(log.entityId).toBe(id);
    expect(String(log.userId)).toBe(String(user._id));
    expect(log.bodySummary).toContain('hi');
  });

  test('redacts the body on credential endpoints', async () => {
    await request(app).post('/api/users/login').send({ email: 'x@y.com', password: 'secret123' });
    await settle();
    const log = await AuditLog.findOne({ path: '/api/users/login' });
    expect(log).toBeTruthy();
    expect(log.bodySummary).toBe('[REDACTED]');
    expect(JSON.stringify(log)).not.toContain('secret123');
  });

  test('does not record failed (4xx) mutations or reads', async () => {
    await request(app).post('/api/widgets').set('Authorization', `Bearer ${token}`).send({ a: 1 });
    await request(app).get('/api/loads').set('Authorization', `Bearer ${token}`);
    await settle();
    expect(await AuditLog.countDocuments({ path: '/api/widgets' })).toBe(0);
    expect(await AuditLog.countDocuments({ method: 'GET' })).toBe(0);
  });

  test('admin can read the audit trail (filtered by entity)', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const adminToken = generateToken(admin);
    await request(app).post('/api/loads/5f9d88b9c1234567890abcde/thing').set('Authorization', `Bearer ${token}`).send({});
    await settle();

    const res = await request(app).get('/api/admin/audit-logs?entity=load').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.logs.length).toBeGreaterThanOrEqual(1);
    expect(res.body.logs.every((l) => l.entity === 'load')).toBe(true);
  });
});
