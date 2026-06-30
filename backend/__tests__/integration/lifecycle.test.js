/**
 * Integration: Full Load Lifecycle (real route handlers)
 *
 * Exercises the actual loadRoutes.js factory (with a mock io) against an
 * in-memory Mongo, driving requests through supertest. Covers:
 *   open → accepted → in-transit → delivered, invalid transition rejection,
 *   and double-accept prevention (409).
 */

require('../setup');
const express = require('express');
const request = require('supertest');

const auth = require('../../middlewares/authMiddleware');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');

// Mock Socket.IO — every emit is a no-op
const io = { to: () => ({ emit: () => {} }) };
const loadRoutes = require('../../routes/loadRoutes')(io);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loads', loadRoutes);
  return app;
}

// Create a carrier that satisfies the verification/eligibility gate:
//   verification.status='verified' + at least one truck in fleet.
async function createVerifiedCarrier(overrides = {}) {
  return createTestUser({
    role: 'carrier',
    verification: { status: 'verified', identityVerified: true },
    fleet: [{ truckId: 'TRUCK-1', status: 'Available' }],
    ...overrides,
  });
}

describe('Integration — Full Load Lifecycle', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  test('full happy path: open → accepted → in-transit → delivered', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await createVerifiedCarrier();
    const load = await createTestLoad(shipper._id);

    const carrierToken = generateToken(carrier);

    // 1. Accept
    const acceptRes = await request(app)
      .put(`/api/loads/${load._id}/accept`)
      .set('Authorization', `Bearer ${carrierToken}`)
      .send({});

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.load.status).toBe('accepted');
    expect(acceptRes.body.load.acceptedBy.toString()).toBe(carrier._id.toString());

    // 2. In-transit
    const transitRes = await request(app)
      .put(`/api/loads/${load._id}/status`)
      .set('Authorization', `Bearer ${carrierToken}`)
      .send({ status: 'in-transit' });

    expect(transitRes.status).toBe(200);
    expect(transitRes.body.load.status).toBe('in-transit');

    // 3. Delivered (via the state-machine-backed status route)
    const deliverRes = await request(app)
      .put(`/api/loads/${load._id}/status`)
      .set('Authorization', `Bearer ${carrierToken}`)
      .send({ status: 'delivered' });

    expect(deliverRes.status).toBe(200);
    expect(deliverRes.body.load.status).toBe('delivered');
  });

  test('delivered via /deliver route from in-transit', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await createVerifiedCarrier();
    const load = await createTestLoad(shipper._id, {
      status: 'in-transit',
      acceptedBy: carrier._id,
    });

    const res = await request(app)
      .put(`/api/loads/${load._id}/deliver`)
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.load.status).toBe('delivered');
  });

  test('rejects invalid transition: open → delivered', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await createVerifiedCarrier();
    // Accepted-status precondition is checked at the route. A fresh OPEN load
    // owned (accepted) by nobody cannot be jumped to delivered.
    const load = await createTestLoad(shipper._id, {
      status: 'open',
      acceptedBy: carrier._id, // set so the route's auth check passes
    });

    const res = await request(app)
      .put(`/api/loads/${load._id}/status`)
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({ status: 'delivered' });

    // State machine forbids open → delivered → 409
    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });

  test('prevents double-accept: exactly one of two carriers succeeds (other 409)', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier1 = await createVerifiedCarrier();
    const carrier2 = await createVerifiedCarrier();
    const load = await createTestLoad(shipper._id);

    const t1 = generateToken(carrier1);
    const t2 = generateToken(carrier2);

    const [r1, r2] = await Promise.all([
      request(app).put(`/api/loads/${load._id}/accept`).set('Authorization', `Bearer ${t1}`).send({}),
      request(app).put(`/api/loads/${load._id}/accept`).set('Authorization', `Bearer ${t2}`).send({}),
    ]);

    const statuses = [r1.status, r2.status].sort();
    // One 200 success, one 409 conflict
    expect(statuses).toEqual([200, 409]);

    const conflict = [r1, r2].find((r) => r.status === 409);
    expect(conflict.body.error).toMatch(/no longer available|already accepted/i);
  });

  test('unverified carrier cannot accept (eligibility/anti-fraud gate, 403)', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    // Default carrier from helper is unverified with no fleet
    const carrier = await createTestUser({ role: 'carrier' });
    const load = await createTestLoad(shipper._id);

    const res = await request(app)
      .put(`/api/loads/${load._id}/accept`)
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.reasons || res.body.error).toBeDefined();
  });
});
