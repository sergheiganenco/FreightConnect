/**
 * Integration: truck assign-load booking gate (real userRoutes).
 *
 * PUT /api/users/fleet/:truckId/assign-load BOOKS the load (sets acceptedBy),
 * so it must pass the shared booking gate like every other booking path.
 */

require('../setup');
const express = require('express');
const request = require('supertest');

const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const Load = require('../../models/Load');

const userRoutes = require('../../routes/userRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/users', userRoutes);
  return app;
}

describe('assign-load booking gate', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  test('blocks an UNVERIFIED carrier from booking via truck assignment (403)', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await createTestUser({
      role: 'carrier',
      fleet: [{ truckId: 'TRUCK-9', status: 'Available', available: true }],
    });
    const load = await createTestLoad(shipper._id);

    const res = await request(app)
      .put('/api/users/fleet/TRUCK-9/assign-load')
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({ loadId: load._id.toString() });

    expect(res.status).toBe(403);
    const fresh = await Load.findById(load._id);
    expect(fresh.status).toBe('open');
    expect(fresh.acceptedBy).toBeNull();
  });

  test('books a verified carrier via truck assignment (200) with truck attached', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await createTestUser({
      role: 'carrier',
      verification: { status: 'verified', identityVerified: true, insurance: { status: 'valid' } },
      fleet: [{ truckId: 'TRUCK-10', status: 'Available', available: true }],
    });
    const load = await createTestLoad(shipper._id);

    const res = await request(app)
      .put('/api/users/fleet/TRUCK-10/assign-load')
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({ loadId: load._id.toString() });

    expect(res.status).toBe(200);
    const fresh = await Load.findById(load._id);
    expect(fresh.status).toBe('accepted');
    expect(String(fresh.acceptedBy)).toBe(String(carrier._id));
    expect(fresh.assignedTruckId).toBe('TRUCK-10');
  });
});
