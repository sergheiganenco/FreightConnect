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

  const carrierUser = () => createTestUser({ role: 'carrier', verification: { status: 'pending' } });

  test('FMCSA record with no DOT number never verifies (fails closed)', async () => {
    axios.get.mockResolvedValue(record({ dotNumber: undefined }));
    const user = await carrierUser();
    const r = await fmcsa.runFullVerification(user, undefined, '4000004');
    expect(r.success).toBe(false);
    expect((await User.findById(user._id)).verification.status).toBe('rejected');
  });

  test.each(['12a45', '123456789', '', '  ', '12 34', '1e5'])('DOT %j is rejected before any HTTP call', async (bad) => {
    const user = await carrierUser();
    const r = await fmcsa.runFullVerification(user, undefined, bad);
    expect(r.success).toBe(false);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test.each(['MC-', 'MCX123', '123456789', '12/../3', ''])('MC %j is rejected before any HTTP call', async (bad) => {
    const user = await carrierUser();
    const r = await fmcsa.runFullVerification(user, bad, undefined);
    expect(r.success).toBe(false);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('MC "MC-500001", "mc 500002", "500003" normalise; the URL carries only the digits', async () => {
    axios.get.mockResolvedValue(record({ dotNumber: 5000005 }));
    for (const [input, digits] of [['MC-500001', '500001'], ['mc 500002', '500002'], ['500003', '500003']]) {
      const r = await fmcsa.runFullVerification(await carrierUser(), input, undefined);
      expect(r.success).toBe(true);
      expect(axios.get.mock.calls.pop()[0]).toBe(`https://mobile.fmcsa.dot.gov/qc/services/carriers/docket-number/${digits}?webKey=k`);
    }
  });

  test('MC-only lookup: FMCSA-returned DOT is stored; MC unconfirmed when FMCSA returns none', async () => {
    axios.get.mockResolvedValue(record({ dotNumber: 5000010 }));
    const user = await carrierUser();
    expect((await fmcsa.runFullVerification(user, 'MC-500010')).success).toBe(true);
    const fresh = await User.findById(user._id);
    expect(fresh.verification.dotNumber).toBe('5000010');
    expect(fresh.verification.mcNumber).toBeFalsy();
    expect(fresh.verification.fmcsaData.mcNumber).toBeFalsy();
  });

  test('MC returned by FMCSA is compared; a different one is rejected', async () => {
    axios.get.mockResolvedValue(record({ dotNumber: 5000011, mcNumber: '999' }));
    const user = await carrierUser();
    expect((await fmcsa.runFullVerification(user, '500011', undefined)).success).toBe(false);
    axios.get.mockResolvedValue(record({ dotNumber: 5000012, mcNumber: '500012' }));
    const u2 = await carrierUser();
    expect((await fmcsa.runFullVerification(u2, '500012', undefined)).success).toBe(true);
    expect((await User.findById(u2._id)).verification.mcNumber).toBe('500012');
  });

  test('leading zeros typed by the user: stored DOT is the FMCSA value', async () => {
    axios.get.mockResolvedValue(record({ dotNumber: 600006 }));
    const user = await carrierUser();
    expect((await fmcsa.runFullVerification(user, undefined, '00600006')).success).toBe(true);
    const fresh = await User.findById(user._id);
    expect(fresh.verification.dotNumber).toBe('600006');
    expect(fresh.verification.fmcsaData.dotNumber).toBe('600006');
  });

  test('QCMobile array-shaped content: single carrier unwrapped, several fail closed', async () => {
    const carrier = { legalName: 'Real LLC', allowedToOperate: 'Y', statusCode: 'A', dotNumber: 7000007 };
    axios.get.mockResolvedValue({ data: { content: [{ carrier }] } });
    const ok = await carrierUser();
    expect((await fmcsa.runFullVerification(ok, '700007')).success).toBe(true);
    expect((await User.findById(ok._id)).verification.dotNumber).toBe('7000007');

    axios.get.mockResolvedValue({ data: { content: [{ carrier }, { carrier: { ...carrier, dotNumber: 7000008 } }] } });
    const amb = await carrierUser();
    expect((await fmcsa.runFullVerification(amb, '700008')).success).toBe(false);
    expect((await User.findById(amb._id)).verification.status).toBe('rejected');
  });

  test('production with no FMCSA_API_KEY does not verify', async () => {
    const env = process.env.NODE_ENV;
    delete process.env.FMCSA_API_KEY;
    process.env.NODE_ENV = 'production';
    try {
      const user = await carrierUser();
      const r = await fmcsa.runFullVerification(user, undefined, '8000008');
      expect(r.success).toBe(false);
      expect(axios.get).not.toHaveBeenCalled();
      expect((await User.findById(user._id)).verification.status).not.toBe('verified');
    } finally { process.env.NODE_ENV = env; }
  });
});

describe('deactivated / suspended carriers get no load details', () => {
  let shipper, ok, inactive, inactiveSub, inactiveOwnerSub, suspended, rejected;
  const ids = (m) => m.map(({ carrier }) => String(carrier._id));
  beforeEach(async () => {
    mockSendMail.mockClear();
    process.env.EMAIL_USER = 'x@example.com';
    process.env.EMAIL_PASS = 'x';
    shipper = await createTestUser({ role: 'shipper' });
    ok = await verified();
    inactive = await verified({ active: false });
    inactiveSub = await verified({ parentAccountId: ok._id, active: false });
    const deadOwner = await verified({ active: false });
    inactiveOwnerSub = await verified({ parentAccountId: deadOwner._id });
    suspended = await verified({ verification: { status: 'suspended', insurance: { status: 'valid' } } });
    rejected = await verified({ verification: { status: 'rejected', insurance: { status: 'valid' } } });
  });
  const bad = () => [inactive, inactiveSub, inactiveOwnerSub, suspended, rejected].map((u) => String(u._id));

  test('findMatchesForLoad (public load) only returns the active carrier', async () => {
    const load = await createTestLoad(shipper._id);
    const got = ids(await findMatchesForLoad(load._id));
    expect(got).toContain(String(ok._id));
    for (const id of bad()) expect(got).not.toContain(id);
  });

  test('digest (public load) is emailed only to the active carrier', async () => {
    await createTestLoad(shipper._id, { origin: 'Everyone, IL' });
    await runDigest();
    const to = mockSendMail.mock.calls.map(([m]) => m.to);
    expect(to).toContain(ok.email);
    for (const u of [inactive, inactiveSub, inactiveOwnerSub, suspended, rejected]) expect(to).not.toContain(u.email);
  });

  test('filterCarriersWhoCanSee (auto-dispatch pool) drops deactivated ones even for public loads; keeps the active one', async () => {
    const { filterCarriersWhoCanSee } = require('../../services/loadVisibility');
    const load = (await createTestLoad(shipper._id)).toObject();
    const all = await User.find({ role: 'carrier' }).lean();
    const got = (await filterCarriersWhoCanSee(load, all)).map((c) => String(c._id));
    expect(got).toContain(String(ok._id));
    for (const id of [inactive, inactiveSub, inactiveOwnerSub].map((u) => String(u._id))) expect(got).not.toContain(id);
  });
});
