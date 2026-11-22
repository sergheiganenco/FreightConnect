/**
 * Integration: account deactivation must end access everywhere.
 *  - API keys obey the same account-status rule as JWTs (deactivated / owner
 *    deactivated / temporary password).
 *  - Deactivating an owner revokes its sub-accounts' very next HTTP request (no 60s
 *    cache wait) and disconnects live sockets of the user + each sub-account.
 *
 * NOT covered (app.js is not a testable module): the `io.use` handshake check and
 * the per-event `socket.use` re-check in the connection handler.
 */

require('../setup');
const express = require('express');
const request = require('supertest');

const ApiKey = require('../../models/ApiKey');
const User = require('../../models/User');
const auth = require('../../middlewares/authMiddleware');
const { apiKeyAuth } = require('../../middlewares/apiKeyAuth');
const { setIO } = require('../../utils/socket');
const { createTestUser, generateToken } = require('../helpers');

async function keyFor(user) {
  const raw = ApiKey.generateKey();
  await ApiKey.create({ userId: user._id, name: 't', key: ApiKey.hashKey(raw), prefix: raw.slice(0, 12), permissions: ['loads:read'] });
  return raw;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(apiKeyAuth);
  app.get('/api/whoami', (req, res) => res.json({ user: req.user || null }));
  app.get('/api/protected', auth, (req, res) => res.json({ ok: true }));
  app.use('/api/admin', require('../../routes/adminRoutes'));
  return app;
}

describe('API-key account status', () => {
  const app = buildApp();

  test('active account: key works', async () => {
    const u = await createTestUser({ role: 'carrier' });
    const res = await request(app).get('/api/whoami').set('X-Api-Key', await keyFor(u));
    expect(res.status).toBe(200);
    expect(res.body.user.userId).toBe(String(u._id));
  });

  test('deactivated account: key rejected with account_deactivated', async () => {
    const u = await createTestUser({ role: 'carrier', active: false });
    const res = await request(app).get('/api/whoami').set('X-Api-Key', await keyFor(u));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('account_deactivated');
  });

  test('sub-account of a deactivated owner: key rejected', async () => {
    const owner = await createTestUser({ role: 'carrier', active: false });
    const sub = await createTestUser({ role: 'carrier', parentAccountId: owner._id, companyRole: 'dispatcher' });
    const res = await request(app).get('/api/whoami').set('X-Api-Key', await keyFor(sub));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('account_deactivated');
  });

  test('temporary-password account: key rejected with password_change_required', async () => {
    const u = await createTestUser({ role: 'carrier', mustChangePassword: true });
    const res = await request(app).get('/api/whoami').set('X-Api-Key', await keyFor(u));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('password_change_required');
  });

  test('fails CLOSED on a DB error while resolving the account', async () => {
    const u = await createTestUser({ role: 'carrier' });
    const raw = await keyFor(u);
    const spy = jest.spyOn(User, 'findById').mockImplementationOnce(() => { throw new Error('db down'); });
    const res = await request(app).get('/api/whoami').set('X-Api-Key', raw);
    spy.mockRestore();
    expect(res.status).toBe(500);
  });
});

describe('revokeSessions / admin deactivation', () => {
  const app = buildApp();
  afterEach(() => setIO(undefined));

  test('revokeSessions busts cache + disconnects sockets for owner and every sub-account (injected io)', async () => {
    const owner = await createTestUser({ role: 'carrier' });
    const subA = await createTestUser({ role: 'carrier', parentAccountId: owner._id });
    const subB = await createTestUser({ role: 'carrier', parentAccountId: owner._id });
    const other = await createTestUser({ role: 'carrier' });
    const disconnectSockets = jest.fn();
    const io = { in: jest.fn(() => ({ disconnectSockets })) };

    await auth.revokeSessions(owner._id, { disconnect: true, io });

    const rooms = io.in.mock.calls.map((c) => c[0]).sort();
    expect(rooms).toEqual([owner, subA, subB].map((u) => `user_${u._id}`).sort());
    expect(rooms).not.toContain(`user_${other._id}`);
    expect(disconnectSockets).toHaveBeenCalledTimes(3);
    expect(disconnectSockets).toHaveBeenCalledWith(true);

    // disconnect:false (re-activation) must not drop sockets
    io.in.mockClear();
    await auth.revokeSessions(owner._id, { disconnect: false, io });
    expect(io.in).not.toHaveBeenCalled();
  });

  test('admin deactivates an owner: sub-account\'s very next request is 401, sockets dropped', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const owner = await createTestUser({ role: 'carrier' });
    const sub = await createTestUser({ role: 'carrier', parentAccountId: owner._id, companyRole: 'driver' });
    const subToken = generateToken(sub);
    const disconnectSockets = jest.fn();
    const io = { in: jest.fn(() => ({ disconnectSockets })) };
    setIO(io);

    // Warm the 60s cache with "active".
    expect((await request(app).get('/api/protected').set('Authorization', `Bearer ${subToken}`)).status).toBe(200);

    const res = await request(app)
      .patch(`/api/admin/users/${owner._id}/toggle-status`)
      .set('Authorization', `Bearer ${generateToken(admin)}`);
    expect(res.status).toBe(200);

    const after = await request(app).get('/api/protected').set('Authorization', `Bearer ${subToken}`);
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('account_deactivated');
    expect(io.in).toHaveBeenCalledWith(`user_${owner._id}`);
    expect(io.in).toHaveBeenCalledWith(`user_${sub._id}`);
  });
});
