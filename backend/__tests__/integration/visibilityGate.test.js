/**
 * Integration: first-look/private visibility is enforced on EVERY booking path
 * (via bookingGuard.evaluateBookingGate), on match notifications and on digests;
 * plus FMCSA verification rejects a lookup that resolves to a different DOT.
 */
require('../setup');
const express = require('express');
const request = require('supertest');

const mockSendMail = jest.fn().mockResolvedValue({});
jest.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: (...a) => mockSendMail(...a) }) }));
jest.mock('axios');
const axios = require('axios');

const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const PreferredCarrier = require('../../models/PreferredCarrier');
const Bid = require('../../models/Bid');
const Load = require('../../models/Load');
const User = require('../../models/User');
const { evaluateBookingGate } = require('../../services/bookingGuard');
const { findMatchesForLoad } = require('../../services/matchingService');
const { runDigest } = require('../../jobs/loadAlertDigest');
const fmcsa = require('../../services/fmcsaService');

const bearer = (u) => ({ Authorization: `Bearer ${generateToken(u)}` });
const verified = (o = {}) => createTestUser({
  role: 'carrier',
  verification: { status: 'verified', identityVerified: true, insurance: { status: 'valid' } },
  fleet: [{ truckId: 'T1', status: 'Available', available: true }],
  preferences: { equipmentTypes: ['Dry Van'] },
  ...o,
});

describe('visibility on booking paths', () => {
  let app, shipper, pref, other;
  beforeEach(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/users', require('../../routes/userRoutes'));
    app.use('/api/bids', require('../../routes/bidRoutes'));
    shipper = await createTestUser({ role: 'shipper' });
    pref = await verified();
    other = await verified();
    await PreferredCarrier.create({ shipper: shipper._id, carrier: pref._id });
  });

  for (const vis of ['private', 'preferred']) {
    test(`assign-load: non-preferred carrier gets 404 on a ${vis} load, preferred books it`, async () => {
      const load = await createTestLoad(shipper._id, { loadVisibility: vis });
      const r = await request(app).put('/api/users/fleet/T1/assign-load').set(bearer(other)).send({ loadId: String(load._id) });
      expect(r.status).toBe(404);
      expect((await Load.findById(load._id)).acceptedBy).toBeFalsy();
      const ok = await request(app).put('/api/users/fleet/T1/assign-load').set(bearer(pref)).send({ loadId: String(load._id) });
      expect(ok.status).toBe(200);
      expect(String((await Load.findById(load._id)).acceptedBy)).toBe(String(pref._id));
    });
  }

  test('assign-load: public load unchanged', async () => {
    const load = await createTestLoad(shipper._id);
    const r = await request(app).put('/api/users/fleet/T1/assign-load').set(bearer(other)).send({ loadId: String(load._id) });
    expect(r.status).toBe(200);
  });

  test('bid accept is denied (gate) when the load became private after the bid', async () => {
    const load = await createTestLoad(shipper._id);
    const bid = await Bid.create({ loadId: load._id, carrierId: other._id, amount: 2000, status: 'pending', history: [{ actor: 'carrier', action: 'placed', amount: 2000 }] });
    await Load.updateOne({ _id: load._id }, { $set: { loadVisibility: 'private' } });
    const r = await request(app).put(`/api/bids/${bid._id}/accept`).set(bearer(shipper));
    expect(r.status).toBe(403);
    expect((await Load.findById(load._id)).acceptedBy).toBeFalsy();
  });

  test('evaluateBookingGate itself reports notVisible (covers auto-dispatch)', async () => {
    const load = await createTestLoad(shipper._id, { loadVisibility: 'private' });
    expect(await evaluateBookingGate({ load, carrierId: other._id })).toMatchObject({ allowed: false, notVisible: true });
    expect((await evaluateBookingGate({ load, carrierId: pref._id })).notVisible).toBeUndefined();
  });
});

describe('visibility on match notifications and digests', () => {
  let shipper, pref, other;
  beforeEach(async () => {
    mockSendMail.mockClear();
    process.env.EMAIL_USER = 'x@example.com';
    process.env.EMAIL_PASS = 'x';
    shipper = await createTestUser({ role: 'shipper' });
    pref = await verified();
    other = await verified();
    await PreferredCarrier.create({ shipper: shipper._id, carrier: pref._id });
  });
  const ids = (m) => m.map(({ carrier }) => String(carrier._id));

  test('findMatchesForLoad: private and fresh preferred loads only match preferred carriers; public matches all', async () => {
    for (const vis of ['private', 'preferred']) {
      const load = await createTestLoad(shipper._id, { loadVisibility: vis });
      const got = ids(await findMatchesForLoad(load._id));
      expect(got).toContain(String(pref._id));
      expect(got).not.toContain(String(other._id));
    }
    const pub = await createTestLoad(shipper._id);
    expect(ids(await findMatchesForLoad(pub._id))).toEqual(expect.arrayContaining([String(pref._id), String(other._id)]));
    const aged = await createTestLoad(shipper._id, { loadVisibility: 'preferred', createdAt: new Date(Date.now() - 3 * 3600000) });
    expect(ids(await findMatchesForLoad(aged._id))).toContain(String(other._id));
  });

  test('a sub-account of a preferred company is matched via its company', async () => {
    const sub = await verified({ parentAccountId: pref._id });
    const load = await createTestLoad(shipper._id, { loadVisibility: 'private' });
    expect(ids(await findMatchesForLoad(load._id))).toContain(String(sub._id));
  });

  test('digest: private/fresh-preferred loads reach only the preferred carrier; public reaches both', async () => {
    await createTestLoad(shipper._id, { loadVisibility: 'private', origin: 'Secret, IL' });
    await createTestLoad(shipper._id, { loadVisibility: 'preferred', origin: 'Early, IL' });
    await runDigest();
    const sent = mockSendMail.mock.calls.map(([m]) => m);
    const to = (u) => sent.filter((m) => m.to === u.email);
    expect(to(pref)).toHaveLength(1);
    expect(to(pref)[0].html).toMatch(/Secret, IL/);
    expect(to(other)).toHaveLength(0);

    mockSendMail.mockClear();
    await require('../../models/AlertPreference').deleteMany({});
    await createTestLoad(shipper._id, { origin: 'Public, IL' });
    await runDigest();
    const sent2 = mockSendMail.mock.calls.map(([m]) => m);
    const o = sent2.find((m) => m.to === other.email);
    expect(o.html).toMatch(/Public, IL/);
    expect(o.html).not.toMatch(/Secret, IL|Early, IL/);
  });
});

describe('FMCSA verification checks the returned record against the submitted number', () => {
  const record = (c) => ({ data: { content: { carrier: { legalName: 'Real LLC', allowedToOperate: 'Y', statusCode: 'A', ...c } } } });
  beforeEach(() => { process.env.FMCSA_API_KEY = 'k'; axios.get.mockReset(); });

  test('matching DOT: verified, FMCSA-returned DOT stored in fmcsaData', async () => {
    axios.get.mockResolvedValue(record({ dotNumber: 1000001 }));
    const user = await createTestUser({ role: 'carrier', verification: { status: 'pending' } });
    const r = await fmcsa.runFullVerification(user, undefined, '1000001');
    expect(r.success).toBe(true);
    const fresh = await User.findById(user._id);
    expect(fresh.verification.status).toBe('verified');
    expect(fresh.verification.fmcsaData.dotNumber).toBe('1000001');
    expect(fresh.verification.fmcsaData.mcNumber).toBeFalsy();
  });

  test('different DOT returned: rejected, nothing from the record stored', async () => {
    axios.get.mockResolvedValue(record({ dotNumber: 2000002 }));
    const user = await createTestUser({ role: 'carrier', verification: { status: 'pending' } });
    const r = await fmcsa.runFullVerification(user, undefined, '1000009');
    expect(r.success).toBe(false);
    const fresh = await User.findById(user._id);
    expect(fresh.verification.status).toBe('rejected');
    expect(fresh.verification.fmcsaData.legalName).toBeUndefined();
    expect(fresh.verification.fmcsaData.dotNumber).toBeUndefined();
  });

  test('re-verify clears numbers the new lookup did not confirm', async () => {
    const user = await createTestUser({ role: 'carrier', verification: { status: 'verified', fmcsaData: { legalName: 'Old', dotNumber: '3000003', mcNumber: '123' } } });
    axios.get.mockResolvedValue(record({ dotNumber: 3000003 }));
    await fmcsa.runFullVerification(user, undefined, '3000003');
    const fresh = await User.findById(user._id);
    expect(fresh.verification.fmcsaData.dotNumber).toBe('3000003');
    expect(fresh.verification.fmcsaData.mcNumber).toBeFalsy();
  });
});
