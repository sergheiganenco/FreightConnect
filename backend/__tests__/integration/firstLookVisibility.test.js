/** Integration: preferred-visibility "first look" is enforced on every carrier entry to an open load. */
require('../setup');
const express = require('express');
const request = require('supertest');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const PreferredCarrier = require('../../models/PreferredCarrier');

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {} };
const HOUR = 3600000;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loads', require('../../routes/loadRoutes')(mockIo));
  app.use('/api/bids', require('../../routes/bidRoutes'));
  return app;
}

describe('first-look visibility', () => {
  let app, shipper, load, prefTok, otherTok, other, pref;
  const verified = (o = {}) => createTestUser({
    role: 'carrier',
    verification: { status: 'verified', identityVerified: true, insurance: { status: 'valid' } },
    fleet: [{ truckId: 'T1', status: 'Available' }],
    ...o,
  });
  const as = (m, url, tok) => request(app)[m](url).set('Authorization', `Bearer ${tok}`);

  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    pref = await verified();
    other = await verified();
    prefTok = generateToken(pref);
    otherTok = generateToken(other);
    await PreferredCarrier.create({ shipper: shipper._id, carrier: pref._id });
    load = await createTestLoad(shipper._id, { loadVisibility: 'preferred' });
  });

  test('non-preferred carrier gets 404 on view/route/stops, board and open list', async () => {
    for (const u of ['', '/route', '/stops']) {
      expect((await as('get', `/api/loads/${load._id}${u}`, otherTok)).status).toBe(404);
    }
    const open = await as('get', '/api/loads/open', otherTok);
    expect(open.body.map((l) => String(l._id))).not.toContain(String(load._id));
    const rec = await as('get', '/api/loads/recommended', otherTok);
    expect(rec.body.map((m) => String(m.load._id))).not.toContain(String(load._id));
  });

  test('non-preferred carrier cannot accept or bid', async () => {
    expect((await as('put', `/api/loads/${load._id}/accept`, otherTok)).status).toBe(404);
    const bid = await request(app).post('/api/bids').set('Authorization', `Bearer ${otherTok}`)
      .send({ loadId: String(load._id), amount: 2000 });
    expect(bid.status).toBe(404);
  });

  test('preferred carrier and the posting shipper can view; preferred can bid', async () => {
    expect((await as('get', `/api/loads/${load._id}`, prefTok)).status).toBe(200);
    expect((await as('get', `/api/loads/${load._id}`, generateToken(shipper))).status).toBe(200);
    const open = await as('get', '/api/loads/open', prefTok);
    expect(open.body.map((l) => String(l._id))).toContain(String(load._id));
    const bid = await request(app).post('/api/bids').set('Authorization', `Bearer ${prefTok}`)
      .send({ loadId: String(load._id), amount: 2000 });
    expect(bid.status).not.toBe(404);
  });

  test('after the window anyone can view', async () => {
    const old = await createTestLoad(shipper._id, { loadVisibility: 'preferred', createdAt: new Date(Date.now() - 3 * HOUR) });
    expect((await as('get', `/api/loads/${old._id}`, otherTok)).status).toBe(200);
    const open = await as('get', '/api/loads/open', otherTok);
    expect(open.body.map((l) => String(l._id))).toContain(String(old._id));
  });

  describe("'private' visibility never opens up", () => {
    const Load = require('../../models/Load');
    const mkPrivate = (over = {}) => createTestLoad(shipper._id, { loadVisibility: 'private', ...over });
    const ids = (arr) => arr.map((l) => String(l._id));

    for (const [label, over] of [['inside the 2h window', {}], ['older than 2h', { createdAt: new Date(Date.now() - 3 * HOUR) }]]) {
      test(`non-preferred carrier cannot see/accept/bid, ${label}`, async () => {
        const pl = await mkPrivate(over);
        expect((await as('get', `/api/loads/${pl._id}`, otherTok)).status).toBe(404);
        expect((await as('put', `/api/loads/${pl._id}/accept`, otherTok)).status).toBe(404);
        const bid = await request(app).post('/api/bids').set('Authorization', `Bearer ${otherTok}`)
          .send({ loadId: String(pl._id), amount: 2000 });
        expect(bid.status).toBe(404);
        expect(ids((await as('get', '/api/loads', otherTok)).body)).not.toContain(String(pl._id));
        expect(ids((await as('get', '/api/loads/open', otherTok)).body)).not.toContain(String(pl._id));
        const rec = await as('get', '/api/loads/recommended', otherTok);
        expect(rec.body.map((m) => String(m.load._id))).not.toContain(String(pl._id));
        const cur = await createTestLoad(shipper._id, { title: 'cur', destination: 'Dallas, TX' });
        const rl = await as('get', `/api/loads/recommended/${cur._id}`, otherTok);
        expect(ids(rl.body)).not.toContain(String(pl._id));
      });
    }

    test('return-load suggestions: hidden from non-preferred, offered to preferred', async () => {
      const app2 = express();
      app2.use(express.json());
      app2.use('/api/return-loads', require('../../routes/returnLoadRoutes'));
      const end = new Date(Date.now() + 24 * HOUR);
      const mk = (over) => mkPrivate({
        originLat: 32.9, originLng: -96.9,
        pickupTimeWindow: { start: new Date(end.getTime() + 4 * HOUR), end: new Date(end.getTime() + 12 * HOUR) }, ...over,
      });
      const fresh = await mk({ title: 'priv-fresh' });
      const old = await mk({ title: 'priv-old', createdAt: new Date(Date.now() - 3 * HOUR) });
      const suggestionsFor = async (carrier, tok) => {
        const cur = await createTestLoad(shipper._id, {
          status: 'in-transit', acceptedBy: carrier._id, destinationLat: 32.7767, destinationLng: -96.797,
          deliveryTimeWindow: { start: new Date(), end },
        });
        const r = await request(app2).get(`/api/return-loads/${cur._id}`).set('Authorization', `Bearer ${tok}`);
        expect(r.status).toBe(200);
        return r.body.suggestions.map((s) => String(s.load._id));
      };
      const got = await suggestionsFor(other, otherTok);
      expect(got).not.toContain(String(fresh._id));
      expect(got).not.toContain(String(old._id));
      const prefGot = await suggestionsFor(pref, prefTok);
      expect(prefGot).toContain(String(fresh._id));
      expect(prefGot).toContain(String(old._id));
    });

    test('preferred carrier sees and can bid on it, even after 2h', async () => {
      const old = await mkPrivate({ createdAt: new Date(Date.now() - 3 * HOUR) });
      expect((await as('get', `/api/loads/${old._id}`, prefTok)).status).toBe(200);
      expect(ids((await as('get', '/api/loads/open', prefTok)).body)).toContain(String(old._id));
      const bid = await request(app).post('/api/bids').set('Authorization', `Bearer ${prefTok}`)
        .send({ loadId: String(old._id), amount: 2000 });
      expect(bid.status).not.toBe(404);
    });

    test('missing/null loadVisibility is treated as public', async () => {
      const l = await createTestLoad(shipper._id);
      await Load.collection.updateOne({ _id: l._id }, { $unset: { loadVisibility: '' } });
      expect((await as('get', `/api/loads/${l._id}`, otherTok)).status).toBe(200);
      expect(ids((await as('get', '/api/loads/open', otherTok)).body)).toContain(String(l._id));
      await Load.collection.updateOne({ _id: l._id }, { $set: { loadVisibility: null } });
      expect(ids((await as('get', '/api/loads/open', otherTok)).body)).toContain(String(l._id));
      expect((await as('get', `/api/loads/${l._id}`, otherTok)).status).toBe(200);
    });
  });
});
