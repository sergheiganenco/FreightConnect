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
});
