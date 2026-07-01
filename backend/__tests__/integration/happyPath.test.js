/**
 * End-to-end transactional happy path (real route handlers):
 *   shipper posts a load -> carrier accepts -> in-transit -> 4h dwell at
 *   delivery -> detention auto-proposed -> shipper approves (frozen hash) ->
 *   settled (Path A accrual, no Stripe) with an audit record + ledger entry.
 *
 * The only shortcut is the dwell duration: a real detention needs >2h on site,
 * so the DwellEvent is created with a backdated arrivedAt to simulate elapsed
 * time. Everything else goes through the actual API + services.
 */

require('../setup');
const express = require('express');
const request = require('supertest');
const { createTestUser, generateToken } = require('../helpers');
const Load = require('../../models/Load');
const DwellEvent = require('../../models/DwellEvent');
const LedgerEntry = require('../../models/LedgerEntry');
const { recalculateDwellEvent } = require('../../services/detentionService');

const io = { to: () => ({ emit: () => {} }) };
const loadRoutes = require('../../routes/loadRoutes')(io);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loads', loadRoutes);
  return app;
}

function expectStatus(res, code) {
  if (res.status !== code) {
    throw new Error(`Expected ${code}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
}

const yearFromNow = new Date(Date.now() + 365 * 86400000);

async function verifiedShipper() {
  return createTestUser({
    role: 'shipper',
    shipperVerification: { status: 'verified', paymentMethodVerified: true, verifiedAt: new Date() },
  });
}

async function verifiedCarrier() {
  return createTestUser({
    role: 'carrier',
    fleet: [{ truckId: 'TRK-1', status: 'Available', available: true }],
    tracking: { gpsConsent: { granted: true, grantedAt: new Date() } },
    verification: {
      status: 'verified',
      identityVerified: true,
      verifiedAt: new Date(),
      fmcsaData: { operatingStatus: 'AUTHORIZED FOR PROPERTY', lastChecked: new Date() },
      insurance: {
        cargoLiability: { amount: 100000, policyNumber: 'C1', expiry: yearFromNow, underwriter: 'X' },
        autoLiability:  { amount: 1000000, policyNumber: 'A1', expiry: yearFromNow, underwriter: 'X' },
        status: 'valid', lastChecked: new Date(),
      },
    },
  });
}

describe('E2E happy path — post → accept → in-transit → detention → approve → settle', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('full transactional lifecycle settles a detention charge', async () => {
    const shipper = await verifiedShipper();
    const carrier = await verifiedCarrier();
    const sTok = generateToken(shipper);
    const cTok = generateToken(carrier);

    // 1) Shipper posts a load
    const create = await request(app)
      .post('/api/loads')
      .set('Authorization', `Bearer ${sTok}`)
      .send({
        title: 'E2E Memphis → Nashville',
        origin: 'Memphis, TN', destination: 'Nashville, TN',
        rate: 850, equipmentType: 'Dry Van',
        originLat: 35.1495, originLng: -90.0490,
        destinationLat: 36.1627, destinationLng: -86.7816,
      });
    expectStatus(create, 201);
    const loadId = create.body._id || (create.body.load && create.body.load._id) || (create.body.data && create.body.data._id);
    expect(loadId).toBeTruthy();

    // 2) Carrier accepts
    const accept = await request(app)
      .put(`/api/loads/${loadId}/accept`)
      .set('Authorization', `Bearer ${cTok}`)
      .send({});
    expectStatus(accept, 200);

    let load = await Load.findById(loadId);
    expect(load.status).toBe('accepted');
    expect(String(load.acceptedBy)).toBe(String(carrier._id));

    // 3) Carrier starts the trip → in-transit
    const transit = await request(app)
      .put(`/api/loads/${loadId}/status`)
      .set('Authorization', `Bearer ${cTok}`)
      .send({ status: 'in-transit' });
    expectStatus(transit, 200);

    // 4) Simulate a 4-hour dwell at the delivery facility → detention proposed
    const arrivedAt = new Date(Date.now() - 4 * 3600 * 1000);
    const dwell = await DwellEvent.create({
      load: loadId, carrier: carrier._id, shipper: shipper._id,
      stopType: 'delivery', facilityName: 'Nashville DC',
      arrivedAt,
      dockInAt: new Date(arrivedAt.getTime() + 30 * 60000),
      dockOutAt: new Date(Date.now() - 10 * 60000),
      departedAt: new Date(),
    });
    await recalculateDwellEvent(dwell._id);

    load = await Load.findById(loadId);
    const detention = load.accessorialCharges.find((c) => c.type === 'detention');
    expect(detention).toBeTruthy();
    expect(detention.source).toBe('system_detention');
    expect(detention.status).toBe('pending');
    expect(detention.amountCents).toBe(15000); // 2h over free time * $75/hr

    // 5) Shipper approves the exact frozen amount/evidence
    const approve = await request(app)
      .put(`/api/loads/${loadId}/accessorials/${detention._id}/approve`)
      .set('Authorization', `Bearer ${sTok}`)
      .send({ evidenceHashShown: detention.evidenceHash });
    expectStatus(approve, 200);

    // 6) Settled (Path A: paid from float, no Stripe) + tamper-evident audit + ledger
    load = await Load.findById(loadId);
    const settled = load.accessorialCharges.id(detention._id);
    expect(['approved', 'paid']).toContain(settled.status);
    expect(String(settled.approvalAudit.approverUserId)).toBe(String(shipper._id));
    expect(settled.approvalAudit.amountCentsApproved).toBe(15000);

    const ledger = await LedgerEntry.find({ loadId });
    expect(ledger.some((e) => e.entryType === 'accessorial_settle')).toBe(true);
  });
});
