/**
 * Integration: faults found by walking a load end to end.
 * - a load delivered through the normal route charges the shipper and pays the carrier (it used to do neither)
 * - an FMCSA re-check cannot lift a suspension FMCSA did not cause, and a suspended carrier cannot book while "pending"
 * - a DOT number without for-hire authority cannot book a load that crosses a state line
 * - a driver login runs loads but cannot book, bid, cancel or assign
 */
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.FMCSA_API_KEY = 'test-key';
const mockStripe = {
  paymentIntents: { capture: jest.fn(async (id) => ({ id, amount: 100000, latest_charge: 'ch_d1', metadata: {} })) },
  transfers: { create: jest.fn(async () => ({ id: 'tr_d1' })) },
};
jest.mock('stripe', () => () => mockStripe);
jest.mock('axios', () => ({ get: jest.fn() }));

require('../setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const User = require('../../models/User');
const Load = require('../../models/Load');
const Payment = require('../../models/Payment');
const Invoice = require('../../models/Invoice');
const { createTestUser, createTestLoad, generateToken } = require('../helpers');
const fmcsaService = require('../../services/fmcsaService');
const verificationService = require('../../services/verificationService');
const { checkLoadEligibility } = require('../../services/loadEligibility');
const { settleOnDelivery } = require('../../services/deliveryPayment');

const app = express();
app.use(express.json());
app.use('/api/loads', require('../../routes/loadRoutes')({ to: () => ({ emit: () => {} }), emit: () => {} }));
app.use('/api/bids', require('../../routes/bidRoutes'));
app.use('/api/users', require('../../routes/userRoutes'));
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

async function heldLoad(status = 'in-transit') {
  const shipper = await createTestUser({ role: 'shipper' });
  const carrier = await createTestUser({ role: 'carrier' });
  const load = await createTestLoad(shipper._id, { status, acceptedBy: carrier._id, rate: 1000, deliverySignature: { dataUrl: 'data:image/png;base64,AAAA', signerName: 'Dana Dock', signedByRole: 'receiver', signedAt: new Date() } });
  const payment = await Payment.create({
    loadId: load._id, shipperId: shipper._id, carrierId: carrier._id, amountCents: 100000, platformFeeCents: 2000, carrierPayoutCents: 98000,
    amount: 1000, platformFee: 20, carrierPayout: 980, status: 'in_escrow', stripePaymentIntentId: `pi_d_${load._id}`,
  });
  return { shipper, carrier, load, payment };
}

describe('payment on delivery', () => {
  beforeEach(() => { mockStripe.paymentIntents.capture.mockClear(); mockStripe.transfers.create.mockClear(); });

  test('delivering through the normal status route charges the shipper and pays the carrier', async () => {
    const { carrier, load, payment } = await heldLoad();
    await User.updateOne({ _id: carrier._id }, { $set: { 'stripe.connectAccountId': 'acct_d1' } });
    const r = await request(app).put(`/api/loads/${load._id}/status`).set(bearer(generateToken(carrier))).send({ status: 'delivered' });
    expect(r.status).toBe(200);
    expect(mockStripe.paymentIntents.capture).toHaveBeenCalledWith(payment.stripePaymentIntentId);
    expect(mockStripe.transfers.create.mock.calls[0][0]).toMatchObject({ amount: 98000, destination: 'acct_d1' });
    expect(await Payment.findById(payment._id)).toMatchObject({ status: 'released', stripeTransferId: 'tr_d1' });
    expect(await Invoice.countDocuments({ loadId: load._id })).toBe(1);
  });

  test('nothing is charged or recorded when the carrier cannot be paid, or when the charge fails', async () => {
    const a = await heldLoad();
    expect(await settleOnDelivery(a.load._id)).toMatchObject({ settled: false, reason: 'no_payout_account' });
    expect(mockStripe.paymentIntents.capture).not.toHaveBeenCalled();
    expect((await Payment.findById(a.payment._id)).status).toBe('in_escrow');

    const b = await heldLoad();
    await User.updateOne({ _id: b.carrier._id }, { $set: { 'stripe.connectAccountId': 'acct_d2' } });
    mockStripe.paymentIntents.capture.mockRejectedValueOnce(new Error('card hold expired'));
    expect(await settleOnDelivery(b.load._id)).toMatchObject({ settled: false, reason: 'capture_failed' });
    expect((await Payment.findById(b.payment._id)).status).toBe('in_escrow');
    expect(await Invoice.countDocuments({ loadId: b.load._id })).toBe(0);
  });
});

describe('carrier vetting', () => {
  const fmcsa = (dot, extra = {}) => axios.get.mockResolvedValueOnce({ data: { content: { carrier: { dotNumber: dot, legalName: 'Test Carrier', allowedToOperate: 'Y', statusCode: 'A', ...extra } } } });
  const suspended = (reason) => createTestUser({ role: 'carrier', fleet: [{ truckId: 'T1' }], verification: { status: 'suspended', suspensionReason: reason, insurance: { status: 'valid' } } });

  test('an FMCSA re-check lifts only a suspension FMCSA caused', async () => {
    const ins = await suspended('insurance');
    fmcsa(1000001);
    await fmcsaService.runFullVerification(ins, undefined, '1000001');
    expect((await User.findById(ins._id)).verification).toMatchObject({ status: 'suspended', suspensionReason: 'insurance' });

    const own = await suspended('fmcsa_unconfirmed');
    fmcsa(1000002);
    await fmcsaService.runFullVerification(own, undefined, '1000002');
    const after = (await User.findById(own._id)).verification;
    expect(after.status).toBe('verified');
    expect(after.suspensionReason).toBeNull();
  });

  test('a suspension with no recorded reason, or for fraud, is never lifted by an FMCSA check and cannot restart verification', async () => {
    const vApp = express();
    vApp.use(express.json());
    vApp.use('/api/verification', require('../../routes/verificationRoutes'));
    let dot = 1000010;
    for (const reason of [null, 'fraud', 'admin_review', 'trust_score']) {
      const c = await suspended(reason);
      dot += 1;
      fmcsa(dot);
      await fmcsaService.runFullVerification(c, undefined, String(dot));
      expect((await User.findById(c._id)).verification.status).toBe('suspended');
      const r = await request(vApp).post('/api/verification/carrier/start').set(bearer(generateToken(c))).send({ dotNumber: String(dot) });
      expect(r.status).toBe(409);
      expect((await User.findById(c._id)).verification.status).toBe('suspended');
    }
    axios.get.mockReset();
  });

  test('a suspended carrier cannot book while its re-check is pending, even when the lookup keeps failing', async () => {
    const c = await suspended('fmcsa_authority');
    axios.get.mockRejectedValue(new Error('FMCSA down'));
    await fmcsaService.runFullVerification(c, undefined, '1000003');
    axios.get.mockReset();
    const now = await User.findById(c._id);
    expect(now.verification.status).toBe('pending');
    expect(verificationService.canAcceptLoads(now).allowed).toBe(false);
    // a carrier that was never suspended is not caught by this rule
    const clean = await createTestUser({ role: 'carrier', fleet: [{ truckId: 'T1' }], verification: { status: 'pending', insurance: { status: 'valid' } } });
    expect(verificationService.canAcceptLoads(clean).reasons.some((r) => /suspended/i.test(r))).toBe(false);
  }, 20000);

  test('for-hire authority: read from the record, and required only when the load crosses a state line', () => {
    const norm = (c) => fmcsaService.normalizeCarrierData({ content: { carrier: c } }).forHireAuthority;
    expect(norm({ commonAuthorityStatus: 'A', contractAuthorityStatus: 'N' })).toBe('active');
    expect(norm({ commonAuthorityStatus: 'N', contractAuthorityStatus: 'I' })).toBe('none');
    expect(norm({ dotNumber: 5 })).toBe('unknown');
    const carrier = (a) => ({ verification: { fmcsaData: { forHireAuthority: a } } });
    const reasons = (o, d, a) => checkLoadEligibility({ load: { origin: o, destination: d }, carrier: carrier(a) }).reasons;
    expect(reasons('Dallas, TX', 'Tulsa, OK', 'none')).toHaveLength(1);
    expect(reasons('Dallas, TX', 'Austin, TX', 'none')).toHaveLength(0);
    expect(reasons('Dallas, TX', 'Tulsa, OK', 'unknown')).toHaveLength(0);
    expect(reasons('Dallas, TX', 'Tulsa, OK', 'active')).toHaveLength(0);
  });

  test('a hazmat load needs the endorsement on the named driver, not only on the company', () => {
    const carrier = { carrierEndorsements: ['hazmat'] };
    const load = { origin: 'a', destination: 'b', hazardousMaterial: true };
    expect(checkLoadEligibility({ load, carrier }).eligible).toBe(true); // no driver named yet
    expect(checkLoadEligibility({ load, carrier, driver: { endorsements: [] } }).reasons).toEqual(['This driver does not hold a hazmat endorsement']);
    expect(checkLoadEligibility({ load, carrier, driver: { endorsements: ['hazmat'], hazmatExpiry: new Date(Date.now() - 86400000) } }).eligible).toBe(false);
    expect(checkLoadEligibility({ load, carrier, driver: { endorsements: ['hazmat'], hazmatExpiry: new Date(Date.now() + 86400000) } }).eligible).toBe(true);
  });
});

describe('driver logins', () => {
  test('a driver cannot book, bid, cancel or assign for the company; a dispatcher is not blocked by this rule', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const owner = await createTestUser({ role: 'carrier' });
    const as = async (companyRole) => {
      const u = await createTestUser({ role: 'carrier', companyRole, parentAccountId: owner._id });
      return jwt.sign({ userId: String(u._id), role: 'carrier', companyRole, companyOwnerId: String(owner._id) }, process.env.JWT_SECRET, { expiresIn: '1d' });
    };
    const driver = await as('driver');
    const dispatcher = await as('dispatcher');
    const open = await createTestLoad(shipper._id, { status: 'open' });
    const booked = await createTestLoad(shipper._id, { status: 'accepted', acceptedBy: owner._id });
    const blocked = /Drivers cannot perform this management action/;

    const tries = (t) => Promise.all([
      request(app).put(`/api/loads/${open._id}/accept`).set(bearer(t)),
      request(app).put(`/api/loads/${booked._id}/assign-driver`).set(bearer(t)).send({ driverId: 'x' }),
      request(app).post('/api/bids').set(bearer(t)).send({ loadId: String(open._id), amount: 900 }),
      request(app).put('/api/users/fleet/T1/assign-load').set(bearer(t)).send({ loadId: String(open._id) }),
      request(app).put(`/api/loads/${booked._id}/cancel`).set(bearer(t)).send({ reason: 'changed my mind' }),
    ]);
    for (const r of await tries(driver)) { expect(r.status).toBe(403); expect(r.body.error).toMatch(blocked); }
    expect((await Load.findById(booked._id)).status).toBe('accepted');
    for (const r of await tries(dispatcher)) expect(r.body.error || '').not.toMatch(blocked);
  });
});

test('a driver login can report a problem and log a reefer temperature on its company load; an outsider cannot', async () => {
  const side = express();
  side.use(express.json());
  side.use('/api/exceptions', require('../../routes/exceptionRoutes'));
  side.use('/api/reefer', require('../../routes/reeferRoutes'));
  const shipper = await createTestUser({ role: 'shipper' });
  const owner = await createTestUser({ role: 'carrier' });
  const d = await createTestUser({ role: 'carrier', companyRole: 'driver', parentAccountId: owner._id });
  const driver = jwt.sign({ userId: String(d._id), role: 'carrier', companyRole: 'driver', companyOwnerId: String(owner._id) }, process.env.JWT_SECRET, { expiresIn: '1d' });
  const outsider = generateToken(await createTestUser({ role: 'carrier' }));
  const load = await createTestLoad(shipper._id, { status: 'in-transit', acceptedBy: owner._id });
  const problem = { loadId: String(load._id), type: 'delay', title: 'Flat tyre', description: 'Waiting for road service on I-40.' };

  expect((await request(side).post('/api/exceptions').set(bearer(outsider)).send(problem)).status).toBe(403);
  expect((await request(side).post('/api/exceptions').set(bearer(driver)).send(problem)).status).toBeLessThan(300);
  expect((await request(side).post(`/api/reefer/readings/${load._id}`).set(bearer(outsider)).send({ tempF: 36 })).status).toBe(403);
  expect((await request(side).post(`/api/reefer/readings/${load._id}`).set(bearer(driver)).send({ tempF: 36 })).status).toBeLessThan(300);
  expect((await request(side).post(`/api/reefer/readings/${load._id}`).set(bearer(generateToken(owner))).send({ tempF: 37 })).status).toBeLessThan(300);
});

test('a driver login is tied to the roster, is told when a load is assigned, and sees its own loads plus unassigned ones', async () => {
  const Notification = require('../../models/Notification');
  const driverLink = require('../../services/driverLink');
  const shipper = await createTestUser({ role: 'shipper' });
  const owner = await createTestUser({ role: 'carrier', drivers: [{ driverId: 'drv_ann', name: 'Ann  Lee' }, { driverId: 'drv_bob', name: 'Bob Ray' }] });
  const ownerTok = generateToken(owner);
  const mk = async (name, email) => (await request(app).post('/api/users/team').set(bearer(ownerTok)).send({ name, email, password: 'Temp12345!', companyRole: 'driver' })).body.member;
  const ann = await mk('ann lee', 'ann@fleet.test');       // same name as a roster entry: linked to it
  const cy = await mk('Cy New', 'cy@fleet.test');          // no roster entry: one is added
  const roster = (await User.findById(owner._id)).drivers;
  expect(String(roster.find((d) => d.driverId === 'drv_ann').loginUserId)).toBe(String(ann._id));
  expect(roster.find((d) => d.name === 'Cy New').loginUserId).toBeTruthy();
  expect(roster).toHaveLength(3);
  expect(String(await driverLink.loginForDriver(owner._id, roster.find((d) => d.driverId === 'drv_ann')))).toBe(String(ann._id));

  const mine = await createTestLoad(shipper._id, { status: 'accepted', acceptedBy: owner._id, title: 'Mine' });
  const bobs = await createTestLoad(shipper._id, { status: 'accepted', acceptedBy: owner._id, title: 'Bobs', assignedDriverId: 'drv_bob' });
  const pool = await createTestLoad(shipper._id, { status: 'accepted', acceptedBy: owner._id, title: 'Pool' });
  const assign = await request(app).put(`/api/loads/${mine._id}/assign-driver`).set(bearer(ownerTok)).send({ driverId: 'drv_ann' });
  expect(assign.status).toBe(200);
  await new Promise((r) => setTimeout(r, 300));
  const notes = await Notification.find({ userId: ann._id, type: 'load:assigned_to_you' });
  expect(notes).toHaveLength(1);
  expect(notes[0].body).toMatch(/Mine/);

  await User.updateOne({ _id: ann._id }, { $set: { mustChangePassword: false } }); // she has set her own password
  const annTok = jwt.sign({ userId: String(ann._id), role: 'carrier', companyRole: 'driver', companyOwnerId: String(owner._id) }, process.env.JWT_SECRET, { expiresIn: '1d' });
  const seen = (await request(app).get('/api/loads/my-loads').set(bearer(annTok))).body.map((l) => l.title).sort();
  expect(seen).toEqual(['Mine', 'Pool']);
  expect((await request(app).get('/api/loads/my-loads').set(bearer(ownerTok))).body).toHaveLength(3);
  expect(String(bobs._id)).toBeTruthy(); expect(String(pool._id)).toBeTruthy(); expect(cy._id).toBeTruthy();
});
