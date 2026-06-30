/**
 * Integration: Accessorial settlement loop + reconsignment (real route handlers)
 *
 * Carrier requests an accessorial charge → shipper approves/rejects. Settlement
 * via Stripe is non-blocking, so the charge is still recorded/approved even
 * when payment settlement is skipped. Also covers shipper reconsignment.
 */

require('../setup');
const express = require('express');
const request = require('supertest');

const { createTestUser, generateToken, createTestLoad } = require('../helpers');

const io = { to: () => ({ emit: () => {} }) };
const loadRoutes = require('../../routes/loadRoutes')(io);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loads', loadRoutes);
  return app;
}

// Helper: an accepted load with carrier + shipper wired up.
async function setupAcceptedLoad(extra = {}) {
  const shipper = await createTestUser({ role: 'shipper' });
  const carrier = await createTestUser({
    role: 'carrier',
    verification: { status: 'verified', identityVerified: true },
    fleet: [{ truckId: 'TRUCK-1', status: 'Available' }],
  });
  const load = await createTestLoad(shipper._id, {
    status: 'accepted',
    acceptedBy: carrier._id,
    ...extra,
  });
  return { shipper, carrier, load };
}

describe('Integration — Accessorial Settlement Loop', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  test('carrier requests an accessorial → charge recorded as pending', async () => {
    const { carrier, load } = await setupAcceptedLoad();

    const res = await request(app)
      .post(`/api/loads/${load._id}/accessorials`)
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({ type: 'lumper', amountCents: 15000, description: '2h lumper' });

    expect(res.status).toBe(201);
    expect(res.body.charge).toBeDefined();
    expect(res.body.charge.status).toBe('pending');
    expect(res.body.charge.amountCents).toBe(15000);
    expect(res.body.charge.type).toBe('lumper');
    expect(res.body.charge._id).toBeDefined();
  });

  test('shipper approves the charge → status approved', async () => {
    const { carrier, shipper, load } = await setupAcceptedLoad();

    const created = await request(app)
      .post(`/api/loads/${load._id}/accessorials`)
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({ type: 'lumper', amountCents: 8000 });
    const chargeId = created.body.charge._id;

    const res = await request(app)
      .put(`/api/loads/${load._id}/accessorials/${chargeId}/approve`)
      .set('Authorization', `Bearer ${generateToken(shipper)}`)
      .send({});

    expect(res.status).toBe(200);
    // Settlement may not flip to 'paid' (Stripe skipped) — accept approved or paid
    expect(['approved', 'paid']).toContain(res.body.charge.status);
    expect(res.body.charge.approvedBy.toString()).toBe(shipper._id.toString());
  });

  test('shipper can reject a charge', async () => {
    const { carrier, shipper, load } = await setupAcceptedLoad();

    const created = await request(app)
      .post(`/api/loads/${load._id}/accessorials`)
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({ type: 'layover', amountCents: 20000 });
    const chargeId = created.body.charge._id;

    const res = await request(app)
      .put(`/api/loads/${load._id}/accessorials/${chargeId}/reject`)
      .set('Authorization', `Bearer ${generateToken(shipper)}`)
      .send({ reason: 'No supporting docs' });

    expect(res.status).toBe(200);
    expect(res.body.charge.status).toBe('rejected');
  });

  // ── Negatives ──────────────────────────────────────────────────────────────

  test('carrier cannot approve their own charge (403)', async () => {
    const { carrier, load } = await setupAcceptedLoad();

    const created = await request(app)
      .post(`/api/loads/${load._id}/accessorials`)
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({ type: 'lumper', amountCents: 15000 });
    const chargeId = created.body.charge._id;

    const res = await request(app)
      .put(`/api/loads/${load._id}/accessorials/${chargeId}/approve`)
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({});

    expect(res.status).toBe(403);
  });

  test('non-party cannot request an accessorial (403)', async () => {
    const { load } = await setupAcceptedLoad();
    const stranger = await createTestUser({
      role: 'carrier',
      verification: { status: 'verified' },
      fleet: [{ truckId: 'OTHER-1' }],
    });

    const res = await request(app)
      .post(`/api/loads/${load._id}/accessorials`)
      .set('Authorization', `Bearer ${generateToken(stranger)}`)
      .send({ type: 'lumper', amountCents: 15000 });

    expect(res.status).toBe(403);
  });

  test('amountCents must be a positive integer (rejects 0, negative, float)', async () => {
    const { carrier, load } = await setupAcceptedLoad();
    const token = generateToken(carrier);

    for (const bad of [0, -100, 150.5]) {
      const res = await request(app)
        .post(`/api/loads/${load._id}/accessorials`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'lumper', amountCents: bad });
      expect(res.status).toBe(400);
    }
  });

  test('rejects an unknown accessorial type (400)', async () => {
    const { carrier, load } = await setupAcceptedLoad();

    const res = await request(app)
      .post(`/api/loads/${load._id}/accessorials`)
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({ type: 'bogus', amountCents: 1000 });

    expect(res.status).toBe(400);
  });
});

describe('Integration — Reconsignment', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  test('shipper reconsigns an accepted load → destination updated + flag set', async () => {
    const { shipper, load } = await setupAcceptedLoad();

    const res = await request(app)
      .put(`/api/loads/${load._id}/reconsign`)
      .set('Authorization', `Bearer ${generateToken(shipper)}`)
      .send({ newDestination: 'Houston, TX', reason: 'Customer moved', feeCents: 12000 });

    expect(res.status).toBe(200);
    expect(res.body.load.destination).toBe('Houston, TX');
    expect(res.body.load.reconsignment.changed).toBe(true);
    expect(res.body.load.reconsignment.originalDestination).toBe('Dallas, TX');
    expect(res.body.load.reconsignment.feeChargedCents).toBe(12000);
    // Fee is recorded as an auto-approved accessorial charge
    const recon = res.body.load.accessorialCharges.find((c) => c.type === 'reconsignment');
    expect(recon).toBeDefined();
    expect(recon.status).toBe('approved');
  });

  test('reconsign works on in-transit loads too', async () => {
    const { shipper, load } = await setupAcceptedLoad({ status: 'in-transit' });

    const res = await request(app)
      .put(`/api/loads/${load._id}/reconsign`)
      .set('Authorization', `Bearer ${generateToken(shipper)}`)
      .send({ newDestination: 'Austin, TX' });

    expect(res.status).toBe(200);
    expect(res.body.load.destination).toBe('Austin, TX');
  });

  test('carrier cannot reconsign (403)', async () => {
    const { carrier, load } = await setupAcceptedLoad();

    const res = await request(app)
      .put(`/api/loads/${load._id}/reconsign`)
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({ newDestination: 'Houston, TX' });

    expect(res.status).toBe(403);
  });

  test('cannot reconsign a delivered load (409)', async () => {
    const { shipper, load } = await setupAcceptedLoad({ status: 'delivered' });

    const res = await request(app)
      .put(`/api/loads/${load._id}/reconsign`)
      .set('Authorization', `Bearer ${generateToken(shipper)}`)
      .send({ newDestination: 'Houston, TX' });

    expect(res.status).toBe(409);
  });
});
