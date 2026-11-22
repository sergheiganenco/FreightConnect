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
    delete process.env.REQUIRE_SHIPPER_PAYMENT_METHOD;
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
