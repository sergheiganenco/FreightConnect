/**
 * Dispute lifecycle E2E (real handlers):
 *   post -> accept -> in-transit -> shipper files dispute (load 'disputed',
 *   Exception created) -> admin resolves 'split' 60% (load 'resolved',
 *   payout% recorded). No Stripe needed — this covers the decision workflow.
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const { createTestUser, generateToken } = require('../helpers');
const Load = require('../../models/Load');
const Exception = require('../../models/Exception');

const io = { to: () => ({ emit: () => {} }) };
const loadRoutes = require('../../routes/loadRoutes')(io);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loads', loadRoutes);
  return app;
}

function expectStatus(res, code) {
  if (res.status !== code) throw new Error(`Expected ${code}, got ${res.status}: ${JSON.stringify(res.body)}`);
}

const yearFromNow = new Date(Date.now() + 365 * 86400000);

async function verifiedShipper() {
  return createTestUser({ role: 'shipper', shipperVerification: { status: 'verified', paymentMethodVerified: true } });
}
async function verifiedCarrier() {
  return createTestUser({
    role: 'carrier',
    fleet: [{ truckId: 'TRK-1', status: 'Available', available: true }],
    verification: {
      status: 'verified', identityVerified: true,
      fmcsaData: { operatingStatus: 'AUTHORIZED FOR PROPERTY', lastChecked: new Date() },
      insurance: {
        cargoLiability: { amount: 100000, policyNumber: 'C1', expiry: yearFromNow, underwriter: 'X' },
        autoLiability: { amount: 1000000, policyNumber: 'A1', expiry: yearFromNow, underwriter: 'X' },
        status: 'valid', lastChecked: new Date(),
      },
    },
  });
}

describe('Dispute lifecycle', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  async function loadInTransit() {
    const shipper = await verifiedShipper();
    const carrier = await verifiedCarrier();
    const admin = await createTestUser({ role: 'admin' });
    const sTok = generateToken(shipper), cTok = generateToken(carrier);

    const create = await request(app).post('/api/loads').set('Authorization', `Bearer ${sTok}`).send({
      title: 'Dispute Load', origin: 'Memphis, TN', destination: 'Nashville, TN', rate: 850, equipmentType: 'Dry Van',
    });
    expectStatus(create, 201);
    const loadId = create.body._id || (create.body.load && create.body.load._id);

    expectStatus(await request(app).put(`/api/loads/${loadId}/accept`).set('Authorization', `Bearer ${cTok}`).send({}), 200);
    expectStatus(await request(app).put(`/api/loads/${loadId}/status`).set('Authorization', `Bearer ${cTok}`).send({ status: 'in-transit' }), 200);
    return { shipper, carrier, admin, loadId };
  }

  test('shipper files a dispute → load disputed + Exception created', async () => {
    const { shipper, loadId } = await loadInTransit();

    const res = await request(app)
      .put(`/api/loads/${loadId}/dispute`)
      .set('Authorization', `Bearer ${generateToken(shipper)}`)
      .send({ reason: 'Short delivery — 2 pallets missing', type: 'short_delivery', claimAmountCents: 40000 });
    expectStatus(res, 200);
    expect(res.body.loadStatus).toBe('disputed');
    expect(res.body.exceptionId).toBeTruthy(); // client uses this to attach evidence files

    const load = await Load.findById(loadId);
    expect(load.status).toBe('disputed');
    expect(load.disputeType).toBe('short_delivery');

    const ex = await Exception.findOne({ loadId });
    expect(ex).toBeTruthy();
    expect(ex.status).toBe('open');
  });

  test('admin resolves split 60% → load resolved with payout% recorded', async () => {
    const { shipper, admin, loadId } = await loadInTransit();
    await request(app).put(`/api/loads/${loadId}/dispute`).set('Authorization', `Bearer ${generateToken(shipper)}`)
      .send({ reason: 'damage', type: 'cargo_damage', claimAmountCents: 30000 });

    const res = await request(app)
      .put(`/api/loads/${loadId}/resolve`)
      .set('Authorization', `Bearer ${generateToken(admin)}`)
      .send({ resolution: 'split', carrierPayoutPercent: 60, notes: '50/50-ish, carrier 60%' });
    expectStatus(res, 200);
    expect(res.body.resolution).toBe('split');
    expect(res.body.carrierPayoutPercent).toBe(60);

    const load = await Load.findById(loadId);
    expect(load.status).toBe('resolved');
    expect(load.disputeCarrierPayoutPercent).toBe(60);
  });

  test('a non-party cannot file a dispute (403)', async () => {
    const { loadId } = await loadInTransit();
    const stranger = await createTestUser({ role: 'shipper' });
    const res = await request(app).put(`/api/loads/${loadId}/dispute`).set('Authorization', `Bearer ${generateToken(stranger)}`)
      .send({ reason: 'x' });
    expect(res.status).toBe(403);
  });
});
