/**
 * Integration: PUT /users/me validation + email-change re-auth + sub-account
 * company lock, and team members being forced to change the owner-set password.
 */

require('../setup');
const express = require('express');
const request = require('supertest');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const { createTestUser, generateToken } = require('../helpers');

const app = express();
app.use(express.json());
app.use('/api/users', require('../../routes/userRoutes'));

const put = (token, body) =>
  request(app).put('/api/users/me').set('Authorization', `Bearer ${token}`).send(body);

describe('PUT /api/users/me', () => {
  let user, token;
  beforeEach(async () => {
    user = await createTestUser({
      role: 'carrier', companyName: 'Acme Trucking',
      email: `me-${Date.now()}@acme.com`, password: await bcrypt.hash('RightPass1!', 10),
    });
    token = generateToken(user);
  });

  test('invalid email -> 400', async () => {
    expect((await put(token, { email: 'not-an-email' })).status).toBe(400);
  });

  test('object-valued field -> 400', async () => {
    expect((await put(token, { phone: { $ne: null } })).status).toBe(400);
    expect((await put(token, { name: ['a'] })).status).toBe(400);
  });

  test('email change needs the correct current password', async () => {
    const email = `new-${Date.now()}@acme.com`;
    const missing = await put(token, { email });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/required/);
    const wrong = await put(token, { email, currentPassword: 'WrongPass1!' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe('Current password is incorrect');
    const ok = await put(token, { email, currentPassword: 'RightPass1!' });
    expect(ok.status).toBe(200);
    expect(ok.body.email).toBe(email);
    expect(ok.body.password).toBeUndefined();
  });

  test('duplicate email -> 409', async () => {
    const other = await createTestUser({ role: 'shipper', email: `dup-${Date.now()}@acme.com` });
    const res = await put(token, { email: other.email, currentPassword: 'RightPass1!' });
    expect(res.status).toBe(409);
  });

  test('unchanged email without password -> 200, no secrets in response', async () => {
    const res = await put(token, { email: user.email, name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed');
    expect(res.body.password).toBeUndefined();
    expect(res.body.mfa && res.body.mfa.secret).toBeUndefined();
  });

  test('driver sub-account cannot change company name (403) but may resend it unchanged', async () => {
    const driver = await createTestUser({
      role: 'carrier', companyRole: 'driver', companyName: 'Acme Trucking',
      email: `drv-${Date.now()}@acme.com`,
    });
    const dToken = jwt.sign({ userId: driver._id, role: 'carrier', companyRole: 'driver' }, process.env.JWT_SECRET);
    expect((await put(dToken, { companyName: 'Other Co' })).status).toBe(403);
    expect((await put(dToken, { companyName: 'Acme Trucking', mcNumber: '' })).status).toBe(200);
  });
});

describe('POST /api/users/team', () => {
  test('new team member must change the owner-chosen password', async () => {
    const owner = await createTestUser({ role: 'carrier', companyRole: 'owner', companyName: 'Acme Trucking' });
    const email = `tm-${Date.now()}@acme.com`;
    const res = await request(app).post('/api/users/team')
      .set('Authorization', `Bearer ${generateToken(owner)}`)
      .send({ name: 'Tina', email, password: 'TempPass123', companyRole: 'dispatcher' });
    expect(res.status).toBe(201);
    expect((await User.findById(res.body.member._id)).mustChangePassword).toBe(true);

    const login = await request(app).post('/api/users/login').send({ email, password: 'TempPass123' });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
  });
});
