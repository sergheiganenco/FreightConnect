/**
 * Integration: every path that creates a posted load meets the bar POST /loads sets (services/loadPostingService):
 * shipper posting gate, geocoding of typed places, stored road distance. Also: a load without coordinates is
 * never offered to carriers. Nominatim (node-fetch) and ORS (axios) are mocked; no network.
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const axios = require('axios');
const Load = require('../../models/Load');
const EDIDocument = require('../../models/EDIDocument');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const { createPostedLoad, makeGeocodeBudget } = require('../../services/loadPostingService');

jest.mock('axios');
jest.mock('node-fetch');
const fetch = require('node-fetch');

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {} };
const app = express();
app.use(express.json());
app.use('/api/loads', require('../../routes/loadRoutes')(mockIo));
app.use('/api/edi', require('../../routes/ediRoutes'));
app.use('/api/enterprise', require('../../routes/enterpriseRoutes'));

const hit = (lat, lon) => ({ ok: true, json: async () => [{ lat: String(lat), lon: String(lon) }] });
const miss = { ok: true, json: async () => [] };
const ors = (meters) => ({ data: { features: [{ geometry: { coordinates: [[-87.6, 41.8], [-96.8, 32.7]] }, properties: { segments: [{ distance: meters, duration: 36000 }] } }] } });
const bearer = (u) => ({ Authorization: `Bearer ${generateToken(u)}` });
const VERIFIED = { status: 'verified', paymentMethodVerified: true };
const GATE_MSG = /Add a payment method before posting loads/;

describe('load creation paths share the posting bar', () => {
  let shipper;
  const ediDoc = (s = shipper) => EDIDocument.create({
    direction: 'inbound', type: '204', rawContent: 'x', status: 'parsed', shipper: s._id,
    parsedData: { origin: { city: 'Chicago', state: 'IL' }, destination: { city: 'Dallas', state: 'TX' }, references: [], totalChargesCents: 250000 },
  });
  const create = (doc, s = shipper, b = {}) => request(app).post(`/api/edi/${doc._id}/create-load`).set(bearer(s)).send(b);

  beforeEach(async () => {
    fetch.mockReset();
    axios.get.mockReset();
    process.env.REQUIRE_SHIPPER_PAYMENT_METHOD = 'true'; // as when payments are switched on
    process.env.ORS_API_KEY = 'test-key';
    shipper = await createTestUser({ role: 'shipper', shipperVerification: VERIFIED });
  });

  describe('EDI create-load', () => {
    test('refused with the same status and message as POST /loads when the shipper fails the gate; the claim is released', async () => {
      const unverified = await createTestUser({ role: 'shipper' });
      const doc = await ediDoc(unverified);
      const edi = await create(doc, unverified);
      const form = await request(app).post('/api/loads').set(bearer(unverified))
        .send({ title: 'T', origin: 'Austin, TX', destination: 'Denver, CO', rate: 100, equipmentType: 'Dry Van' });
      expect(edi.status).toBe(403);
      expect(form.status).toBe(403);
      expect(edi.body.error).toBe(form.body.error);
      expect(edi.body.error).toMatch(GATE_MSG);
      expect(edi.body.missingStep).toBe('payment_method');
      expect(await Load.countDocuments({ postedBy: unverified._id })).toBe(0);
      expect((await EDIDocument.findById(doc._id)).status).toBe('parsed');

      // once the shipper adds a payment method the same document works
      await require('../../models/User').updateOne({ _id: unverified._id }, { $set: { shipperVerification: VERIFIED } });
      fetch.mockResolvedValueOnce(hit(41.88, -87.63)).mockResolvedValueOnce(hit(32.78, -96.8));
      expect((await create(doc, unverified)).status).toBe(201);
    });

    test('a suspended shipper is refused even when REQUIRE_SHIPPER_PAYMENT_METHOD=false', async () => {
      process.env.REQUIRE_SHIPPER_PAYMENT_METHOD = 'false';
      const suspended = await createTestUser({ role: 'shipper', shipperVerification: { status: 'suspended', paymentMethodVerified: true } });
      const res = await create(await ediDoc(suspended), suspended);
      expect(res.status).toBe(403);
      expect(res.body.verificationStatus).toBe('suspended');
    });

    test('typed places are geocoded and the road distance is stored', async () => {
      fetch.mockResolvedValueOnce(hit(41.8781, -87.6298)).mockResolvedValueOnce(hit(32.7767, -96.797));
      axios.get.mockResolvedValue(ors(1500000));
      const res = await create(await ediDoc());
      expect(res.status).toBe(201);
      expect(res.body.needsLocation).toBeUndefined();
      const load = await Load.findById(res.body.load._id);
      expect(load.originLat).toBeCloseTo(41.8781);
      expect(load.destinationLng).toBeCloseTo(-96.797);
      expect(load.distanceMiles).toBe(932.1);
      expect(load.distanceSource).toBe('ors');
      expect(load.rateCents).toBe(250000);
    });

    test('an unknown place is a 400 and the document claim is released so a retry works', async () => {
      const doc = await ediDoc();
      fetch.mockResolvedValueOnce(miss).mockResolvedValueOnce(hit(32.7767, -96.797));
      const bad = await create(doc);
      expect(bad.status).toBe(400);
      expect(bad.body.error).toMatch(/couldn't find the pickup location "Chicago, IL"/);
      expect(await Load.countDocuments({ postedBy: shipper._id })).toBe(0);
      expect((await EDIDocument.findById(doc._id)).status).toBe('parsed');

      // retry with a corrected origin supplied (coordinates given => no lookup needed for it)
      fetch.mockReset();
      fetch.mockResolvedValueOnce(hit(32.7767, -96.797));
      const ok = await create(doc, shipper, { originLat: 41.8781, originLng: -87.6298 });
      expect(ok.status).toBe(201);
      expect((await EDIDocument.findById(doc._id)).status).toBe('load_created');
    });

    test('a geocoder outage still posts, flagged needsLocation', async () => {
      fetch.mockRejectedValue(new Error('network down'));
      const res = await create(await ediDoc());
      expect(res.status).toBe(201);
      expect(res.body.needsLocation).toBe(true);
    });
  });

  describe('enterprise bulk create', () => {
    const base = { title: 'B', origin: 'Austin, TX', destination: 'Denver, CO', rate: 1000, equipmentType: 'Dry Van' };
    const bulk = (s, loads) => request(app).post('/api/enterprise/loads/bulk').set(bearer(s)).send({ loads });

    test('refused as a whole when the shipper fails the gate', async () => {
      const unverified = await createTestUser({ role: 'shipper' });
      const res = await bulk(unverified, [base]);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(GATE_MSG);
      expect(await Load.countDocuments({ postedBy: unverified._id })).toBe(0);
    });

    test('geocodes once per distinct place, rejects an unknown place per item, keeps the per-item contract', async () => {
      fetch.mockImplementation(async (url) => (url.includes('Nowhere') ? miss : hit(30.2672, -97.7431)));
      axios.get.mockResolvedValue(ors(1500000));
      const res = await bulk(shipper, [base, { ...base, title: 'C' }, { ...base, title: 'D', origin: 'Nowhere, ZZ' }]);
      expect(res.status).toBe(201);
      expect(res.body.created.map((c) => c.index)).toEqual([0, 1]);
      expect(res.body.errors).toHaveLength(1);
      expect(res.body.errors[0]).toMatchObject({ index: 2, title: 'D' });
      expect(res.body.errors[0].error).toMatch(/couldn't find the pickup location "Nowhere, ZZ"/);
      expect(res.body.summary).toEqual({ total: 3, created: 2, failed: 1 });
      const load = await Load.findById(res.body.created[0].id);
      expect(load.originLat).toBeCloseTo(30.2672);
      expect(load.rateCents).toBe(100000);
      expect(String(load.postedBy)).toBe(String(shipper._id));
      // Austin and Denver were each looked up once for the two good loads (+ Nowhere): 3 provider calls, not 6
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    test('loads left without coordinates are created but flagged needsLocation', async () => {
      fetch.mockRejectedValue(new Error('network down'));
      const res = await bulk(shipper, [base]);
      expect(res.status).toBe(201);
      expect(res.body.created[0].needsLocation).toBe(true);
    });

    test('supplied coordinates are used without any lookup', async () => {
      const res = await bulk(shipper, [{ ...base, originLat: 30.27, originLng: -97.74, destinationLat: 39.74, destinationLng: -104.99 }]);
      expect(res.status).toBe(201);
      expect(res.body.created[0].needsLocation).toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('email import (enterprise parse, create=true)', () => {
    test('is gated like a form post', async () => {
      const unverified = await createTestUser({ role: 'shipper' });
      const res = await request(app).post('/api/enterprise/loads/parse').set(bearer(unverified))
        .send({ text: 'Austin, TX to Denver, CO dry van $1800', create: true, engine: 'heuristic' });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(GATE_MSG);
    });
  });

  describe('geocode time budget', () => {
    test('once the budget is spent no lookup is made and the load is flagged needsLocation', async () => {
      const r = await createPostedLoad({
        shipperCompanyId: shipper._id, options: { gate: false, geocodeBudget: makeGeocodeBudget(0) },
        fields: { title: 'T', origin: 'Austin, TX', destination: 'Denver, CO', rate: 100, equipmentType: 'Dry Van' },
      });
      expect(r.load).toBeTruthy();
      expect(r.needsLocation).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('a load without coordinates is not offered to carriers', () => {
    test('hidden from the board, /open and match lists; visible once it has coordinates; accept still refuses it', async () => {
      const carrier = await createTestUser({ role: 'carrier' });
      const noCoords = await createTestLoad(shipper._id, { title: 'No coords', originLat: undefined, originLng: undefined, destinationLat: undefined, destinationLng: undefined });
      const located = await createTestLoad(shipper._id, { title: 'Located' });
      const titles = (r) => r.body.map((l) => l.title).sort();

      expect(titles(await request(app).get('/api/loads').set(bearer(carrier)))).toEqual(['Located']);
      expect(titles(await request(app).get('/api/loads?status=open').set(bearer(carrier)))).toEqual(['Located']);
      expect(titles(await request(app).get('/api/loads/open').set(bearer(carrier)))).toEqual(['Located']);
      // the shipper still sees both of their own loads
      expect(titles(await request(app).get('/api/loads').set(bearer(shipper)))).toEqual(['Located', 'No coords']);

      const acc = await request(app).put(`/api/loads/${noCoords._id}/accept`).set(bearer(carrier));
      expect(acc.status).toBe(400);
      expect(acc.body.error).toMatch(/missing required location coordinates/);

      await Load.updateOne({ _id: noCoords._id }, { $set: { originLat: 41.8, originLng: -87.6, destinationLat: 32.7, destinationLng: -96.8 } });
      expect(titles(await request(app).get('/api/loads').set(bearer(carrier)))).toEqual(['Located', 'No coords']);
      expect(located).toBeTruthy();
    });
  });
});

describe('createPostedLoad accepts only postable fields', () => {
  test('lifecycle fields supplied by a caller are ignored; the load is always created open and unbooked', async () => {
    const shipper = await createTestUser({ role: 'shipper', shipperVerification: VERIFIED });
    const carrier = await createTestUser({ role: 'carrier' });
    const r = await createPostedLoad({
      shipperCompanyId: shipper._id,
      io: mockIo,
      options: { notify: false },
      fields: {
        title: 'Injected', origin: 'Chicago, IL', destination: 'Dallas, TX', rate: 1000, equipmentType: 'Dry Van',
        originLat: 41.8781, originLng: -87.6298, destinationLat: 32.7767, destinationLng: -96.797,
        // none of these may be set by a caller
        status: 'delivered', acceptedBy: carrier._id, postedBy: carrier._id, deliveredAt: new Date(),
        bookedAt: new Date(), bookedWindow: { start: new Date(), end: new Date() },
        pickupRisk: { level: 'no_show' }, carrierLocation: { latitude: 1, longitude: 1, authenticated: true },
        pickupSignature: { signedAt: new Date(), signerName: 'x' },
        pickupVerification: { required: true, code: '123456', verifiedAt: new Date(), verifiedBy: 'admin' },
        evidenceRequired: { pickup: true, delivery: 'yes' },
        evidence: [{ stage: 'pickup', kind: 'cargo', file: 'x.jpg' }],
        accessorialCharges: [{ type: 'detention', amountCents: 99999, status: 'approved' }],
        distanceMiles: 1, trackingNonce: 'abc',
        stops: [{ type: 'delivery', address: '1 Main St', status: 'departed' }],
      },
    });
    expect(r.load).toBeTruthy();
    const load = await Load.findById(r.load._id).select('+evidence +trackingNonce +pickupVerification.code').lean();
    expect(load.status).toBe('open');
    expect(load.acceptedBy == null).toBe(true);
    expect(String(load.postedBy)).toBe(String(shipper._id));
    expect(load.deliveredAt == null).toBe(true);
    expect(load.bookedAt == null).toBe(true);
    expect(load.bookedWindow?.start == null).toBe(true);
    expect(load.pickupRisk?.level == null).toBe(true);
    expect(load.carrierLocation?.latitude == null).toBe(true);
    expect(load.pickupSignature?.signedAt == null).toBe(true);
    expect(load.pickupVerification.required).toBe(true);
    expect(load.pickupVerification.code == null).toBe(true);
    expect(load.pickupVerification.verifiedAt == null).toBe(true);
    expect(load.evidenceRequired).toMatchObject({ pickup: true, delivery: false });
    expect(load.evidence || []).toHaveLength(0);
    expect(load.accessorialCharges || []).toHaveLength(0);
    expect(load.trackingNonce == null).toBe(true);
    expect(load.distanceMiles).not.toBe(1);
    expect(load.stops[0].status).toBe('pending');
  });
});

describe('posting gate always applies to the company', () => {
  const fields = {
    title: 'Gate', origin: 'Chicago, IL', destination: 'Dallas, TX', rate: 1000, equipmentType: 'Dry Van',
    originLat: 41.8781, originLng: -87.6298, destinationLat: 32.7767, destinationLng: -96.797,
  };

  test('a suspended shipper cannot post even through an internal (gate:false) path', async () => {
    const shipper = await createTestUser({ role: 'shipper', shipperVerification: { status: 'suspended', paymentMethodVerified: true } });
    const r = await createPostedLoad({ shipperCompanyId: shipper._id, io: mockIo, options: { gate: false, notify: false }, fields });
    expect(r.load).toBeUndefined();
    expect(r.status).toBe(403);
    expect(await Load.countDocuments({ postedBy: shipper._id })).toBe(0);
  });

  test('gate:false skips only the payment-method requirement', async () => {
    const shipper = await createTestUser({ role: 'shipper', shipperVerification: { status: 'verified', paymentMethodVerified: false } });
    const withGate = await createPostedLoad({ shipperCompanyId: shipper._id, io: mockIo, options: { notify: false }, fields });
    expect(withGate.status).toBe(403);
    const internal = await createPostedLoad({ shipperCompanyId: shipper._id, io: mockIo, options: { gate: false, notify: false }, fields });
    expect(internal.load).toBeTruthy();
  });

  test('a sub-account id is judged on its company owner, and an inactive company cannot post', async () => {
    const { shipperPostingGate } = require('../../services/loadPostingService');
    const owner = await createTestUser({ role: 'shipper', shipperVerification: { status: 'suspended', paymentMethodVerified: true } });
    const sub = await createTestUser({ role: 'shipper', companyRole: 'dispatcher', parentAccountId: owner._id, shipperVerification: VERIFIED });
    expect((await shipperPostingGate(sub._id)).status).toBe(403);
    const inactive = await createTestUser({ role: 'shipper', active: false, shipperVerification: VERIFIED });
    expect((await shipperPostingGate(inactive._id)).status).toBe(403);
  });

  test('once a bulk budget deadline has passed, no routing call is made', async () => {
    const shipper = await createTestUser({ role: 'shipper', shipperVerification: VERIFIED });
    axios.get.mockReset();
    const budget = makeGeocodeBudget(0); // already expired
    const r = await createPostedLoad({ shipperCompanyId: shipper._id, io: mockIo, options: { notify: false, geocodeBudget: budget }, fields });
    expect(r.load).toBeTruthy();
    expect(axios.get).not.toHaveBeenCalled();
    expect(r.load.distanceMiles == null).toBe(true);
  });
});

describe('place and text bounds at the single posting path', () => {
  const ok = { title: 'T', origin: 'Austin, TX', destination: 'Denver, CO', rate: 100, equipmentType: 'Dry Van', originLat: 30.27, originLng: -97.74, destinationLat: 39.74, destinationLng: -104.99 };
  const item = { title: 'B', origin: 'Austin, TX', destination: 'Denver, CO', rate: 1000, equipmentType: 'Dry Van', originLat: 30.27, originLng: -97.74, destinationLat: 39.74, destinationLng: -104.99 };
  const app2 = express();
  app2.use(express.json());
  app2.use('/api/loads', require('../../routes/loadRoutes')(mockIo));
  app2.use('/api/edi', require('../../routes/ediRoutes'));
  app2.use('/api/enterprise', require('../../routes/enterpriseRoutes'));
  const status = (code) => ({ ok: false, status: code, json: async () => ({}) });
  const plain = { title: 'T', origin: 'Austin, TX', destination: 'Denver, CO', rate: 100, equipmentType: 'Dry Van' };
  let shipper;
  beforeEach(async () => {
    fetch.mockReset(); axios.get.mockReset();
    shipper = await createTestUser({ role: 'shipper', shipperVerification: VERIFIED });
  });

  test.each([
    ['over 200 characters', 'x'.repeat(201)],
    ['a control character', 'Austin\nTX'],
    ['a NUL character', 'Austin\u0000, TX'],
  ])('POST /loads rejects an origin with %s', async (_n, origin) => {
    const res = await request(app2).post('/api/loads').set(bearer(shipper)).send({ ...ok, origin });
    expect(res.status).toBe(400);
    expect(await Load.countDocuments({ postedBy: shipper._id })).toBe(0);
  });

  test('POST /loads rejects an over-long title; exactly 200 characters is accepted', async () => {
    expect((await request(app2).post('/api/loads').set(bearer(shipper)).send({ ...ok, title: 't'.repeat(201) })).status).toBe(400);
    expect((await request(app2).post('/api/loads').set(bearer(shipper)).send({ ...ok, title: 't'.repeat(200), origin: 'o'.repeat(200) })).status).toBe(201);
  });

  test('createPostedLoad rejects non-string, blank and bad places directly', async () => {
    for (const origin of [123, { a: 1 }, ['Austin, TX'], '   ', true]) {
      const r = await createPostedLoad({ shipperCompanyId: shipper._id, options: { notify: false }, fields: { ...ok, origin } });
      expect(r.status).toBe(400);
    }
    const r = await createPostedLoad({ shipperCompanyId: shipper._id, options: { notify: false }, fields: { ...ok, destination: 'D'.repeat(201) } });
    expect(r.status).toBe(400);
    const notes = await createPostedLoad({ shipperCompanyId: shipper._id, options: { notify: false }, fields: { ...ok, notes: 'n'.repeat(2001) } });
    expect(notes.status).toBe(400);
    expect(await Load.countDocuments({ postedBy: shipper._id })).toBe(0);
  });

  test('EDI create-load rejects an over-long place', async () => {
    const doc = await EDIDocument.create({
      direction: 'inbound', type: '204', rawContent: 'x', status: 'parsed', shipper: shipper._id,
      parsedData: { origin: { city: 'C'.repeat(250), state: 'IL' }, destination: { city: 'Dallas', state: 'TX' }, references: [], totalChargesCents: 250000 },
    });
    const res = await request(app2).post(`/api/edi/${doc._id}/create-load`).set(bearer(shipper)).send({});
    expect(res.status).toBe(400);
    expect(await Load.countDocuments({ postedBy: shipper._id })).toBe(0);
  });

  test('bulk reports a bad place per item and still creates the good one', async () => {
    const res = await request(app2).post('/api/enterprise/loads/bulk').set(bearer(shipper)).send({ loads: [
      item, { ...item, origin: 'x'.repeat(201) }, { ...item, destination: 'Den\u0007ver' },
    ] });
    expect(res.status).toBe(201);
    expect(res.body.created.map((c) => c.index)).toEqual([0]);
    expect(res.body.errors.map((e) => e.index)).toEqual([1, 2]);
  });

  test.each([400, 414, 404])('geocoder HTTP %i is "not found": POST /loads answers 400 with the usual message', async (code) => {
    fetch.mockResolvedValue(status(code));
    const res = await request(app2).post('/api/loads').set(bearer(shipper)).send({ ...plain, origin: 'Weird' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/couldn't find the pickup location "Weird"/);
  });

  test.each([429, 500, 503])('geocoder HTTP %i is an outage: the load posts flagged needsLocation', async (code) => {
    fetch.mockResolvedValue(status(code));
    const res = await request(app2).post('/api/loads').set(bearer(shipper)).send(plain);
    expect(res.status).toBe(201);
    expect(res.body.needsLocation).toBe(true);
  });

  test('bulk creation is limited per company (10 requests / 15 min)', async () => {
    const send = (u) => request(app2).post('/api/enterprise/loads/bulk').set(bearer(u)).send({ loads: [item] });
    for (let i = 0; i < 10; i++) expect((await send(shipper)).status).toBe(201);
    expect((await send(shipper)).status).toBe(429);
    const other = await createTestUser({ role: 'shipper', shipperVerification: VERIFIED });
    expect((await send(other)).status).toBe(201);
  });
});

// ───────────────────────── geocoder statuses, spacing, input bounds, caps, limiter parity ─────────────────────────
describe('geocoder status classification at posting', () => {
  const status = (code) => ({ ok: false, status: code, json: async () => ({}) });
  const plain = { title: 'T', origin: 'Austin, TX', destination: 'Denver, CO', rate: 100, equipmentType: 'Dry Van' };
  let shipper;
  beforeEach(async () => {
    fetch.mockReset(); axios.get.mockReset();
    shipper = await createTestUser({ role: 'shipper', shipperVerification: VERIFIED });
  });

  test.each([401, 403, 407, 408, 425, 301])('HTTP %i is an outage (blocked agent/IP, timeout...), NOT "place not found": the load posts with needsLocation', async (code) => {
    fetch.mockResolvedValue(status(code));
    const res = await request(app).post('/api/loads').set(bearer(shipper)).send(plain);
    expect(res.status).toBe(201);
    expect(res.body.needsLocation).toBe(true);
  });

  test.each([400, 404, 414, 422])('HTTP %i is about the query string: refused as "not found"', async (code) => {
    fetch.mockResolvedValue(status(code));
    const res = await request(app).post('/api/loads').set(bearer(shipper)).send(plain);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/couldn't find the pickup location "Austin, TX"/);
  });
});

describe('unbudgeted geocoder lookups are spaced process-wide', () => {
  const { _spacing } = require('../../services/loadPostingService');
  const saved = { ..._spacing };
  const fields = { title: 'T', origin: 'Austin, TX', destination: 'Denver, CO', rate: 100, equipmentType: 'Dry Van' };
  let t; let sleeps; let calls; let shipper;
  beforeEach(async () => {
    fetch.mockReset(); axios.get.mockReset();
    t = 1e12; sleeps = []; calls = [];
    Object.assign(_spacing, { ms: 1100, maxWaitMs: 5000, nextAt: 0, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } });
    fetch.mockImplementation(async () => { calls.push(t); return hit(30.27, -97.74); });
    shipper = await createTestUser({ role: 'shipper', shipperVerification: VERIFIED });
  });
  afterEach(() => Object.assign(_spacing, saved));
  const post = (f = {}) => createPostedLoad({ shipperCompanyId: shipper._id, options: { notify: false }, fields: { ...fields, ...f } });

  test('3 quick single posts (6 lookups) reach the provider at least 1.1 s apart; no wait for the very first', async () => {
    for (let i = 0; i < 3; i++) expect((await post()).load).toBeTruthy();
    expect(calls).toHaveLength(6);
    for (let i = 1; i < calls.length; i++) expect(calls[i] - calls[i - 1]).toBeGreaterThanOrEqual(1100);
    expect(sleeps).toEqual([1100, 1100, 1100, 1100, 1100]);
  });

  test('concurrent posts queue behind each other instead of bursting', async () => {
    await Promise.all([post(), post(), post()]);
    const sorted = [...calls].sort((a, b) => a - b);
    expect(sorted).toHaveLength(6);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(1100);
  });

  test('a lookup that would wait longer than 5 s is not made: the load posts with needsLocation', async () => {
    _spacing.nextAt = t + 5001;
    const r = await post();
    expect(r.load).toBeTruthy();
    expect(r.needsLocation).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(sleeps).toEqual([]);
  });

  test('a wait of exactly the cap (5 s) is still honoured', async () => {
    _spacing.nextAt = t + 5000;
    const r = await post({ originLat: 30.27, originLng: -97.74 }); // only the destination is looked up
    expect(r.needsLocation).toBe(false);
    expect(sleeps).toEqual([5000]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('input bounds on the single posting path', () => {
  const coords = { originLat: 30.27, originLng: -97.74, destinationLat: 39.74, destinationLng: -104.99 };
  const base = { title: 'T', origin: 'Austin, TX', destination: 'Denver, CO', rate: 100, equipmentType: 'Dry Van', ...coords };
  const post = (s, b) => request(app).post('/api/loads').set(bearer(s)).send(b);
  let shipper;
  beforeEach(async () => {
    fetch.mockReset(); axios.get.mockReset();
    shipper = await createTestUser({ role: 'shipper', shipperVerification: VERIFIED });
  });
  const count = () => Load.countDocuments({ postedBy: shipper._id });

  test.each([
    ['an array of long strings in notes', { notes: ['x'.repeat(5000)] }],
    ['an object in notes', { notes: { a: 'b' } }],
    ['a number in poNumber', { poNumber: 12345 }],
    ['an array in commodityType', { commodityType: ['a', 'b'] }],
    ['an object in pickupAddress', { pickupAddress: { street: 'x' } }],
    ['an array title', { title: ['a', 'b'] }],
    ['an object title', { title: { a: 1 } }],
    ['an array equipmentType', { equipmentType: ['Dry Van'] }],
    ['an over-long equipmentType', { equipmentType: 'E'.repeat(101) }],
    ['an array rate', { rate: ['5', '6'] }],
    ['more than 20 specialHandling items', { specialHandling: Array.from({ length: 21 }, (_, i) => `h${i}`) }],
    ['an over-long accessorial', { accessorials: ['a'.repeat(101)] }],
    ['a non-string documentsRequired item', { documentsRequired: [{ a: 1 }] }],
    ['more than 20 stops', { stops: Array.from({ length: 21 }, () => ({ type: 'delivery', address: '1 Main St' })) }],
    ['a bad stop type', { stops: [{ type: 'teleport', address: '1 Main St' }] }],
    ['an object stop type', { stops: [{ type: { a: 1 }, address: '1 Main St' }] }],
    ['an over-long stop address', { stops: [{ type: 'pickup', address: 'a'.repeat(301) }] }],
    ['an array stop contactName', { stops: [{ type: 'pickup', address: '1 Main St', contactName: ['x'] }] }],
    ['over-long stop notes', { stops: [{ type: 'pickup', address: '1 Main St', notes: 'n'.repeat(2001) }] }],
    ['a null stop', { stops: [null] }],
    ['a rate above $1,000,000', { rate: 1000001 }],
    ['a negative weight', { weight: -5 }],
    ['an unparseable weight', { weight: 'heavy' }],
    ['an infinite weight', { weight: 'Infinity' }],
    ['a weight above 500,000 lbs', { weight: 500001 }],
    ['a negative cargo value', { cargoValue: -1 }],
    ['a huge cargo value', { cargoValue: 1e12 }],
    ['a negative insurance requirement', { insuranceRequired: -100 }],
    ['an absurd dimension', { loadLength: 10000000 }],
    ['a reefer temperature below -40 C', { equipmentType: 'Reefer', temperatureMin: -100, temperatureUnit: 'C' }],
    ['a reefer temperature above 40 C', { equipmentType: 'Reefer', temperatureMax: 200, temperatureUnit: 'C' }],
    ['over-long reefer notes', { equipmentType: 'Reefer', reeferNotes: 'r'.repeat(2001) }],
  ])('rejects %s with a 400 and stores nothing', async (_n, extra) => {
    const res = await post(shipper, { ...base, ...extra });
    expect(res.status).toBe(400);
    expect(await count()).toBe(0);
  });

  test('createPostedLoad itself rejects non-finite / non-number values and a malformed reefer, loadDimensions or stops', async () => {
    for (const extra of [
      { loadWeight: NaN }, { loadWeight: Infinity }, { loadWeight: true }, { cargoValue: {} }, { rate: -1 },
      { loadDimensions: 'big' }, { loadDimensions: { length: -1 } }, { loadDimensions: { width: NaN } },
      { reefer: { enabled: true, targetMinC: 'cold' } }, { reefer: { notes: ['x'] } }, { reefer: [1] },
      { stops: 'one' }, { stops: [[]] },
    ]) {
      const r = await createPostedLoad({ shipperCompanyId: shipper._id, options: { notify: false }, fields: { ...base, ...extra } });
      expect([extra, r.status]).toEqual([extra, 400]);
    }
    expect(await count()).toBe(0);
  });

  test('the bound values themselves are accepted', async () => {
    const res = await post(shipper, {
      ...base, rate: 1000000, weight: 500000, cargoValue: 1e9, insuranceRequired: 1e9, overweightAcknowledged: true,
      specialHandling: Array.from({ length: 20 }, () => 'h'.repeat(100)), notes: 'n'.repeat(2000), equipmentType: 'E'.repeat(100),
      stops: Array.from({ length: 20 }, () => ({ type: 'pickup', address: 'a'.repeat(300), contactName: 'c'.repeat(200), contactPhone: 'p'.repeat(50), notes: 'n'.repeat(2000) })),
      equipmentSubtype: 'frozen',
    });
    expect(res.status).toBe(201);
  });

  test('the Load schema itself also refuses over-long text (defence in depth)', async () => {
    const l = new Load({ title: 'T', origin: 'A', destination: 'B', rate: 1, equipmentType: 'Dry Van', notes: 'n'.repeat(2001), postedBy: shipper._id });
    await expect(l.validate()).rejects.toThrow(/notes/);
    const s = new Load({ title: 'T', origin: 'A', destination: 'B', rate: 1, equipmentType: 'Dry Van', specialHandling: ['h'.repeat(101)], postedBy: shipper._id });
    await expect(s.validate()).rejects.toThrow(/specialHandling/);
  });

  // Exactly what ShipperPostLoad.js sends (JSON mode, no file uploads): the whole form state as strings, `weight` not
  // `loadWeight`, temperatures in F, option lists as arrays, stops mapped to { sequence, type, address, timeWindow, ... }.
  test('a payload shaped exactly like the Post Load form (multi-stop + reefer) still posts', async () => {
    const formPayload = {
      title: 'Reefer - Produce - Austin to Denver', commodityType: 'Fresh Produce', commodityCategory: 'Food & Beverage',
      weight: '42000', equipmentType: 'Reefer', equipmentSubtype: 'produce', requiredEndorsements: ['hazmat'],
      origin: 'Austin, TX', pickupWindowStart: '2031-03-10T08:00', pickupWindowEnd: '2031-03-10T12:00',
      destination: 'Denver, CO', deliveryFacilityName: 'Cold Dock 4', deliveryAddress: '100 Freight Way',
      deliveryContactName: 'Pat Receiver', deliveryContactPhone: '303-555-0100',
      deliveryWindowStart: '2031-03-12T08:00', deliveryWindowEnd: '2031-03-12T16:00',
      rate: '3200', currency: 'USD', paymentTerms: 'Net 30',
      specialInstructions: 'Call before arrival', notes: 'Dock 4', loadVisibility: 'public', expirationDateTime: '2031-03-09T08:00',
      allowCarrierBidding: true,
      pickupFacilityName: 'Farm Co', pickupAddress: '1 Farm Rd', pickupContactName: 'Sam', pickupContactPhone: '512-555-0100',
      poNumber: 'PO-1', shipperReferenceNumber: 'SR-1', consigneeReference: 'CR-1',
      cargoValue: '120000', insuranceRequired: '1000000', hazardousMaterial: false,
      hazmatClass: '', hazmatPackingGroup: '', dangerousGoodsUN: '',
      temperatureMin: '-10', temperatureMax: '38', temperatureUnit: 'F',
      specialHandling: ['Fragile', 'Keep Upright', 'Temperature Sensitive (Non-Reefer)'],
      accessorials: ['Liftgate Delivery', 'Appointment Required'],
      carrierInstructions: 'Reefer pre-cooled to 34F', documentsRequired: ['BOL (Bill of Lading)', 'Temperature Log / Reefer Printout'],
      loadLength: '636', loadWidth: '96', loadHeight: '110',
      overweightAcknowledged: false, overweightPermitNumber: '',
      requirePickupVerification: true, requirePickupPhotos: true, requireDeliveryPhotos: false,
      stops: [
        { sequence: 1, type: 'pickup', address: '5 Warehouse Ln, Waco, TX', timeWindow: { start: '2031-03-10T14:00' }, contactName: 'Dock', contactPhone: '254-555-0100', notes: 'Gate B' },
        { sequence: 2, type: 'delivery', address: '9 Market St, Pueblo, CO' },
      ],
    };
    fetch.mockResolvedValue(hit(30.27, -97.74));
    axios.get.mockResolvedValue(ors(1500000));
    const res = await post(shipper, formPayload);
    expect(res.status).toBe(201);
    const load = await Load.findById(res.body._id).lean();
    expect(load.loadWeight).toBe(42000);
    expect(load.reefer).toMatchObject({ enabled: true });
    expect(load.reefer.targetMinC).toBeCloseTo(-23.3, 1);
    expect(load.reefer.targetMaxC).toBeCloseTo(3.3, 1);
    expect(load.specialHandling).toHaveLength(3);
    expect(load.stops).toHaveLength(2);
    expect(load.stops[0]).toMatchObject({ type: 'pickup', address: '5 Warehouse Ln, Waco, TX', contactName: 'Dock' });
    expect(load.loadDimensions).toMatchObject({ length: 636, width: 96, height: 110 });
    expect(load.insuranceRequired).toBe(1000000);
    expect(load.cargoValue).toBe(120000);
  });

  test('an overweight load acknowledged with a permit (the form allows it) still posts', async () => {
    const res = await post(shipper, { ...base, equipmentType: 'Flatbed', weight: '120000', overweightAcknowledged: true, overweightPermitNumber: 'OW-42' });
    expect(res.status).toBe(201);
  });

  test('bulk reports bound violations per item and still creates the good ones', async () => {
    const item = { title: 'B', origin: 'Austin, TX', destination: 'Denver, CO', rate: 1000, equipmentType: 'Dry Van', ...coords };
    const res = await request(app).post('/api/enterprise/loads/bulk').set(bearer(shipper)).send({ loads: [
      item,
      { ...item, commodityType: ['a', 'b'] },
      { ...item, rate: 5000000 },
      { ...item, loadWeight: -1 },
      { ...item, specialInstructions: { a: 1 } },
      { ...item, equipmentType: 'E'.repeat(101) },
    ] });
    expect(res.status).toBe(201);
    expect(res.body.created.map((c) => c.index)).toEqual([0]);
    expect(res.body.errors.map((e) => e.index)).toEqual([1, 2, 3, 4, 5]);
    expect(await count()).toBe(1);
  });
});

describe('cap on open loads waiting for a location, per company', () => {
  const { MAX_UNLOCATED_PER_COMPANY } = require('../../services/loadPostingService');
  const fields = { title: 'T', origin: 'Austin, TX', destination: 'Denver, CO', rate: 100, equipmentType: 'Dry Van' };
  const located = { originLat: 30.27, originLng: -97.74, destinationLat: 39.74, destinationLng: -104.99 };
  const seed = (postedBy, n) => Load.collection.insertMany(Array.from({ length: n }, (_, i) => ({
    title: `U${i}`, origin: 'X, TX', destination: 'Y, TX', rate: 1, equipmentType: 'Dry Van', status: 'open', postedBy,
    createdAt: new Date(), updatedAt: new Date(),
  })));
  let shipper;
  beforeEach(async () => {
    fetch.mockReset(); axios.get.mockReset();
    shipper = await createTestUser({ role: 'shipper', shipperVerification: VERIFIED });
  });

  test('is 200, and at the cap another unlocated load is refused with 429; located loads, other companies, cancelled loads are unaffected', async () => {
    expect(MAX_UNLOCATED_PER_COMPANY).toBe(200);
    await seed(shipper._id, 199);
    fetch.mockRejectedValue(new Error('network down'));
    const post = (s = shipper, b = fields) => request(app).post('/api/loads').set(bearer(s)).send(b);

    const last = await post(); // 199 waiting -> the 200th is allowed
    expect(last.status).toBe(201);
    expect(last.body.needsLocation).toBe(true);

    const refused = await post();
    expect(refused.status).toBe(429);
    expect(refused.body.error).toMatch(/200 open loads waiting for a location lookup/);

    expect((await post(shipper, { ...fields, ...located })).status).toBe(201); // geocodes fine: not counted against the cap
    const other = await createTestUser({ role: 'shipper', shipperVerification: VERIFIED });
    expect((await post(other)).status).toBe(201);

    await Load.updateOne({ _id: last.body._id }, { $set: { status: 'cancelled' } }); // frees a slot
    expect((await post()).status).toBe(201);
  });

  test('a bulk request reports the cap per item', async () => {
    await seed(shipper._id, 200);
    fetch.mockRejectedValue(new Error('network down'));
    const item = { ...fields, title: 'B' };
    const res = await request(app).post('/api/enterprise/loads/bulk').set(bearer(shipper)).send({ loads: [item, { ...item, ...located }] });
    expect(res.status).toBe(201);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0]).toMatchObject({ index: 0 });
    expect(res.body.errors[0].error).toMatch(/waiting for a location lookup/);
    expect(res.body.created.map((c) => c.index)).toEqual([1]);
  });
});

describe('POST /enterprise/loads/parse with create=true shares the bulk limiter', () => {
  const parser = require('../../services/loadParserService');
  const one = { title: 'P', origin: 'Austin, TX', destination: 'Denver, CO', rate: 1800, equipmentType: 'Dry Van' };
  const item = { title: 'B', origin: 'Austin, TX', destination: 'Denver, CO', rate: 1000, equipmentType: 'Dry Van', originLat: 30.27, originLng: -97.74, destinationLat: 39.74, destinationLng: -104.99 };
  const parsed = (loads) => ({ source: 'heuristic', model: null, loads, warnings: [] });
  let shipper; let spy;
  beforeEach(async () => {
    fetch.mockReset(); axios.get.mockReset();
    fetch.mockResolvedValue(hit(30.27, -97.74));
    shipper = await createTestUser({ role: 'shipper', shipperVerification: VERIFIED });
    spy = jest.spyOn(parser, 'parseLoads').mockResolvedValue(parsed([one]));
  });
  afterEach(() => spy.mockRestore());
  const parse = (s, create) => request(app).post('/api/enterprise/loads/parse').set(bearer(s)).send({ text: 'x', create, engine: 'heuristic' });
  const bulk = (s) => request(app).post('/api/enterprise/loads/bulk').set(bearer(s)).send({ loads: [item] });

  test('10 mixed bulk + parse(create) requests use up one per-company quota; the 11th of either kind is 429; review-only parse is unlimited', async () => {
    for (let i = 0; i < 10; i++) {
      const res = i % 2 ? await parse(shipper, true) : await bulk(shipper);
      expect([i, res.status]).toEqual([i, 201]);
    }
    expect((await parse(shipper, true)).status).toBe(429);
    expect((await bulk(shipper)).status).toBe(429);
    expect((await parse(shipper, 'true')).status).toBe(429);
    const review = await parse(shipper, false);
    expect(review.status).toBe(200);
    expect(review.body.data.counts).toEqual({ parsed: 1 });
    expect((await request(app).post('/api/enterprise/loads/parse').set(bearer(shipper)).send({ text: 'x', engine: 'heuristic' })).status).toBe(200); // create omitted
    // another company has its own quota
    const other = await createTestUser({ role: 'shipper', shipperVerification: VERIFIED });
    expect((await parse(other, true)).status).toBe(201);
  });

  test('create="false" (a string the validator accepts as boolean) does NOT create loads', async () => {
    const res = await parse(shipper, 'false');
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBeUndefined();
    expect(await Load.countDocuments({ postedBy: shipper._id })).toBe(0);
  });

  test('at most 100 loads are created from one parse call; the rest come back not created with a clear message', async () => {
    spy.mockResolvedValue(parsed(Array.from({ length: 120 }, (_, i) => ({ ...one, title: `P${i}` }))));
    axios.get.mockResolvedValue(ors(1500000));
    const res = await parse(shipper, true);
    expect(res.status).toBe(201);
    expect(res.body.data.created).toHaveLength(100);
    expect(res.body.data.skipped).toHaveLength(20);
    expect(res.body.data.skipped[0].reason).toMatch(/at most 100 loads are created from one parse request/);
    expect(res.body.data.counts).toEqual({ parsed: 120, created: 100, skipped: 20 });
    expect(await Load.countDocuments({ postedBy: shipper._id })).toBe(100);
  });
});
