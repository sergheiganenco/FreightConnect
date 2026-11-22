/**
 * Integration: forced password change for admin-created accounts.
 *
 * An admin creates a user with a temporary password. That account is flagged
 * mustChangePassword; login surfaces the flag; the change-password endpoint
 * verifies the current password, sets the new one, and clears the flag.
 */

require('../setup');
const express = require('express');
const request = require('supertest');
const { createTestUser, generateToken } = require('../helpers');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/users', require('../../routes/userRoutes'));
  app.use('/api/loads', require('../../routes/loadRoutes')({ to: () => ({ emit: () => {} }), emit: () => {} }));
  app.use('/api/admin', require('../../routes/adminRoutes'));
  return app;
}

describe('forced password change (admin-created accounts)', () => {
  const app = buildApp();

  test('admin-created user must change password on first login, then flag clears', async () => {
    const admin = await createTestUser({ role: 'admin', email: `admin-${Date.now()}@fc.com` });
    const adminToken = generateToken(admin);

    const email = `newhire-${Date.now()}@acme.com`;
    // 1) Admin creates the account with a temporary password.
    const created = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'New Hire', email, password: 'TempPass123', role: 'carrier', companyName: 'Acme Freight' });
    expect(created.status).toBe(201);
    expect(created.body.mustChangePassword).toBe(true);

    // 2) First login surfaces the flag.
    const login1 = await request(app).post('/api/users/login').send({ email, password: 'TempPass123' });
    expect(login1.status).toBe(200);
    expect(login1.body.user.mustChangePassword).toBe(true);
    const token = login1.body.token;

    // 3) Wrong current password is rejected.
    const bad = await request(app)
      .post('/api/users/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'WrongPass1', newPassword: 'BrandNewPass9' });
    expect(bad.status).toBe(400);

    // 4) Same-as-current is rejected.
    const same = await request(app)
      .post('/api/users/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'TempPass123', newPassword: 'TempPass123' });
    expect(same.status).toBe(400);

    // 5) Valid change succeeds.
    const ok = await request(app)
      .post('/api/users/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'TempPass123', newPassword: 'BrandNewPass9' });
    expect(ok.status).toBe(200);

    // 6) Old password no longer works; new one does and the flag is cleared.
    const oldLogin = await request(app).post('/api/users/login').send({ email, password: 'TempPass123' });
    expect(oldLogin.status).toBe(401);

    const login2 = await request(app).post('/api/users/login').send({ email, password: 'BrandNewPass9' });
    expect(login2.status).toBe(200);
    expect(login2.body.user.mustChangePassword).toBe(false);
  });

  test('a normally-created user is not forced to change password', async () => {
    const user = await createTestUser({ email: `self-${Date.now()}@acme.com`, password: require('bcrypt').hashSync('SelfSignup123', 10) });
    const login = await request(app).post('/api/users/login').send({ email: user.email, password: 'SelfSignup123' });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(false);
  });

  test('server blocks a flagged account on ordinary endpoints until the password is changed', async () => {
    const email = `flag-${Date.now()}@acme.com`;
    const owner = await createTestUser({ role: 'carrier', companyRole: 'owner' });
    const created = await request(app).post('/api/users/team')
      .set('Authorization', `Bearer ${generateToken(owner)}`)
      .send({ name: 'Flagged', email, password: 'TempPass123', companyRole: 'dispatcher' });
    expect(created.status).toBe(201);

    const login = await request(app).post('/api/users/login').send({ email, password: 'TempPass123' });
    const token = login.body.token;
    const auth = (r) => r.set('Authorization', `Bearer ${token}`);

    // Ordinary read + write are blocked with the machine-readable code.
    const blocked = await auth(request(app).get('/api/loads/my-loads'));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('password_change_required');
    const blockedWrite = await auth(request(app).put('/api/users/me')).send({ name: 'Hacker' });
    expect(blockedWrite.status).toBe(403);
    expect(blockedWrite.body.code).toBe('password_change_required');

    // Identity read stays available so the client can show the change form.
    expect((await auth(request(app).get('/api/users/me'))).status).toBe(200);

    // Changing the password lifts the block on the SAME token immediately (cache invalidated).
    const change = await auth(request(app).post('/api/users/change-password'))
      .send({ currentPassword: 'TempPass123', newPassword: 'BrandNewPass9' });
    expect(change.status).toBe(200);
    const after = await auth(request(app).get('/api/loads/my-loads'));
    expect(after.status).toBe(200);
  });
});

// Production mounting order (app.js): tosGuard globally before route auth, then routes.
describe('new team member: ToS + temp password (no deadlock)', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/', require('../../middlewares/tosGuard'));
  app.use('/api/users', require('../../routes/userRoutes'));
  app.use('/api/loads', require('../../routes/loadRoutes')({ to: () => ({ emit: () => {} }), emit: () => {} }));
  app.use('/api/tos', require('../../routes/tosRoutes'));

  test('login -> change-password -> ToS required -> accept ToS -> normal endpoint works', async () => {
    const owner = await createTestUser({ role: 'carrier', companyRole: 'owner', tosAccepted: true, tosVersion: '1.0' });
    const email = `tos-hire-${Date.now()}@acme.com`;
    const created = await request(app).post('/api/users/team')
      .set('Authorization', `Bearer ${generateToken(owner)}`)
      .send({ name: 'Tos Hire', email, password: 'TempPass123', companyRole: 'dispatcher' });
    expect(created.status).toBe(201);

    const login = await request(app).post('/api/users/login').send({ email, password: 'TempPass123' });
    expect(login.status).toBe(200);
    const auth = (r) => r.set('Authorization', `Bearer ${login.body.token}`);
    const pw = { currentPassword: 'TempPass123', newPassword: 'BrandNewPass9' };

    // ToS not yet accepted, but ordinary routes are blocked by the temp password first.
    const early = await auth(request(app).get('/api/loads/my-loads'));
    expect(early.status).toBe(403);

    // Changing the password is exempt from the ToS gate, so there is no deadlock
    // and the user is not bounced out of the form.
    expect((await auth(request(app).post('/api/users/change-password')).send(pw)).status).toBe(200);

    // ToS is still enforced afterwards...
    const gated = await auth(request(app).get('/api/loads/my-loads'));
    expect(gated.status).toBe(403);
    expect(gated.body.tosRequired).toBe(true);

    // ...and accepting it opens the app.
    expect((await auth(request(app).post('/api/tos/accept'))).status).toBe(200);
    expect((await auth(request(app).get('/api/loads/my-loads'))).status).toBe(200);
  });
});
