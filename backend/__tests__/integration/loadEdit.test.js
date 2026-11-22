/**
 * Integration: a shipper edits its OPEN load (PUT /api/loads/:id) and carriers cannot be baited and switched.
 * Geocoding is node-fetch (mocked); road distance is axios (mocked => null).
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const Load = require('../../models/Load');
const Bid = require('../../models/Bid');
const Notification = require('../../models/Notification');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');

jest.mock('axios');
jest.mock('node-fetch');
const fetch = require('node-fetch');

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {} };
const app = express();
app.use(express.json());
app.use('/api/loads', require('../../routes/loadRoutes')(mockIo));

const hit = (lat, lon) => ({ ok: true, json: async () => [{ lat: String(lat), lon: String(lon) }] });
const miss = { ok: true, json: async () => [] };
const yearFromNow = new Date(Date.now() + 365 * 86400000);

const verifiedShipper = (o = {}) => createTestUser({ role: 'shipper', shipperVerification: { status: 'verified', paymentMethodVerified: true }, ...o });
const verifiedCarrier = () => createTestUser({
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

describe('edit an open load', () => {
  let shipper, sTok, load;
  const as = (m, url, tok) => request(app)[m](url).set('Authorization', `Bearer ${tok}`);
  const edit = (body, tok = sTok, id = load._id) => as('put', `/api/loads/${id}`, tok).send(body);

  beforeEach(async () => {
    fetch.mockReset();
    shipper = await verifiedShipper();
    sTok = generateToken(shipper);
    load = await createTestLoad(shipper._id, { title: 'Edit me', notes: 'old' });
  });

  test('owner edits fields; material change bumps termsVersion, notes-only does not', async () => {
    const r1 = await edit({ notes: 'new note', poNumber: 'PO-9' });
    expect(r1.status).toBe(200);
    expect(r1.body.notes).toBe('new note');
    expect(r1.body.materialChange).toBe(false);
    expect((await Load.findById(load._id)).termsVersion).toBe(1);

    const r2 = await edit({ rate: 3100 });
    expect(r2.status).toBe(200);
    expect(r2.body.materialChange).toBe(true);
    const saved = await Load.findById(load._id);
    expect(saved.rate).toBe(3100);
    expect(saved.rateCents).toBe(310000);
    expect(saved.termsVersion).toBe(2);
    expect(saved.notes).toBe('new note'); // partial update: untouched fields stay

    // re-sending the same values is not a change
    const r3 = await edit({ rate: 3100, notes: 'new note', pickupTimeWindow: { start: saved.pickupTimeWindow.start.toISOString(), end: saved.pickupTimeWindow.end.toISOString() } });
    expect(r3.body.materialChange).toBe(false);
    expect((await Load.findById(load._id)).termsVersion).toBe(2);
  });

  test('windows are validated like posting and stops are edited', async () => {
    expect((await edit({ pickupTimeWindow: { start: '2026-06-02T10:00:00Z', end: '2026-06-01T10:00:00Z' } })).status).toBe(400);
    expect((await edit({ deliveryTimeWindow: { start: 'tomorrow' } })).status).toBe(400);
    const ok = await edit({ pickupTimeWindow: { start: '2031-06-01T10:00:00Z', end: '2031-06-01T14:00:00Z' }, stops: [{ type: 'delivery', address: '1 Main St, Tulsa, OK' }] });
    expect(ok.status).toBe(200);
    const saved = await Load.findById(load._id);
    expect(saved.pickupTimeWindow.start.toISOString()).toBe('2031-06-01T10:00:00.000Z');
    expect(saved.stops).toHaveLength(1);
    expect(saved.stops[0].address).toBe('1 Main St, Tulsa, OK');
    expect(saved.termsVersion).toBe(2);
    expect((await edit({ stops: [{ type: 'bogus', address: 'x' }] })).status).toBe(400);
  });

  test('another shipper company gets 404, a carrier 403, an unknown id 404', async () => {
    const other = await verifiedShipper();
    expect((await edit({ notes: 'hijack' }, generateToken(other))).status).toBe(404);
    expect((await Load.findById(load._id)).notes).toBe('old');
    const carrier = await verifiedCarrier();
    expect((await edit({ notes: 'x' }, generateToken(carrier))).status).toBe(403);
    expect((await edit({ notes: 'x' }, sTok, '5f9d88b9c1234567890abcde')).status).toBe(404);
    expect((await edit({ notes: 'x' }, sTok, 'not-an-id')).status).toBe(400);
  });

  test('a load that is no longer open cannot be edited (409)', async () => {
    await Load.updateOne({ _id: load._id }, { $set: { status: 'accepted' } });
    const res = await edit({ notes: 'late' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('This load can no longer be edited');
    expect((await Load.findById(load._id)).notes).toBe('old');
  });

  test('the body cannot set status, owner, carrier, pickup code or arbitrary fields', async () => {
    const other = await verifiedShipper();
    const res = await edit({
      notes: 'fine', status: 'delivered', acceptedBy: other._id, postedBy: other._id, termsVersion: 99, rateCents: 1,
      source: 'edi', contractId: other._id, isContractLoad: true, externalRef: 'x', locationProblem: { field: 'origin' },
      pickupVerification: { required: true, code: '123456' }, evidenceRequired: { pickup: true, evil: true },
    });
    expect(res.status).toBe(200);
    const saved = await Load.findById(load._id);
    expect(saved.status).toBe('open');
    expect(saved.acceptedBy == null).toBe(true);
    expect(String(saved.postedBy)).toBe(String(shipper._id));
    expect(saved.termsVersion).toBe(1);
    expect(saved.rateCents).toBe(250000);
    expect(saved.source).not.toBe('edi');
    expect(saved.contractId == null).toBe(true);
    expect(saved.locationProblem?.field).toBeUndefined();
    expect(saved.pickupVerification.required).toBe(true);
    expect(saved.pickupVerification.code).toBeUndefined();
    expect(saved.evidenceRequired.pickup).toBe(true);
  });

  test('out-of-bounds and malformed values are 400 like posting', async () => {
    for (const bad of [
      { rate: 0 }, { rate: -5 }, { rate: 5e9 }, { loadWeight: 9e9 }, { title: '' }, { origin: 'x'.repeat(201) },
      { notes: 'x'.repeat(2001) }, { hazardousMaterial: 'yes' }, { loadVisibility: 'everyone' },
      { specialHandling: 'nope' }, { reefer: { targetMinC: 400 } }, { loadDimensions: { length: 1e9 } },
    ]) {
      const res = await edit(bad);
      expect([JSON.stringify(bad), res.status]).toEqual([JSON.stringify(bad), 400]);
    }
    expect((await Load.findById(load._id)).title).toBe('Edit me');
  });

  test('clearing hazmat clears the hazmat details; contract loads keep their rate', async () => {
    await Load.updateOne({ _id: load._id }, { $set: { hazardousMaterial: true, hazmatClass: '3' } });
    const res = await edit({ hazardousMaterial: false });
    expect(res.status).toBe(200);
    const saved = await Load.findById(load._id);
    expect(saved.hazardousMaterial).toBe(false);
    expect(saved.hazmatClass).toBeUndefined();
    expect(res.body.materialChange).toBe(true);

    await Load.updateOne({ _id: load._id }, { $set: { isContractLoad: true } });
    expect((await edit({ rate: 1 })).status).toBe(400);
    expect((await edit({ rate: saved.rate, notes: 'same rate is fine' })).status).toBe(200);
  });

  test('changing the origin re-geocodes and resets the location problem', async () => {
    await Load.updateOne({ _id: load._id }, {
      $set: { locationProblem: { field: 'origin', place: 'Chicgo', reason: 'not_found', at: new Date() }, locationAttempts: 5, locationNextAttemptAt: new Date(Date.now() + 1e7) },
      $unset: { originLat: 1, originLng: 1 },
    });
    fetch.mockResolvedValueOnce(hit(30.2672, -97.7431));
    const res = await edit({ origin: 'Austin, TX' });
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    const saved = await Load.findById(load._id);
    expect(saved.origin).toBe('Austin, TX');
    expect(saved.originLat).toBeCloseTo(30.2672);
    expect(saved.locationProblem?.field).toBeUndefined();
    expect(saved.locationAttempts).toBe(0);
    expect(saved.locationNextAttemptAt).toBeNull();
    expect(saved.termsVersion).toBe(2);
    expect(res.body.needsLocation).toBeUndefined();
  });

  test('a place the geocoder cannot find (or an outage) leaves that side unlocated and the load hidden from carriers', async () => {
    const carrier = await verifiedCarrier();
    const cTok = generateToken(carrier);
    const visible = async () => (await as('get', '/api/loads/open', cTok)).body.map((l) => String(l._id));
    expect(await visible()).toContain(String(load._id));

    fetch.mockResolvedValueOnce(miss);
    const res = await edit({ destination: 'Dnver' });
    expect(res.status).toBe(200);
    expect(res.body.needsLocation).toBe(true);
    const saved = await Load.findById(load._id);
    expect(saved.destination).toBe('Dnver');
    expect(saved.destinationLat).toBeUndefined();
    expect(saved.originLat).toBeCloseTo(41.8781); // the untouched side keeps its coordinates
    expect(saved.distanceMiles).toBeNull();
    expect(await visible()).not.toContain(String(load._id));

    fetch.mockRejectedValueOnce(new Error('network down'));
    expect((await edit({ origin: 'Joliet, IL' })).status).toBe(200);
    expect((await Load.findById(load._id)).originLat).toBeUndefined();
  });

  test('supplied coordinates are taken as posting takes them; text-only edits of other fields do not geocode', async () => {
    const res = await edit({ origin: 'Somewhere, TX', originLat: 31.5, originLng: -97.1 });
    expect(res.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    expect((await Load.findById(load._id)).originLat).toBe(31.5);
    await edit({ notes: 'again' });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('pending and countered bids are voided and carriers told on a material change, not otherwise', async () => {
    const c1 = await verifiedCarrier();
    const c2 = await verifiedCarrier();
    const c3 = await verifiedCarrier();
    const b1 = await Bid.create({ loadId: load._id, carrierId: c1._id, amount: 2000, status: 'pending' });
    const b2 = await Bid.create({ loadId: load._id, carrierId: c2._id, amount: 2100, status: 'countered', counterAmount: 2300 });
    const b3 = await Bid.create({ loadId: load._id, carrierId: c3._id, amount: 1900, status: 'withdrawn' });

    expect((await edit({ notes: 'cosmetic' })).body.voidedBids).toBe(0);
    expect((await Bid.findById(b1._id)).status).toBe('pending');
    expect(await Notification.countDocuments({ type: 'bid:voided' })).toBe(0);

    const res = await edit({ equipmentType: 'Flatbed' });
    expect(res.body.voidedBids).toBe(2);
    const [r1, r2, r3] = await Promise.all([b1, b2, b3].map((b) => Bid.findById(b._id)));
    expect(r1.status).toBe('rejected');
    expect(r1.history.at(-1)).toMatchObject({ actor: 'shipper', action: 'rejected', note: 'Load terms changed' });
    expect(r2.status).toBe('rejected');
    expect(r3.status).toBe('withdrawn');
    const notes = await Notification.find({ type: 'bid:voided' });
    expect(notes.map((n) => String(n.userId)).sort()).toEqual([String(c1._id), String(c2._id)].sort());
    expect(notes[0].body).toMatch(/bid again/i);
  });

  test('a suspended shipper cannot edit', async () => {
    await shipper.updateOne({ $set: { 'shipperVerification.status': 'suspended' } });
    const res = await edit({ notes: 'x' });
    expect(res.status).toBe(403);
    expect((await Load.findById(load._id)).notes).toBe('old');
  });

  test('a shipper sub-account edits on behalf of its company', async () => {
    const sub = await createTestUser({ role: 'shipper', parentAccountId: shipper._id, companyRole: 'dispatcher' });
    const subTok = require('jsonwebtoken').sign({ userId: sub._id, role: 'shipper', companyOwnerId: String(shipper._id), companyRole: 'dispatcher' }, process.env.JWT_SECRET);
    expect((await edit({ notes: 'by dispatcher' }, subTok)).status).toBe(200);
    expect((await Load.findById(load._id)).notes).toBe('by dispatcher');
  });
});

describe('accept honours the terms the carrier saw', () => {
  let shipper, sTok, cTok, load;
  const as = (m, url, tok) => request(app)[m](url).set('Authorization', `Bearer ${tok}`);

  beforeEach(async () => {
    fetch.mockReset();
    shipper = await verifiedShipper();
    sTok = generateToken(shipper);
    cTok = generateToken(await verifiedCarrier());
    load = await createTestLoad(shipper._id);
  });

  test('stale version is refused with TERMS_CHANGED, current or missing version books', async () => {
    expect((await as('put', `/api/loads/${load._id}`, sTok).send({ rate: 2900 })).status).toBe(200); // -> version 2
    const stale = await as('put', `/api/loads/${load._id}/accept`, cTok).send({ termsVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('TERMS_CHANGED');
    expect(stale.body.error).toMatch(/changed by the shipper/);
    expect((await Load.findById(load._id)).status).toBe('open');

    expect((await as('put', `/api/loads/${load._id}/accept`, cTok).send({ termsVersion: 'abc' })).status).toBe(400);
    const ok = await as('put', `/api/loads/${load._id}/accept`, cTok).send({ termsVersion: 2 });
    expect(ok.status).toBe(200);
    expect((await Load.findById(load._id)).status).toBe('accepted');
  });

  test('no version sent still books (older clients)', async () => {
    expect((await as('put', `/api/loads/${load._id}/accept`, cTok).send({})).status).toBe(200);
  });

  test('a load from before the field existed counts as version 1, and its first material edit makes it 2', async () => {
    await Load.collection.updateOne({ _id: load._id }, { $unset: { termsVersion: 1 } });
    expect((await as('put', `/api/loads/${load._id}`, sTok).send({ rate: 2800 })).status).toBe(200);
    expect((await Load.findById(load._id)).termsVersion).toBe(2);

    const legacy = await createTestLoad(shipper._id);
    await Load.collection.updateOne({ _id: legacy._id }, { $unset: { termsVersion: 1 } });
    expect((await as('put', `/api/loads/${legacy._id}/accept`, cTok).send({ termsVersion: 1 })).status).toBe(200);
  });

  test('GET returns termsVersion to the carrier and the shipper', async () => {
    expect((await as('get', `/api/loads/${load._id}`, cTok)).body.termsVersion).toBe(1);
    expect((await as('get', `/api/loads/${load._id}`, sTok)).body.termsVersion).toBe(1);
  });
});

describe('multipart posting', () => {
  test('stops sent as a JSON string in FormData are parsed and validated; bad JSON is 400', async () => {
    fetch.mockReset();
    const shipper = await verifiedShipper();
    const tok = generateToken(shipper);
    fetch.mockResolvedValueOnce(hit(30.2672, -97.7431)).mockResolvedValueOnce(hit(39.7392, -104.9903));
    const form = (stops) => request(app).post('/api/loads').set('Authorization', `Bearer ${tok}`)
      .field('title', 'Multipart').field('origin', 'Austin, TX').field('destination', 'Denver, CO')
      .field('rate', '1800').field('equipmentType', 'Dry Van').field('specialHandling', '["Fragile"]').field('stops', stops);

    const res = await form(JSON.stringify([{ type: 'delivery', address: '1 Main St, Amarillo, TX', sequence: 1 }]));
    expect(res.status).toBe(201);
    const saved = await Load.findById(res.body._id);
    expect(saved.stops).toHaveLength(1);
    expect(saved.stops[0].address).toBe('1 Main St, Amarillo, TX');
    expect(saved.specialHandling).toEqual(['Fragile']);

    expect((await form('[{"type":"delivery"')).status).toBe(400);
    expect((await form(JSON.stringify([{ type: 'bogus', address: 'x' }]))).status).toBe(400);
    const withFile = await request(app).post('/api/loads').set('Authorization', `Bearer ${tok}`)
      .field('title', 'T').field('origin', 'A, TX').field('destination', 'B, TX').field('rate', '1').field('equipmentType', 'Dry Van')
      .attach('cargoPhotos', Buffer.from('x'), 'a.png');
    expect(withFile.status).toBe(400);
    expect(withFile.body.error).toMatch(/attachments are not supported/i);
  });
});
