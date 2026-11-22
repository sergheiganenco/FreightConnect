/**
 * Integration: tracker-link ingest. The link/token belongs to the BOOKED carrier company only, dies with the
 * booking, and fixes that arrive through it are recorded as unauthenticated (never penalty/late_certain evidence).
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const Load = require('../../models/Load');
const User = require('../../models/User');
const TrackingEvent = require('../../models/TrackingEvent');
const { runPickupRiskCheck } = require('../../jobs/pickupRiskMonitor');

const MIN = 60000;
const at = (min) => new Date(Date.now() + min * MIN);
const bearer = (u) => ({ Authorization: `Bearer ${generateToken(u)}` });
const subToken = (sub, owner, companyRole) => ({
  Authorization: `Bearer ${jwt.sign({ userId: sub._id, role: 'carrier', companyOwnerId: owner._id, companyRole }, process.env.JWT_SECRET)}`,
});
const consent = { tracking: { gpsConsent: { granted: true, grantedAt: new Date(), version: '1' } } };
const carrierUser = (o = {}) => createTestUser({ role: 'carrier', ...consent, ...o });

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tracking/ingest', require('../../routes/trackingIngestRoutes'));
  app.use('/api/tracking', require('../../routes/trackingRoutes'));
  return app;
}
const book = (load, carrier) => Load.findOneAndUpdate({ _id: load._id, status: 'open' }, { $set: { status: 'accepted', acceptedBy: carrier._id } });
const unbook = (load) => Load.findOneAndUpdate({ _id: load._id }, { $set: { status: 'open', acceptedBy: null } });

describe('GET /api/tracking/ingest/link/:loadId', () => {
  let app, shipper, carrier, driver, dispatcher, other, admin, load;
  const link = (id, headers) => request(app).get(`/api/tracking/ingest/link/${id}`).set(headers);
  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    carrier = await carrierUser();
    other = await carrierUser();
    admin = await createTestUser({ role: 'admin' });
    driver = await createTestUser({ role: 'carrier', companyRole: 'driver', parentAccountId: carrier._id });
    dispatcher = await createTestUser({ role: 'carrier', companyRole: 'dispatcher', parentAccountId: carrier._id });
    load = await createTestLoad(shipper._id);
    await book(load, carrier);
  });

  test('shipper, admin, other carriers and anonymous callers are refused', async () => {
    await link(load._id, bearer(shipper)).expect(403);
    await link(load._id, bearer(admin)).expect(403);
    await link(load._id, bearer(other)).expect(403);
    await link(load._id, {}).expect(401);
  });

  test('booked carrier owner, dispatcher and driver all get the same link; an unbooked load has none', async () => {
    const a = await link(load._id, bearer(carrier)).expect(200);
    const b = await link(load._id, subToken(dispatcher, carrier, 'dispatcher')).expect(200);
    const c = await link(load._id, subToken(driver, carrier, 'driver')).expect(200);
    expect(a.body.token).toBeTruthy();
    expect(b.body.token).toBe(a.body.token);
    expect(c.body.token).toBe(a.body.token);
    expect(a.body.owntracksUrl).toContain(`token=${a.body.token}`);
    const open = await createTestLoad(shipper._id);
    await link(open._id, bearer(carrier)).expect(403);
  });

  test('the link does not survive re-booking: the old carrier token is rejected, the new carrier works', async () => {
    const old = (await link(load._id, bearer(carrier)).expect(200)).body.token;
    const ping = (token) => request(app).post(`/api/tracking/ingest/owntracks?loadId=${load._id}&token=${token}`).send({ _type: 'location', lat: 41.9, lon: -87.6 });
    await ping(old).expect(200);
    await unbook(load);
    await book(load, other);
    await ping(old).expect(401);
    await link(load._id, bearer(carrier)).expect(403);
    const fresh = (await link(load._id, bearer(other)).expect(200)).body.token;
    expect(fresh).not.toBe(old);
    await ping(fresh).expect(200);
    // even re-booking to the SAME carrier invalidates the earlier link (new booking nonce)
    await unbook(load);
    await book(load, other);
    await ping(fresh).expect(401);
  });

  test('a load booked before nonces existed: old links are rejected and a fresh link is created lazily', async () => {
    await Load.updateOne({ _id: load._id }, { $unset: { trackingNonce: 1 } });
    expect((await Load.findById(load._id).select('+trackingNonce')).trackingNonce).toBeUndefined();
    const legacy = crypto.createHmac('sha256', process.env.JWT_SECRET).update(String(load._id)).digest('hex').slice(0, 24); // the old loadId-only token
    await request(app).get(`/api/tracking/ingest/osmand?loadId=${load._id}&token=${legacy}&lat=41.9&lon=-87.6`).expect(401);
    const t = (await link(load._id, bearer(carrier)).expect(200)).body.token;
    expect((await Load.findById(load._id).select('+trackingNonce')).trackingNonce).toBeTruthy();
    await request(app).get(`/api/tracking/ingest/osmand?loadId=${load._id}&token=${t}&lat=41.9&lon=-87.6`).expect(200);
    expect((await link(load._id, bearer(carrier)).expect(200)).body.token).toBe(t); // stable once created
  });

  test('missing token secret fails closed', async () => {
    const t = (await link(load._id, bearer(carrier)).expect(200)).body.token;
    const saved = { j: process.env.JWT_SECRET, t: process.env.TRACKING_TOKEN_SECRET };
    delete process.env.JWT_SECRET; delete process.env.TRACKING_TOKEN_SECRET;
    try {
      await request(app).post(`/api/tracking/ingest/owntracks?loadId=${load._id}&token=${t}`).send({ _type: 'location', lat: 41.9, lon: -87.6 }).expect(401);
      await request(app).get(`/api/tracking/ingest/osmand?loadId=${load._id}&token=${t}&lat=41.9&lon=-87.6`).expect(401);
    } finally {
      process.env.JWT_SECRET = saved.j;
      if (saved.t !== undefined) process.env.TRACKING_TOKEN_SECRET = saved.t;
    }
  });
});

describe('ingest provenance', () => {
  let app, shipper, carrier, admin, load;
  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    carrier = await carrierUser();
    admin = await createTestUser({ role: 'admin' });
    load = await createTestLoad(shipper._id, { pickupTimeWindow: { start: at(10), end: at(20) } });
    await book(load, carrier);
  });
  const token = async () => (await request(app).get(`/api/tracking/ingest/link/${load._id}`).set(bearer(carrier)).expect(200)).body.token;
  const far = () => load.originLat - 0.9;

  test('OwnTracks and OsmAnd pings are stored unauthenticated with their own source', async () => {
    const t = await token();
    await request(app).post(`/api/tracking/ingest/owntracks?loadId=${load._id}&token=${t}`).send({ _type: 'location', lat: 41.9, lon: -87.6 }).expect(200);
    let fresh = await Load.findById(load._id);
    expect(fresh.carrierLocation).toMatchObject({ source: 'owntracks', authenticated: false });
    await request(app).get(`/api/tracking/ingest/osmand?loadId=${load._id}&token=${t}&lat=41.95&lon=-87.6`).expect(200);
    fresh = await Load.findById(load._id);
    expect(fresh.carrierLocation).toMatchObject({ source: 'traccar', authenticated: false });
    const events = await TrackingEvent.find({ load: load._id }).lean();
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.authenticated === false)).toBe(true);
  });

  test('REST ping by the carrier company is authenticated; by an admin it is not', async () => {
    const push = (headers) => request(app).post('/api/tracking/location').set(headers).send({ loadId: String(load._id), latitude: 41.9, longitude: -87.6 });
    await push(bearer(carrier)).expect(200);
    expect((await Load.findById(load._id)).carrierLocation.authenticated).toBe(true);
    await push(bearer(admin)).expect(403); // admin has no GPS consent here; still never counts as the carrier
    await User.updateOne({ _id: admin._id }, { $set: consent });
    await push(bearer(admin)).expect(200);
    expect((await Load.findById(load._id)).carrierLocation.authenticated).toBe(false);
    await push(bearer(shipper)).expect(403);
  });

  test('a far-away token fix is at_risk only; an authenticated one is late_certain', async () => {
    const t = await token();
    await request(app).post(`/api/tracking/ingest/owntracks?loadId=${load._id}&token=${t}`).send({ _type: 'location', lat: far(), lon: load.originLng }).expect(200);
    await runPickupRiskCheck(new Date());
    expect((await Load.findById(load._id)).pickupRisk.level).toBe('at_risk');
    await request(app).post('/api/tracking/location').set(bearer(carrier)).send({ loadId: String(load._id), latitude: far(), longitude: load.originLng }).expect(200);
    await runPickupRiskCheck(new Date());
    expect((await Load.findById(load._id)).pickupRisk.level).toBe('late_certain');
  });
});
