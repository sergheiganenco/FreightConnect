/**
 * The driver's daily tools: inspection reports (a truck reported unsafe stays parked until the repair
 * is certified), the document wallet and its expiry warnings, breakdown/accident reports, lumper receipts.
 * Also: dock details are hidden from carriers who have not booked the load.
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Load = require('../../models/Load');
const User = require('../../models/User');
const Notification = require('../../models/Notification');
const ComplianceDoc = require('../../models/ComplianceDoc');
const Exception = require('../../models/Exception');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const { runExpiryCheck, daysLeft, due } = require('../../jobs/expiryMonitor');

jest.mock('axios');
jest.mock('node-fetch');

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {} };
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api', require('../../middlewares/redactLoadSecrets'));
app.use('/api/loads', require('../../routes/loadRoutes')(mockIo));
app.use('/api/documents', require('../../routes/documentRoutes'));
app.use('/api/dvir', require('../../routes/dvirRoutes'));
app.use('/api/compliance-docs', require('../../routes/complianceDocRoutes'));
app.use('/api/exceptions', require('../../routes/exceptionRoutes'));
app.use('/api', require('../../routes/evidenceRoutes'));

const bearer = (u) => ({ Authorization: `Bearer ${generateToken(u)}` });
const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PNG = 'data:image/png;base64,' + PNG_BYTES.toString('base64');
const DAY = 86400000;

async function company() {
  const owner = await createTestUser({
    role: 'carrier', fleet: [{ truckId: 'TRK-1', status: 'Available', available: true }],
    drivers: [{ driverId: 'drv_1', name: 'Ann Driver' }],
  });
  const driver = await createTestUser({ role: 'carrier', name: 'Ann Driver', parentAccountId: owner._id, companyRole: 'driver', mustChangePassword: false });
  await User.updateOne({ _id: owner._id, 'drivers.driverId': 'drv_1' }, { $set: { 'drivers.$.loginUserId': driver._id } });
  const dTok = { Authorization: `Bearer ${jwt.sign({ userId: driver._id, role: 'carrier', companyRole: 'driver', companyOwnerId: String(owner._id) }, process.env.JWT_SECRET)}` };
  return { owner, driver, dTok };
}

describe('inspection reports', () => {
  test('a truck reported unsafe cannot start a load until a manager certifies the repair', async () => {
    const { owner, driver, dTok } = await company();
    const shipper = await createTestUser({ role: 'shipper' });
    const load = await createTestLoad(shipper._id, { status: 'accepted', acceptedBy: owner._id, assignedTruckId: 'TRK-1' });

    const bad = await request(app).post('/api/dvir').set(dTok).send({ truckId: 'TRK-1', type: 'pre_trip', safeToOperate: false, signedName: 'Ann Driver' });
    expect(bad.status).toBe(400); // unsafe with no defect listed
    expect((await request(app).post('/api/dvir').set(dTok).send({ truckId: 'NOPE', type: 'pre_trip', safeToOperate: true, signedName: 'Ann Driver' })).status).toBe(400);

    const report = await request(app).post('/api/dvir').set(dTok).send({
      truckId: 'TRK-1', type: 'pre_trip', safeToOperate: false, signedName: 'Ann Driver',
      defects: [{ item: 'Service brakes', note: 'air leak' }],
    });
    expect(report.status).toBe(201);
    expect(report.body.data.outOfService).toBe(true);
    const told = await Notification.findOne({ userId: owner._id, type: 'dvir:defect' });
    expect(told.title).toMatch(/out of service/);

    const go = await request(app).put(`/api/loads/${load._id}/status`).set(dTok).send({ status: 'in-transit' });
    expect(go.status).toBe(409);
    expect(go.body.reason).toBe('truck_out_of_service');

    // The driver cannot certify their own report; a manager can, once.
    const certify = (auth) => request(app).post(`/api/dvir/${report.body.data._id}/certify`).set(auth).send({ repaired: true, certifiedName: 'Olga Owner', note: 'line replaced' });
    expect((await certify(dTok)).status).toBe(403);
    expect((await certify(bearer(owner))).status).toBe(200);
    expect((await certify(bearer(owner))).status).toBe(409);
    expect(await Notification.exists({ userId: driver._id, type: 'dvir:certified' })).toBeTruthy();

    const again = await request(app).put(`/api/loads/${load._id}/status`).set(dTok).send({ status: 'in-transit' });
    expect(again.status).toBe(200);

    const other = await createTestUser({ role: 'carrier' });
    expect((await request(app).get('/api/dvir').set(bearer(other))).body.data).toHaveLength(0);
    expect((await request(app).get('/api/dvir').set(dTok)).body.data).toHaveLength(1);
  });
});

describe('document wallet', () => {
  test('managers add documents, every company login can read them, nobody else can, and a disguised file is refused', async () => {
    const { owner, dTok } = await company();
    const add = (auth, fields, file) => {
      let r = request(app).post('/api/compliance-docs').set(auth);
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
      return file ? r.attach('file', file.buf, file.name) : r;
    };
    const fields = { subjectType: 'truck', subjectId: 'TRK-1', kind: 'registration', number: 'TN-123', expiresAt: new Date(Date.now() + 40 * DAY).toISOString() };

    expect((await add(dTok, fields)).status).toBe(403);
    expect((await add(bearer(owner), { ...fields, subjectId: 'NOPE' })).status).toBe(400);
    expect((await add(bearer(owner), fields, { buf: Buffer.from('<html><script>alert(1)</script></html>'), name: 'reg.png' })).status).toBe(400);
    const ok = await add(bearer(owner), fields, { buf: PNG_BYTES, name: 'reg.png' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.hasFile).toBe(true);
    expect(JSON.stringify(ok.body)).not.toMatch(/\.png"/); // the stored file name is never sent

    const id = ok.body.data._id;
    expect((await request(app).get('/api/compliance-docs').set(dTok)).body.data).toHaveLength(1);
    const file = await request(app).get(`/api/compliance-docs/${id}/file`).set(dTok);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');

    const stranger = await createTestUser({ role: 'carrier' });
    expect((await request(app).get(`/api/compliance-docs/${id}/file`).set(bearer(stranger))).status).toBe(404);
    expect((await request(app).delete(`/api/compliance-docs/${id}`).set(bearer(stranger))).status).toBe(404);
    expect((await request(app).delete(`/api/compliance-docs/${id}`).set(dTok)).status).toBe(403);
    expect((await request(app).delete(`/api/compliance-docs/${id}`).set(bearer(owner))).status).toBe(200);
  });

  test('expiry warnings go out on fixed days to the company, and to the driver for their own credentials', async () => {
    const now = new Date('2026-11-24T12:00:00Z');
    expect(daysLeft('2026-12-01T03:00:00Z', now)).toBe(7);
    expect([30, 7, 0, -7, -14].every(due)).toBe(true);
    expect([29, 8, -1, -6].some(due)).toBe(false);

    const { owner, driver } = await company();
    await User.updateOne({ _id: owner._id, 'drivers.driverId': 'drv_1' }, { $set: {
      'drivers.$.medicalCardExpiry': new Date(now.getTime() + 7 * DAY), 'drivers.$.licenseExpiry': new Date(now.getTime() + 200 * DAY),
    } });
    await ComplianceDoc.create({ company: owner._id, subjectType: 'truck', subjectId: 'TRK-1', kind: 'annual_inspection', expiresAt: new Date(now.getTime() + 30 * DAY) });
    await ComplianceDoc.create({ company: owner._id, subjectType: 'truck', subjectId: 'TRK-1', kind: 'registration', expiresAt: new Date(now.getTime() + 12 * DAY) });

    const stats = await runExpiryCheck(now);
    expect(stats).toEqual({ warned: 3, errors: 0 });
    const mine = await Notification.find({ userId: owner._id, type: 'compliance:expiring' }).lean();
    expect(mine.map((n) => n.title).sort()).toEqual(["Ann Driver's medical card expires in 7 days", 'Truck TRK-1: annual inspection expires in 30 days']);
    expect((await Notification.findOne({ userId: driver._id, type: 'compliance:expiring' })).title).toBe('Your medical card expires in 7 days');
  });
});

describe('on the road', () => {
  test('a driver reports a breakdown: severity is set by the server and the office is told; a shipper cannot file one', async () => {
    const { owner, dTok } = await company();
    const shipper = await createTestUser({ role: 'shipper' });
    const load = await createTestLoad(shipper._id, { status: 'in-transit', acceptedBy: owner._id });
    const body = { loadId: String(load._id), type: 'breakdown', severity: 'low', title: 'Blown tire, I-40 mm 212', description: 'Waiting for road service, about 3 hours.' };

    const r = await request(app).post('/api/exceptions').set(dTok).send(body);
    expect(r.status).toBe(201);
    expect((await Exception.findById(r.body._id)).severity).toBe('high');
    expect(await Notification.exists({ userId: owner._id, title: 'Your driver reported a breakdown' })).toBeTruthy();
    expect(await Notification.exists({ userId: shipper._id, type: 'exception:new' })).toBeTruthy();

    const acc = await request(app).post('/api/exceptions').set(dTok).send({ ...body, type: 'accident' });
    expect((await Exception.findById(acc.body._id)).severity).toBe('critical');
    expect((await request(app).post('/api/exceptions').set(bearer(shipper)).send(body)).status).toBe(400);
  });

  test('a lumper charge needs its own receipt photo, and links sent by the client are not stored', async () => {
    const { owner } = await company();
    const shipper = await createTestUser({ role: 'shipper' });
    const load = await createTestLoad(shipper._id, { status: 'in-transit', acceptedBy: owner._id });
    const ask = () => request(app).post(`/api/loads/${load._id}/accessorials`).set(bearer(owner))
      .send({ type: 'lumper', amountCents: 18000, description: 'Unload', evidenceUrls: ['https://evil.example/x'] });

    const no = await ask();
    expect(no.status).toBe(400);
    expect(no.body.reason).toBe('receipt_required');

    const photo = await request(app).post(`/api/loads/${load._id}/evidence`).set(bearer(owner))
      .field('stage', 'delivery').field('kind', 'receipt').attach('file', PNG_BYTES, 'receipt.png');
    expect(photo.status).toBe(201);
    expect((await ask()).status).toBeLessThan(300);
    const charge = (await Load.findById(load._id)).accessorialCharges[0];
    expect(String(charge.receiptEvidenceId)).toBe(String(photo.body.data._id));
    expect([...charge.evidenceUrls]).toEqual([]);
    expect((await ask()).status).toBe(400); // the same receipt cannot back a second charge
  });
});

describe('who sees what, and what cannot be rewritten', () => {
  test('dock details are hidden from a carrier until that carrier has booked the load', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await createTestUser({ role: 'carrier' });
    const load = await createTestLoad(shipper._id, {
      pickupNumber: 'PU-77', deliveryContactEmail: 'dock@receiver.test', pickupContactPhone: '555-0100', pickupHours: 'Mon-Fri',
    });
    const seen = async (u) => (await request(app).get(`/api/loads/${load._id}`).set(bearer(u))).body;

    const browsing = await seen(carrier);
    expect(browsing.origin).toBeTruthy();
    expect(browsing.pickupHours).toBe('Mon-Fri');
    expect(browsing.pickupNumber).toBeUndefined();
    expect(browsing.deliveryContactEmail).toBeUndefined();
    expect(browsing.pickupContactPhone).toBeUndefined();
    const board = (await request(app).get('/api/loads').set(bearer(carrier))).body;
    expect(JSON.stringify(board)).not.toContain('PU-77');

    expect((await seen(shipper)).pickupNumber).toBe('PU-77');
    await Load.updateOne({ _id: load._id }, { $set: { status: 'accepted', acceptedBy: carrier._id } });
    expect((await seen(carrier)).pickupNumber).toBe('PU-77');
  });

  test('the carrier device fills the shipper signature once and cannot replace it; the seal number is the first one recorded', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await createTestUser({ role: 'carrier' });
    const load = await createTestLoad(shipper._id, { status: 'accepted', acceptedBy: carrier._id });
    const sign = (u, body) => request(app).post(`/api/documents/${load._id}/pickup-signature`).set(bearer(u)).send({ dataUrl: PNG, ...body });

    expect((await sign(shipper, { signerName: 'Sam Shipper' })).status).toBe(200);
    expect((await sign(carrier, { party: 'shipper', signerName: 'Forged Name' })).status).toBe(409);
    expect((await Load.findById(load._id)).shipperSignature.signerName).toBe('Sam Shipper');

    const photo = (seal) => request(app).post(`/api/loads/${load._id}/evidence`).set(bearer(carrier))
      .field('stage', 'pickup').field('kind', 'seal').field('sealNumber', seal).attach('file', PNG_BYTES, 'seal.png');
    expect((await photo('S-1')).status).toBe(201);
    expect((await photo('S-2')).status).toBe(201);
    expect((await Load.findById(load._id)).sealNumber).toBe('S-1');

    // Once the load has left, the carrier device cannot add a shipper signature at all.
    const late = await createTestLoad(shipper._id, { status: 'in-transit', acceptedBy: carrier._id });
    const r = await request(app).post(`/api/documents/${late._id}/pickup-signature`).set(bearer(carrier)).send({ dataUrl: PNG, party: 'shipper', signerName: 'Late' });
    expect(r.status).toBe(409);
    expect(mongoose.isValidObjectId(late._id)).toBe(true);
  });
});
