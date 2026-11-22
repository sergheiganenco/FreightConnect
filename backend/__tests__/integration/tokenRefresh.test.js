/**
 * Integration: refreshed session tokens keep their company role/scope, and the
 * PUT /me company-details lock is decided from the DB record.
 * (Own file: login is rate limited per file-process, and subAccounts.test.js uses most of it.)
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/users', require('../../routes/userRoutes'));
  app.use('/api/loads', require('../../routes/loadRoutes')({ to: () => ({ emit: () => {} }), emit: () => {} }));
  return app;
}

describe('token refresh & profile lock', () => {
  let app, owner, ownerToken;

  beforeEach(async () => {
    app = buildApp();
    owner = await createTestUser({ role: 'carrier', companyRole: 'owner', companyName: 'Acme Trucking' });
    ownerToken = generateToken(owner);
  });

  async function addDispatcher(overrides = {}) {
    return request(app).post('/api/users/team').set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Dan', email: `d-${Date.now()}@acme.com`, password: 'DispatchPass1', companyRole: 'dispatcher', ...overrides });
  }
  async function loginAfterPasswordChange(email, tempPassword) {
    const first = await request(app).post('/api/users/login').send({ email, password: tempPassword });
    const change = await request(app).post('/api/users/change-password')
      .set('Authorization', `Bearer ${first.body.token}`)
      .send({ currentPassword: tempPassword, newPassword: `${tempPassword}-New9` });
    expect(change.status).toBe(200);
    return first;
  }

  describe('refreshed tokens keep their meaning', () => {
    const claims = (t) => jwt.verify(t, process.env.JWT_SECRET);
    const refresh = (t) => request(app).post('/api/users/refresh-token').set('Authorization', `Bearer ${t}`);

    test('dispatcher and driver refresh keep companyRole/companyOwnerId; driver stays restricted', async () => {
      const ownerClaims = claims((await refresh(ownerToken)).body.token);
      expect(ownerClaims.companyRole).toBe('owner');
      expect(ownerClaims.companyOwnerId).toBe(String(owner._id));

      for (const role of ['dispatcher', 'driver']) {
        const email = `rf-${role}-${Date.now()}@acme.com`;
        await addDispatcher({ email, password: 'RefreshPass12', companyRole: role });
        const login = await loginAfterPasswordChange(email, 'RefreshPass12');
        const re = await refresh(login.body.token);
        expect(re.status).toBe(200);
        const before = claims(login.body.token);
        const after = claims(re.body.token);
        expect(after.companyRole).toBe(role);
        expect(after.companyRole).toBe(before.companyRole);
        expect(after.companyOwnerId).toBe(String(owner._id));
        expect(after.companyOwnerId).toBe(before.companyOwnerId);

        if (role === 'driver') {
          const t = re.body.token;
          const truck = await request(app).post('/api/users/fleet').set('Authorization', `Bearer ${t}`).send({ truckId: 'RF-1' });
          expect(truck.status).toBe(403);
          const me = await request(app).put('/api/users/me').set('Authorization', `Bearer ${t}`).send({ companyName: 'Hijacked Co' });
          expect(me.status).toBe(403);
          const shipper = await createTestUser({ role: 'shipper' });
          const load = await createTestLoad(shipper._id, { status: 'accepted', acceptedBy: owner._id });
          const mine = await request(app).get('/api/loads/my-loads').set('Authorization', `Bearer ${t}`);
          expect(mine.body.map((l) => String(l._id))).toContain(String(load._id));
        }
      }
    });

    test('PUT /me company lock uses the DB record, not token claims', async () => {
      const email = `lock-${Date.now()}@acme.com`;
      await addDispatcher({ email, password: 'LockPass12345', companyRole: 'dispatcher' });
      const sub = await User.findOne({ email });
      await User.updateOne({ _id: sub._id }, { $set: { mustChangePassword: false } });
      // Old-style token: no companyRole / companyOwnerId claims.
      const bare = jwt.sign({ userId: sub._id, role: 'carrier' }, process.env.JWT_SECRET, { expiresIn: '1d' });
      const res = await request(app).put('/api/users/me').set('Authorization', `Bearer ${bare}`).send({ companyName: 'Hijacked Co' });
      expect(res.status).toBe(403);
      expect((await User.findById(sub._id)).companyName).toBe('Acme Trucking');
    });
  });

});
