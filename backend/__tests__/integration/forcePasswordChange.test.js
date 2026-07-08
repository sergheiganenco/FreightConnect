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
});
