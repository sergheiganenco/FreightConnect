/**
 * Detention auto-collect — billing service + route guards (Path A: accrual MVP)
 *
 * Pipeline under test:
 *   geofence/manual depart → recalculateDwellEvent computes server-authoritative
 *   fee → detentionBillingService.syncDetentionCharge proposes a PENDING
 *   accessorial charge with frozen evidence + evidenceHash → shipper approves
 *   (must match the hash they were shown) → settle via existing path.
 *
 * Security/correctness gaps covered: #1 approval audit, #2 amount/evidence freeze,
 * #3 rate provenance, #4 charge state machine (rejected terminal), #5 zero→positive.
 */

require('../setup');
const express = require('express');
const request = require('supertest');

const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const Load = require('../../models/Load');
const DwellEvent = require('../../models/DwellEvent');
const { syncDetentionCharge } = require('../../services/detentionBillingService');

const io = { to: () => ({ emit: () => {} }) };
const loadRoutes = require('../../routes/loadRoutes')(io);
const detentionRoutes = require('../../routes/detentionRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loads', loadRoutes);
  app.use('/api/detention', detentionRoutes);
  return app;
}

// An accepted load with shipper + carrier wired up.
async function setupAcceptedLoad(extra = {}) {
  const shipper = await createTestUser({ role: 'shipper' });
  const carrier = await createTestUser({
    role: 'carrier',
    verification: { status: 'verified', identityVerified: true },
    fleet: [{ truckId: 'TRUCK-1', status: 'Available' }],
  });
  const load = await createTestLoad(shipper._id, {
    status: 'delivered',
    acceptedBy: carrier._id,
    ...extra,
  });
  return { shipper, carrier, load };
}

// Build a departed DwellEvent with a given on-site duration (minutes).
// No contract → authoritative rates are the server defaults (120 free, $75/hr).
async function makeDwell(load, carrier, shipper, dwellMinutes) {
  const arrivedAt = new Date('2026-06-01T08:00:00Z');
  const departedAt = new Date(arrivedAt.getTime() + dwellMinutes * 60000);
  return DwellEvent.create({
    load: load._id,
    carrier: carrier._id,
    shipper: shipper._id,
    stopType: 'delivery',
    facilityName: 'ACME DC #4',
    arrivedAt,
    dockInAt: new Date(arrivedAt.getTime() + 30 * 60000),
    dockOutAt: new Date(departedAt.getTime() - 10 * 60000),
    departedAt,
    dwellMinutes,
  });
}

function detentionCharges(load) {
  return load.accessorialCharges.filter((c) => c.type === 'detention');
}

describe('detentionBillingService.syncDetentionCharge', () => {
  test('fee > 0 with no existing charge → proposes a pending system detention charge with frozen evidence', async () => {
    const { shipper, carrier, load } = await setupAcceptedLoad();
    const dwell = await makeDwell(load, carrier, shipper, 240); // 4h on site → 2h detention

    await syncDetentionCharge(dwell);

    const fresh = await Load.findById(load._id);
    const charges = detentionCharges(fresh);
    expect(charges).toHaveLength(1);
    const c = charges[0];
    expect(c.status).toBe('pending');
    expect(c.source).toBe('system_detention');
    expect(c.amountCents).toBe(15000); // 2h * $75
    expect(String(c.dwellEventId)).toBe(String(dwell._id));
    expect(c.evidenceHash).toBeTruthy();
    expect(c.evidence.dwellMinutes).toBe(240);
    expect(c.evidence.detentionMinutes).toBe(120);
    expect(c.evidence.detentionRateCents).toBe(7500);
    expect(c.evidence.facilityName).toBe('ACME DC #4');
    expect(c.proposedAt).toBeTruthy();
  });

  test('idempotent re-depart: syncing the same dwell event twice does not duplicate the charge', async () => {
    const { shipper, carrier, load } = await setupAcceptedLoad();
    const dwell = await makeDwell(load, carrier, shipper, 240);

    await syncDetentionCharge(dwell);
    await syncDetentionCharge(dwell);

    const fresh = await Load.findById(load._id);
    expect(detentionCharges(fresh)).toHaveLength(1);
  });

  test('zero-fee no-op: dwell within free time creates no charge', async () => {
    const { shipper, carrier, load } = await setupAcceptedLoad();
    const dwell = await makeDwell(load, carrier, shipper, 60); // under 120 free

    await syncDetentionCharge(dwell);

    const fresh = await Load.findById(load._id);
    expect(detentionCharges(fresh)).toHaveLength(0);
  });

  test('zero → positive: no-op at $0, then a correction makes it positive → proposes', async () => {
    const { shipper, carrier, load } = await setupAcceptedLoad();
    const dwell = await makeDwell(load, carrier, shipper, 90); // $0

    await syncDetentionCharge(dwell);
    let fresh = await Load.findById(load._id);
    expect(detentionCharges(fresh)).toHaveLength(0);

    // Correction: actually on site 5h
    dwell.dwellMinutes = 300;
    dwell.departedAt = new Date(dwell.arrivedAt.getTime() + 300 * 60000);
    await dwell.save();
    await syncDetentionCharge(dwell);

    fresh = await Load.findById(load._id);
    const charges = detentionCharges(fresh);
    expect(charges).toHaveLength(1);
    expect(charges[0].amountCents).toBe(22500); // 3h * $75
    expect(charges[0].status).toBe('pending');
  });

  test('amount change before approval: re-proposes with a new evidenceHash (no silent mutation)', async () => {
    const { shipper, carrier, load } = await setupAcceptedLoad();
    const dwell = await makeDwell(load, carrier, shipper, 240); // $150

    await syncDetentionCharge(dwell);
    let fresh = await Load.findById(load._id);
    const firstHash = detentionCharges(fresh)[0].evidenceHash;

    // Dwell recalculated longer → amount changes
    dwell.dwellMinutes = 360; // 6h → 4h detention
    dwell.departedAt = new Date(dwell.arrivedAt.getTime() + 360 * 60000);
    await dwell.save();
    await syncDetentionCharge(dwell);

    fresh = await Load.findById(load._id);
    const charges = detentionCharges(fresh);
    expect(charges).toHaveLength(1); // still one charge (keyed on dwellEventId)
    expect(charges[0].amountCents).toBe(30000); // 4h * $75
    expect(charges[0].status).toBe('pending');
    expect(charges[0].evidenceHash).not.toBe(firstHash);
  });

  test('rejected is terminal: same evidence does not re-propose; material change does', async () => {
    const { shipper, carrier, load } = await setupAcceptedLoad();
    const dwell = await makeDwell(load, carrier, shipper, 240);
    await syncDetentionCharge(dwell);

    // Simulate shipper rejection directly on the document
    let fresh = await Load.findById(load._id);
    const charge = detentionCharges(fresh)[0];
    charge.status = 'rejected';
    charge.rejectionReason = 'facility was actually on time';
    await fresh.save();

    // Re-sync with identical evidence → must stay rejected, no new charge
    await syncDetentionCharge(dwell);
    fresh = await Load.findById(load._id);
    let charges = detentionCharges(fresh);
    expect(charges).toHaveLength(1);
    expect(charges[0].status).toBe('rejected');

    // Material change (new evidence) → re-proposed as pending
    dwell.dwellMinutes = 420;
    dwell.departedAt = new Date(dwell.arrivedAt.getTime() + 420 * 60000);
    await dwell.save();
    await syncDetentionCharge(dwell);
    fresh = await Load.findById(load._id);
    charges = detentionCharges(fresh);
    expect(charges).toHaveLength(1);
    expect(charges[0].status).toBe('pending');
  });
});

describe('Detention route guards + approval (freeze + audit)', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('carrier cannot create a detention charge manually (403)', async () => {
    const { carrier, load } = await setupAcceptedLoad();

    const res = await request(app)
      .post(`/api/loads/${load._id}/accessorials`)
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({ type: 'detention', amountCents: 999999 });

    expect(res.status).toBe(403);
  });

  test('approve happy path: correct evidenceHash → approved + audit record written', async () => {
    const { shipper, carrier, load } = await setupAcceptedLoad();
    const dwell = await makeDwell(load, carrier, shipper, 240);
    await syncDetentionCharge(dwell);

    let fresh = await Load.findById(load._id);
    const charge = detentionCharges(fresh)[0];

    const res = await request(app)
      .put(`/api/loads/${load._id}/accessorials/${charge._id}/approve`)
      .set('Authorization', `Bearer ${generateToken(shipper)}`)
      .send({ evidenceHashShown: charge.evidenceHash });

    expect(res.status).toBe(200);
    expect(['approved', 'paid']).toContain(res.body.charge.status);

    fresh = await Load.findById(load._id);
    const settled = detentionCharges(fresh)[0];
    expect(settled.approvalAudit).toBeDefined();
    expect(String(settled.approvalAudit.approverUserId)).toBe(String(shipper._id));
    expect(settled.approvalAudit.amountCentsApproved).toBe(15000);
    expect(settled.approvalAudit.evidenceHashShown).toBe(charge.evidenceHash);
  });

  test('stale approval blocked: a hash that no longer matches is rejected (409)', async () => {
    const { shipper, carrier, load } = await setupAcceptedLoad();
    const dwell = await makeDwell(load, carrier, shipper, 240);
    await syncDetentionCharge(dwell);

    let fresh = await Load.findById(load._id);
    const staleHash = detentionCharges(fresh)[0].evidenceHash;

    // Amount changes before the shipper approves
    dwell.dwellMinutes = 360;
    dwell.departedAt = new Date(dwell.arrivedAt.getTime() + 360 * 60000);
    await dwell.save();
    await syncDetentionCharge(dwell);

    fresh = await Load.findById(load._id);
    const charge = detentionCharges(fresh)[0];

    const res = await request(app)
      .put(`/api/loads/${load._id}/accessorials/${charge._id}/approve`)
      .set('Authorization', `Bearer ${generateToken(shipper)}`)
      .send({ evidenceHashShown: staleHash });

    expect(res.status).toBe(409);

    // Current hash still approves
    const ok = await request(app)
      .put(`/api/loads/${load._id}/accessorials/${charge._id}/approve`)
      .set('Authorization', `Bearer ${generateToken(shipper)}`)
      .send({ evidenceHashShown: charge.evidenceHash });
    expect(ok.status).toBe(200);
  });

  test('reject records who/when/why and is terminal', async () => {
    const { shipper, carrier, load } = await setupAcceptedLoad();
    const dwell = await makeDwell(load, carrier, shipper, 240);
    await syncDetentionCharge(dwell);

    let fresh = await Load.findById(load._id);
    const charge = detentionCharges(fresh)[0];

    const res = await request(app)
      .put(`/api/loads/${load._id}/accessorials/${charge._id}/reject`)
      .set('Authorization', `Bearer ${generateToken(shipper)}`)
      .send({ reason: 'detention not warranted' });

    expect(res.status).toBe(200);
    expect(res.body.charge.status).toBe('rejected');

    fresh = await Load.findById(load._id);
    const rejected = detentionCharges(fresh)[0];
    expect(String(rejected.rejectedBy)).toBe(String(shipper._id));
    expect(rejected.rejectedAt).toBeTruthy();
    expect(rejected.rejectionReason).toBe('detention not warranted');
  });
});

// ── Hardening from adversarial review ────────────────────────────────────────
describe('detentionBillingService — approved is terminal (no silent rewind)', () => {
  // Force a charge into the 'approved' state (as happens when settlement is
  // redirected to a factor or fails), then prove a later re-sync cannot rewind it.
  async function approvedCharge(dwellMinutes = 240) {
    const { shipper, carrier, load } = await setupAcceptedLoad();
    const dwell = await makeDwell(load, carrier, shipper, dwellMinutes);
    await syncDetentionCharge(dwell);
    const fresh = await Load.findById(load._id);
    const charge = detentionCharges(fresh)[0];
    charge.status = 'approved';
    charge.approvalAudit = {
      approverUserId: shipper._id, approvedAt: new Date(),
      amountCentsApproved: charge.amountCents, evidenceHashShown: charge.evidenceHash,
    };
    await fresh.save();
    return { shipper, carrier, load, dwell, approvedAmount: charge.amountCents, approvedHash: charge.evidenceHash };
  }

  test('a later evidence change does NOT rewind an approved charge to pending', async () => {
    const { load, dwell, approvedAmount } = await approvedCharge(240);

    dwell.dwellMinutes = 360; // would recompute to a higher amount
    dwell.departedAt = new Date(dwell.arrivedAt.getTime() + 360 * 60000);
    await dwell.save();
    await syncDetentionCharge(dwell);

    const fresh = await Load.findById(load._id);
    const c = detentionCharges(fresh)[0];
    expect(c.status).toBe('approved');         // not rewound to pending
    expect(c.amountCents).toBe(approvedAmount); // amount frozen at approval
    expect(c.approvalAudit.approverUserId).toBeTruthy(); // audit intact
  });

  test('a recalculation to $0 does NOT silently void an approved charge', async () => {
    const { load, dwell, approvedAmount } = await approvedCharge(240);

    dwell.dwellMinutes = 60; // under free time → fee 0
    dwell.departedAt = new Date(dwell.arrivedAt.getTime() + 60 * 60000);
    await dwell.save();
    await syncDetentionCharge(dwell);

    const fresh = await Load.findById(load._id);
    const c = detentionCharges(fresh)[0];
    expect(c.status).toBe('approved');         // not auto-voided
    expect(c.amountCents).toBe(approvedAmount);
  });
});

describe('Detention routes — authorization + double-billing guards', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('GET /detention/load/:loadId is forbidden for a non-party (403)', async () => {
    const { load } = await setupAcceptedLoad();
    const stranger = await createTestUser({ role: 'carrier', fleet: [{ truckId: 'X' }] });

    const res = await request(app)
      .get(`/api/detention/load/${load._id}`)
      .set('Authorization', `Bearer ${generateToken(stranger)}`);

    expect(res.status).toBe(403);
  });

  test('GET /detention/load/:loadId is allowed for the load shipper (200)', async () => {
    const { shipper, load } = await setupAcceptedLoad();

    const res = await request(app)
      .get(`/api/detention/load/${load._id}`)
      .set('Authorization', `Bearer ${generateToken(shipper)}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('a carrier cannot check in twice for the same stop (no double-billing)', async () => {
    const { carrier, load } = await setupAcceptedLoad({ status: 'in-transit' });
    const token = generateToken(carrier);

    const first = await request(app)
      .post(`/api/detention/check-in/${load._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stopType: 'delivery' });
    expect(first.status).toBe(201);
    const eventId = first.body._id;

    const depart = await request(app)
      .patch(`/api/detention/depart/${eventId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(depart.status).toBe(200);

    // Second check-in at the SAME stop after departure must be rejected.
    const second = await request(app)
      .post(`/api/detention/check-in/${load._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stopType: 'delivery' });
    expect(second.status).toBe(409);
  });
});
