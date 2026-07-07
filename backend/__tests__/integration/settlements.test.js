/**
 * Integration: Driver Settlements (settlementRoutes).
 *
 * Covers the payroll happy path and its guards:
 *  - a percentage-pay driver's delivered load → a DRAFT with correct grossCents
 *  - re-generating the same period excludes the already-settled load
 *  - draft → finalized → paid transitions (and their 400 guards)
 *  - voiding a settlement frees its load for re-settlement
 *  - a driver sub-account is blocked (403) by managerOnly
 */

require('../setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const User = require('../../models/User');

const settlementRoutes = require('../../routes/settlementRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/settlements', settlementRoutes);
  return app;
}

// Inject a `pay` subobject onto a roster driver, bypassing the (not-yet-declared)
// schema path the maintainer is adding. Read back lean, the route sees it directly.
async function setDriverPay(ownerId, driverId, pay) {
  await User.collection.updateOne(
    { _id: ownerId, 'drivers.driverId': driverId },
    { $set: { 'drivers.$.pay': pay } }
  );
}

// Craft a token for a driver sub-account (companyRole 'driver' acting for a company).
function tokenFor(user, { companyRole = 'owner', companyOwnerId } = {}) {
  return jwt.sign(
    { userId: user._id, role: user.role, companyRole, companyOwnerId: companyOwnerId || user._id },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );
}

const DRIVER_ID = 'drv_test1';
const PERIOD_START = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const PERIOD_END = new Date(Date.now() + 24 * 60 * 60 * 1000);

// Owner carrier + one roster driver on 70% pay + one delivered load assigned to them.
async function seedCompany() {
  const owner = await createTestUser({
    role: 'carrier',
    companyRole: 'owner',
    companyName: 'Payroll Co',
    drivers: [{ driverId: DRIVER_ID, name: 'Pat Driver' }],
  });
  await setDriverPay(owner._id, DRIVER_ID, {
    type: 'percentage', percentage: 70, perMileCents: 0, perLoadCents: 0, flatCents: 0,
  });

  const shipper = await createTestUser({ role: 'shipper' });
  const load = await createTestLoad(shipper._id, {
    title: 'Chicago → Dallas',
    rate: 2500, // → rateCents 250000
    status: 'delivered',
    acceptedBy: owner._id,
    assignedDriverId: DRIVER_ID,
    assignedDriverName: 'Pat Driver',
    deliveredAt: new Date(),
  });

  return { owner, ownerToken: generateToken(owner), shipper, load };
}

function generateBody() {
  return { driverId: DRIVER_ID, periodStart: PERIOD_START.toISOString(), periodEnd: PERIOD_END.toISOString() };
}

describe('Integration — Driver Settlements', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('POST /generate produces a DRAFT with percentage grossCents = 70% of load revenue', async () => {
    const { ownerToken } = await seedCompany();

    const res = await request(app)
      .post('/api/settlements/generate')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(generateBody());

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
    expect(res.body.payType).toBe('percentage');
    expect(res.body.settlementNumber).toMatch(/^STMT-\d{8}$/);
    expect(res.body.lineItems).toHaveLength(1);

    const line = res.body.lineItems[0];
    expect(line.loadRevenueCents).toBe(250000);
    expect(line.grossCents).toBe(175000);   // 70% of 250000
    expect(line.netCents).toBe(175000);     // no deductions
    expect(res.body.grossCents).toBe(175000);
    expect(res.body.deductionsCents).toBe(0);
    expect(res.body.netCents).toBe(175000);
  });

  test('re-generating the same period excludes the already-settled load', async () => {
    const { ownerToken } = await seedCompany();

    const first = await request(app)
      .post('/api/settlements/generate')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(generateBody());
    expect(first.status).toBe(201);
    expect(first.body.lineItems).toHaveLength(1);

    const second = await request(app)
      .post('/api/settlements/generate')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(generateBody());
    expect(second.status).toBe(201);
    expect(second.body.lineItems).toHaveLength(0);
    expect(second.body.grossCents).toBe(0);
    expect(second.body.netCents).toBe(0);
  });

  test('draft → finalize → pay transitions, with 400 guards', async () => {
    const { ownerToken } = await seedCompany();

    const gen = await request(app)
      .post('/api/settlements/generate')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(generateBody());
    const id = gen.body._id;

    // Cannot pay before finalizing.
    const earlyPay = await request(app)
      .patch(`/api/settlements/${id}/pay`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ payMethod: 'ach' });
    expect(earlyPay.status).toBe(400);

    // Finalize.
    const fin = await request(app)
      .patch(`/api/settlements/${id}/finalize`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(fin.status).toBe(200);
    expect(fin.body.status).toBe('finalized');
    expect(fin.body.finalizedAt).toBeTruthy();

    // Cannot finalize twice.
    const finAgain = await request(app)
      .patch(`/api/settlements/${id}/finalize`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(finAgain.status).toBe(400);

    // Pay.
    const pay = await request(app)
      .patch(`/api/settlements/${id}/pay`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ payMethod: 'ach', paidReference: 'ACH-12345' });
    expect(pay.status).toBe(200);
    expect(pay.body.status).toBe('paid');
    expect(pay.body.paidAt).toBeTruthy();
    expect(pay.body.payMethod).toBe('ach');
    expect(pay.body.paidReference).toBe('ACH-12345');
  });

  test('voiding a settlement frees its load for re-settlement', async () => {
    const { ownerToken } = await seedCompany();

    const first = await request(app)
      .post('/api/settlements/generate')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(generateBody());
    expect(first.body.lineItems).toHaveLength(1);
    const id = first.body._id;

    // While the draft stands, the load is excluded from a new run.
    const blocked = await request(app)
      .post('/api/settlements/generate')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(generateBody());
    expect(blocked.body.lineItems).toHaveLength(0);

    // Void the first settlement.
    const voided = await request(app)
      .patch(`/api/settlements/${id}/void`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(voided.status).toBe(200);
    expect(voided.body.status).toBe('void');

    // The load is now available again.
    const regen = await request(app)
      .post('/api/settlements/generate')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(generateBody());
    expect(regen.status).toBe(201);
    expect(regen.body.lineItems).toHaveLength(1);
    expect(regen.body.grossCents).toBe(175000);
  });

  test('a paid settlement cannot be voided', async () => {
    const { ownerToken } = await seedCompany();
    const gen = await request(app)
      .post('/api/settlements/generate')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(generateBody());
    const id = gen.body._id;

    await request(app).patch(`/api/settlements/${id}/finalize`).set('Authorization', `Bearer ${ownerToken}`).send({});
    await request(app).patch(`/api/settlements/${id}/pay`).set('Authorization', `Bearer ${ownerToken}`).send({ payMethod: 'check' });

    const voidRes = await request(app)
      .patch(`/api/settlements/${id}/void`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(voidRes.status).toBe(400);
  });

  test('GET / lists company settlements (filterable by driverId)', async () => {
    const { ownerToken } = await seedCompany();
    await request(app)
      .post('/api/settlements/generate')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(generateBody());

    const res = await request(app)
      .get(`/api/settlements?driverId=${DRIVER_ID}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].driverId).toBe(DRIVER_ID);
  });

  test('a driver sub-account is blocked (403) by managerOnly', async () => {
    const { owner } = await seedCompany();

    // A real, active driver sub-account under the company (auth checks `active`).
    const driverSub = await createTestUser({
      role: 'carrier',
      companyRole: 'driver',
      parentAccountId: owner._id,
    });
    const driverToken = tokenFor(driverSub, { companyRole: 'driver', companyOwnerId: owner._id });

    const genRes = await request(app)
      .post('/api/settlements/generate')
      .set('Authorization', `Bearer ${driverToken}`)
      .send(generateBody());
    expect(genRes.status).toBe(403);

    const listRes = await request(app)
      .get('/api/settlements')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(listRes.status).toBe(403);
  });

  test('a shipper cannot use settlements (403 Carriers only)', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const res = await request(app)
      .get('/api/settlements')
      .set('Authorization', `Bearer ${generateToken(shipper)}`);
    expect(res.status).toBe(403);
  });
});
