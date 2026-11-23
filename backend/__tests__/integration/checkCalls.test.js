/**
 * Integration: automatic check calls. The real monitor + the real routes against in-memory Mongo.
 * Geometry: origin lat 35, destination lat 38 on one meridian (~207 mi straight).
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const Load = require('../../models/Load');
const Message = require('../../models/Message');
const Notification = require('../../models/Notification');
const { runCheckCallCheck } = require('../../jobs/checkCallMonitor');

const io = { to: () => ({ emit: () => {} }), emit: () => {} };
const MIN = 60000;
const NOW = new Date();
const ago = (min) => new Date(NOW.getTime() - min * MIN);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loads', require('../../routes/loadRoutes')(io));
  return app;
}
const app = buildApp();
const bearer = (u) => ({ Authorization: `Bearer ${generateToken(u)}` });
const subToken = (sub, owner, companyRole) => ({
  Authorization: `Bearer ${jwt.sign({ userId: sub._id, role: 'carrier', companyOwnerId: owner._id, companyRole }, process.env.JWT_SECRET)}`,
});
const verifiedCarrier = (o = {}) => createTestUser({
  role: 'carrier', verification: { status: 'verified', identityVerified: true, insurance: { status: 'valid' } },
  fleet: [{ truckId: 'T1', status: 'Available' }], ...o,
});
const fixAt = (lat, ageMin) => ({ latitude: lat, longitude: -90, updatedAt: ago(ageMin), speed: 0 });
const authLoc = (lat, ageMin) => ({ ...fixAt(lat, ageMin), authenticated: true, source: 'mobile_app', lastAuthenticated: { ...fixAt(lat, ageMin), source: 'mobile_app' } });

// Booked through the real update path (fires the Load hooks like production), then in transit.
async function transitLoad(shipper, carrier, over = {}) {
  const load = await createTestLoad(shipper._id, { originLat: 35, originLng: -90, destinationLat: 38, destinationLng: -90, ...over });
  await Load.findOneAndUpdate({ _id: load._id, status: 'open' }, { $set: { status: 'accepted', acceptedBy: carrier._id } });
  await Load.updateOne({ _id: load._id }, { $set: { status: 'in-transit' } });
  return Load.findById(load._id);
}
const setLoc = (id, loc) => Load.updateOne({ _id: id }, { $set: { carrierLocation: loc } });
const list = (id, headers) => request(app).get(`/api/loads/${id}/check-calls`).set(headers);
const answer = (id, headers, body) => request(app).post(`/api/loads/${id}/check-call`).set(headers).send(body);
const notes = (userId, type) => Notification.find({ userId, ...(type ? { type } : {}) }).lean();

describe('check call monitor', () => {
  let shipper, carrier, load;
  beforeEach(async () => {
    shipper = await createTestUser({ role: 'shipper' });
    carrier = await verifiedCarrier();
    load = await transitLoad(shipper, carrier);
  });

  test('posts once (entry + shipper notification + ONE thread message) and is idempotent, even for overlapping runs', async () => {
    await setLoc(load._id, authLoc(36.6, 5)); // ~97 mi left of ~207: halfway
    const runs = await Promise.all([runCheckCallCheck(NOW), runCheckCallCheck(NOW)]);
    expect(runs.reduce((n, s) => n + s.posted, 0)).toBe(1);
    let fresh = await Load.findById(load._id).lean();
    expect(fresh.checkCalls).toHaveLength(1);
    expect(fresh.checkCalls[0]).toMatchObject({ type: 'halfway', source: 'auto', positionConfirmed: true });
    expect(fresh.checkCalls[0].etaAt).toBeTruthy();
    expect(fresh.checkCallState.milestones).toEqual(['halfway']);
    expect(await notes(shipper._id, 'load:check_call')).toHaveLength(1);
    expect(await notes(carrier._id)).toHaveLength(0); // the carrier is only bothered by an ask
    expect(await Message.countDocuments({ channelId: `load_${load._id}`, messageType: 'system' })).toBe(1);

    const again = await runCheckCallCheck(new Date(NOW.getTime() + 10 * MIN));
    expect(again.posted).toBe(0);
    fresh = await Load.findById(load._id).lean();
    expect(fresh.checkCalls).toHaveLength(1);
    expect(fresh.checkCallState.evaluatedAt).toBeTruthy(); // rotation marker
  });

  test('stale position: ask once (carrier notified), no_response after 30 min, then quiet', async () => {
    await setLoc(load._id, authLoc(36, 300));
    await runCheckCallCheck(NOW);
    let fresh = await Load.findById(load._id).lean();
    expect(fresh.checkCalls.map((c) => c.type)).toEqual(['ask_driver']);
    expect(fresh.checkCalls[0].etaAt).toBeNull();
    expect(await notes(carrier._id, 'load:check_call_ask')).toHaveLength(1);
    expect(await notes(shipper._id, 'load:check_call')).toHaveLength(0); // asking the driver does not ping the shipper

    await runCheckCallCheck(new Date(NOW.getTime() + 10 * MIN));
    expect((await Load.findById(load._id).lean()).checkCalls).toHaveLength(1);

    await runCheckCallCheck(new Date(NOW.getTime() + 31 * MIN));
    fresh = await Load.findById(load._id).lean();
    expect(fresh.checkCalls.map((c) => c.type)).toEqual(['ask_driver', 'no_response']);
    expect(fresh.checkCalls[1].message).toMatch(/driver has not responded yet/);
    expect(await notes(shipper._id, 'load:check_call')).toHaveLength(1); // told when nobody answers
    await runCheckCallCheck(new Date(NOW.getTime() + 60 * MIN));
    expect((await Load.findById(load._id).lean()).checkCalls).toHaveLength(2);
    expect(await notes(carrier._id, 'load:check_call_ask')).toHaveLength(1); // no second ask in the same window
  });

  test('an assigned driver login is asked too (unique roster-name match), others are not', async () => {
    const owner = await verifiedCarrier({ drivers: [{ driverId: 'D1', name: 'Dana Driver' }] });
    const driver = await createTestUser({ role: 'carrier', name: 'Dana Driver', parentAccountId: owner._id, companyRole: 'driver' });
    const l = await transitLoad(shipper, owner, { title: 'Driver load' });
    await Load.updateOne({ _id: l._id }, { $set: { assignedDriverId: 'D1', assignedDriverName: 'Dana Driver' } });
    await runCheckCallCheck(NOW);
    expect(await notes(driver._id, 'load:check_call_ask')).toHaveLength(1);
    expect(await notes(owner._id, 'load:check_call_ask')).toHaveLength(1);
  });

  test('a re-booked load starts clean; the former carrier cannot read the old check calls', async () => {
    await setLoc(load._id, authLoc(36.6, 5));
    await runCheckCallCheck(NOW);
    expect((await list(load._id, bearer(carrier)).expect(200)).body.checkCalls).toHaveLength(1);

    // un-book (carrier drops) then another carrier books it
    await Load.findOneAndUpdate({ _id: load._id }, { $set: { status: 'open', acceptedBy: null } });
    let fresh = await Load.findById(load._id).lean();
    expect(fresh.checkCalls).toBeUndefined();
    expect(fresh.checkCallState).toBeUndefined();
    const next = await verifiedCarrier();
    await Load.findOneAndUpdate({ _id: load._id, status: 'open' }, { $set: { status: 'accepted', acceptedBy: next._id } });
    await list(load._id, bearer(carrier)).expect(404);
    expect((await list(load._id, bearer(next)).expect(200)).body).toEqual({ checkCalls: [], pendingAsk: false });
    fresh = await Load.findById(load._id).lean();
    expect(fresh.checkCalls).toBeUndefined();
  });

  test('re-booking mid-run: a write guarded on the old booking is refused', async () => {
    await setLoc(load._id, authLoc(36.6, 5));
    const stale = await Load.findById(load._id).lean(); // what a slow run would have read
    const next = await verifiedCarrier();
    await Load.findOneAndUpdate({ _id: load._id }, { $set: { status: 'open', acceptedBy: null } });
    await Load.findOneAndUpdate({ _id: load._id, status: 'open' }, { $set: { status: 'accepted', acceptedBy: next._id } });
    await Load.updateOne({ _id: load._id }, { $set: { status: 'in-transit' } });
    // the job's own guard shape: old acceptedBy/bookedAt must not match the new booking
    const w = await Load.updateOne({ _id: stale._id, status: 'in-transit', acceptedBy: stale.acceptedBy, bookedAt: stale.bookedAt },
      { $push: { checkCalls: { type: 'halfway', at: NOW } } });
    expect(w.matchedCount).toBe(0);
  });

  test('the 50-entry cap holds for the monitor and for driver answers', async () => {
    const seed = Array.from({ length: 50 }, (_, i) => ({ type: 'position_update', at: ago(1000 - i), message: `old ${i}`, source: 'auto' }));
    await Load.updateOne({ _id: load._id }, { $set: { checkCalls: seed } });
    await setLoc(load._id, authLoc(36.6, 5));
    await runCheckCallCheck(NOW);
    let fresh = await Load.findById(load._id).lean();
    expect(fresh.checkCalls).toHaveLength(50);
    expect(fresh.checkCalls[49].type).toBe('halfway');
    expect(fresh.checkCalls[0].message).toBe('old 1');
    await answer(load._id, bearer(carrier), { status: 'on_schedule' }).expect(200);
    fresh = await Load.findById(load._id).lean();
    expect(fresh.checkCalls).toHaveLength(50);
    expect(fresh.checkCalls[49].type).toBe('driver_update');
    expect(fresh.checkCalls[0].message).toBe('old 2');
  });

  test('delivered loads are not evaluated', async () => {
    await Load.updateOne({ _id: load._id }, { $set: { status: 'delivered' } });
    const s = await runCheckCallCheck(NOW);
    expect(s.posted).toBe(0);
    expect((await Load.findById(load._id).lean()).checkCalls).toBeUndefined();
  });
});

describe('POST /api/loads/:id/check-call', () => {
  let shipper, carrier, load;
  beforeEach(async () => {
    shipper = await createTestUser({ role: 'shipper' });
    carrier = await verifiedCarrier();
    load = await transitLoad(shipper, carrier);
  });

  test('stores the driver\'s statement, notifies the shipper, posts one thread message, clears the pending ask', async () => {
    await setLoc(load._id, authLoc(36, 300));
    await runCheckCallCheck(NOW); // ask_driver
    expect((await list(load._id, bearer(carrier)).expect(200)).body.pendingAsk).toBe(true);
    const before = (await notes(shipper._id, 'load:check_call')).length;
    const msgs = await Message.countDocuments({ channelId: `load_${load._id}` });

    const res = await answer(load._id, bearer(carrier), { status: 'delayed', delayMinutes: 90, reason: 'traffic', note: 'Accident <b>ahead</b>' }).expect(200);
    expect(res.body.checkCall).toMatchObject({ type: 'driver_update', source: 'driver', driverStatus: 'delayed', positionConfirmed: false, etaAt: null });
    expect(res.body.checkCall.message).toMatch(/^Driver reports: delayed about 90 min because of traffic\./);
    expect(res.body.checkCall.driverNote).toBe('Accident ahead'); // angle brackets stripped
    expect((await notes(shipper._id, 'load:check_call')).length).toBe(before + 1);
    expect(await Message.countDocuments({ channelId: `load_${load._id}` })).toBe(msgs + 1);

    const got = (await list(load._id, bearer(shipper)).expect(200)).body;
    expect(got.pendingAsk).toBe(false);
    expect(got.checkCalls[0].type).toBe('driver_update'); // newest first
    expect(got.checkCalls.every((c) => c.by === undefined)).toBe(true);
    // the answer is the driver's word only: the system did not gain a position or ETA, and the next window re-asks
    expect(got.checkCalls[0].positionConfirmed).toBe(false);
    const fresh = await Load.findById(load._id).lean();
    expect(fresh.checkCallState.ask.answeredAt).toBeTruthy();
    expect(fresh.carrierLocation.lastAuthenticated.updatedAt.getTime()).toBe(ago(300).getTime());
  });

  test('a dispatcher/driver sub-account of the booked company may answer', async () => {
    const sub = await createTestUser({ role: 'carrier', parentAccountId: carrier._id, companyRole: 'driver' });
    await answer(load._id, subToken(sub, carrier, 'driver'), { status: 'at_facility' }).expect(200);
  });

  test('validation', async () => {
    const h = bearer(carrier);
    await answer(load._id, h, { status: 'dancing' }).expect(400);
    await answer(load._id, h, {}).expect(400);
    await answer(load._id, h, { status: 'delayed' }).expect(400);
    await answer(load._id, h, { status: 'delayed', delayMinutes: 3 }).expect(400);
    await answer(load._id, h, { status: 'delayed', delayMinutes: 3000 }).expect(400);
    await answer(load._id, h, { status: 'delayed', delayMinutes: 30, reason: 'aliens' }).expect(400);
    await answer(load._id, h, { status: 'stopped', note: 'x'.repeat(301) }).expect(400);
    await request(app).post('/api/loads/not-an-id/check-call').set(h).send({ status: 'stopped' }).expect(400);
    expect((await Load.findById(load._id).lean()).checkCalls).toBeUndefined();
    await answer(load._id, h, { status: 'delayed', delayMinutes: 5, reason: 'other' }).expect(200);
  });

  test('wrong company -> 404, shipper -> 403, unbooked/finished load refused', async () => {
    const other = await verifiedCarrier();
    await answer(load._id, bearer(other), { status: 'stopped' }).expect(404);
    await answer(load._id, bearer(shipper), { status: 'stopped' }).expect(403);
    await request(app).post(`/api/loads/${load._id}/check-call`).send({ status: 'stopped' }).expect(401);
    const open = await createTestLoad(shipper._id);
    await answer(open._id, bearer(carrier), { status: 'stopped' }).expect(404);
    await Load.updateOne({ _id: load._id }, { $set: { status: 'delivered' } });
    await answer(load._id, bearer(carrier), { status: 'stopped' }).expect(409);
  });

  test('rate limit: at most 6 answers per hour per company and load', async () => {
    for (let i = 0; i < 6; i++) await answer(load._id, bearer(carrier), { status: 'on_schedule' }).expect(200);
    await answer(load._id, bearer(carrier), { status: 'on_schedule' }).expect(429);
    // another load is unaffected
    const l2 = await transitLoad(shipper, carrier, { title: 'Second' });
    await answer(l2._id, bearer(carrier), { status: 'on_schedule' }).expect(200);
  });
});

describe('GET /api/loads/:id/check-calls authorization', () => {
  test('shipper, current carrier and admin read; other shipper/carrier get 404', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await verifiedCarrier();
    const load = await transitLoad(shipper, carrier);
    await answer(load._id, bearer(carrier), { status: 'on_schedule' }).expect(200);
    const admin = await createTestUser({ role: 'admin' });
    for (const who of [shipper, carrier, admin]) {
      const r = await list(load._id, bearer(who)).expect(200);
      expect(r.body.checkCalls).toHaveLength(1);
    }
    await list(load._id, bearer(await createTestUser({ role: 'shipper' }))).expect(404);
    await list(load._id, bearer(await verifiedCarrier())).expect(404);
    await request(app).get(`/api/loads/${load._id}/check-calls`).expect(401);
    await request(app).get('/api/loads/not-an-id/check-calls').set(bearer(shipper)).expect(400);
    await list(new (require('mongoose').Types.ObjectId)(), bearer(shipper)).expect(404);
  });
});
