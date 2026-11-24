/**
 * Integration: Driver roster, compliance alerts, assignment + endorsement
 * eligibility (real route handlers — driverRoutes + loadRoutes).
 */

require('../setup');
const express = require('express');
const request = require('supertest');

const { createTestUser, generateToken, createTestLoad } = require('../helpers');

const io = { to: () => ({ emit: () => {} }) };
const loadRoutes = require('../../routes/loadRoutes')(io);
const driverRoutes = require('../../routes/driverRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loads', loadRoutes);
  app.use('/api/drivers', driverRoutes);
  return app;
}

async function createVerifiedCarrier(overrides = {}) {
  return createTestUser({
    role: 'carrier',
    verification: { status: 'verified', identityVerified: true },
    fleet: [{ truckId: 'TRUCK-1', status: 'Available' }],
    ...overrides,
  });
}

describe('Integration — Driver Roster', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  test('carrier creates a driver → driver returned with driverId', async () => {
    const carrier = await createVerifiedCarrier();

    const res = await request(app)
      .post('/api/drivers')
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({ name: 'Jane Hauler', endorsements: ['hazmat'] });

    expect(res.status).toBe(201);
    expect(res.body.driverId).toBeDefined();
    expect(res.body.name).toBe('Jane Hauler');
    expect(res.body.endorsements).toContain('hazmat');
  });

  test('GET /drivers lists the created driver', async () => {
    const carrier = await createVerifiedCarrier();
    const token = generateToken(carrier);

    await request(app)
      .post('/api/drivers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bob Driver' });

    const res = await request(app)
      .get('/api/drivers')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((d) => d.name === 'Bob Driver')).toBe(true);
  });

  test('compliance-alerts surfaces a license expiring within 30 days', async () => {
    const carrier = await createVerifiedCarrier();
    const token = generateToken(carrier);

    const in10Days = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    await request(app)
      .post('/api/drivers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Expiring Soon', licenseExpiry: in10Days.toISOString() });

    const res = await request(app)
      .get('/api/drivers/compliance-alerts')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const alert = res.body.find((a) => a.name === 'Expiring Soon');
    expect(alert).toBeDefined();
    expect(alert.field).toBe('licenseExpiry');
    expect(alert.daysRemaining).toBeLessThanOrEqual(30);
  });

  test('non-carrier cannot manage drivers (403)', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const token = generateToken(shipper);

    const getRes = await request(app)
      .get('/api/drivers')
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(403);

    const postRes = await request(app)
      .post('/api/drivers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Should Fail' });
    expect(postRes.status).toBe(403);
  });
});

describe('Integration — Driver Assignment', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  test('carrier assigns a driver to an accepted load', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await createVerifiedCarrier();
    const token = generateToken(carrier);

    const driverRes = await request(app)
      .post('/api/drivers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Assigned Driver' });
    const driverId = driverRes.body.driverId;

    const load = await createTestLoad(shipper._id, {
      status: 'accepted',
      acceptedBy: carrier._id,
    });

    const res = await request(app)
      .put(`/api/loads/${load._id}/assign-driver`)
      .set('Authorization', `Bearer ${token}`)
      .send({ driverId });

    expect(res.status).toBe(200);
    expect(res.body.load.assignedDriverId).toBe(driverId);
    expect(res.body.load.assignedDriverName).toBe('Assigned Driver');
  });
});

describe('Integration — Hazmat Eligibility', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  test('hazmat load cannot be accepted without a hazmat endorsement (403 + reasons)', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await createVerifiedCarrier(); // no carrierEndorsements
    const load = await createTestLoad(shipper._id, { hazardousMaterial: true });

    const res = await request(app)
      .put(`/api/loads/${load._id}/accept`)
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({});

    expect(res.status).toBe(403);
    expect(Array.isArray(res.body.reasons)).toBe(true);
    expect(res.body.reasons.join(' ')).toMatch(/hazmat/i);
  });

  test('hazmat load CAN be accepted with carrier-level hazmat endorsement', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await createVerifiedCarrier({ carrierEndorsements: ['hazmat'] });
    const load = await createTestLoad(shipper._id, { hazardousMaterial: true });

    const res = await request(app)
      .put(`/api/loads/${load._id}/accept`)
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.load.status).toBe('accepted');
  });
});

describe('linking a roster driver to a driver login', () => {
  const jwt = require('jsonwebtoken');
  const User = require('../../models/User');
  test('a manager links and unlinks; a login can back only one roster driver; another company\'s login is refused', async () => {
    const app = buildApp();
    const owner = await createTestUser({ role: 'carrier', drivers: [{ driverId: 'A', name: 'Ann' }, { driverId: 'B', name: 'Bob' }] });
    const login = await createTestUser({ role: 'carrier', name: 'Ann Smith', parentAccountId: owner._id, companyRole: 'driver', mustChangePassword: false });
    const outsider = await createTestUser({ role: 'carrier', companyRole: 'driver', parentAccountId: (await createTestUser({ role: 'carrier' }))._id });
    const tok = { Authorization: `Bearer ${generateToken(owner)}` };
    const put = (id, body) => request(app).put(`/api/drivers/${id}`).set(tok).send(body);

    let list = await request(app).get('/api/drivers/logins').set(tok);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].linkedDriverId).toBeNull();

    expect((await put('A', { loginUserId: String(login._id) })).status).toBe(200);
    list = await request(app).get('/api/drivers/logins').set(tok);
    expect(list.body.data[0].linkedDriverName).toBe('Ann');
    expect((await put('B', { loginUserId: String(login._id) })).status).toBe(409);
    expect((await put('B', { loginUserId: String(outsider._id) })).status).toBe(400);
    expect((await put('B', { loginUserId: 'nope' })).status).toBe(400);

    // A driver login cannot see or change the links.
    const dTok = { Authorization: `Bearer ${jwt.sign({ userId: String(login._id), role: 'carrier', companyRole: 'driver', companyOwnerId: String(owner._id) }, process.env.JWT_SECRET)}` };
    expect((await request(app).get('/api/drivers/logins').set(dTok)).status).toBe(403);

    expect((await put('A', { loginUserId: null })).status).toBe(200);
    expect((await User.findById(owner._id)).drivers.find((d) => d.driverId === 'A').loginUserId).toBeNull();
  });
});
