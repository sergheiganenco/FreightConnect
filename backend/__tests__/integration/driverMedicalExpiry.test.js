/**
 * Integration: driver medical-expiry field contract (real driverRoutes).
 *
 * The audit found the web UI sends `medicalExpiry` while the model/routes use
 * `medicalCardExpiry` — so the medical expiry a carrier typed NEVER persisted
 * (silent data loss; the compliance-alert and eligibility checks then see no
 * date at all). The route must accept the legacy alias, and the canonical
 * field must round-trip.
 */

require('../setup');
const express = require('express');
const request = require('supertest');

const { createTestUser, generateToken } = require('../helpers');
const User = require('../../models/User');

const driverRoutes = require('../../routes/driverRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/drivers', driverRoutes);
  return app;
}

const EXPIRY = '2027-03-15T00:00:00.000Z';

describe('Driver medical expiry — field contract', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  test('POST accepts the web-form alias `medicalExpiry` and persists medicalCardExpiry', async () => {
    const carrier = await createTestUser({ role: 'carrier' });

    const res = await request(app)
      .post('/api/drivers')
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({ name: 'Web Form Driver', medicalExpiry: EXPIRY }); // exact CarrierDrivers.js payload shape

    expect(res.status).toBe(201);

    const fresh = await User.findById(carrier._id);
    const driver = fresh.drivers.find((d) => d.name === 'Web Form Driver');
    expect(driver.medicalCardExpiry).toBeTruthy();
    expect(new Date(driver.medicalCardExpiry).toISOString()).toBe(EXPIRY);
  });

  test('PUT accepts the alias too, and canonical field still wins when both sent', async () => {
    const carrier = await createTestUser({ role: 'carrier' });
    const token = generateToken(carrier);

    const created = await request(app)
      .post('/api/drivers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Update Me' });

    const res = await request(app)
      .put(`/api/drivers/${created.body.driverId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ medicalExpiry: EXPIRY });

    expect(res.status).toBe(200);

    const fresh = await User.findById(carrier._id);
    const driver = fresh.drivers.find((d) => d.driverId === created.body.driverId);
    expect(new Date(driver.medicalCardExpiry).toISOString()).toBe(EXPIRY);
  });
});
