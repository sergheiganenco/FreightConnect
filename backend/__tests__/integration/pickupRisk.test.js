/**
 * Integration: pickup no-show prediction, carrier response, standby carriers, release-to-standby.
 * Real routes + the real monitor against in-memory Mongo.
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const Load = require('../../models/Load');
const Bid = require('../../models/Bid');
const User = require('../../models/User');
const Notification = require('../../models/Notification');
const DwellEvent = require('../../models/DwellEvent');
const Appointment = require('../../models/Appointment');
const Payment = require('../../models/Payment');
const PreferredCarrier = require('../../models/PreferredCarrier');
const { runPickupRiskCheck, _applyEvaluation } = require('../../jobs/pickupRiskMonitor');

const io = { to: () => ({ emit: () => {} }), emit: () => {} };
const MIN = 60000;
const NOW = new Date();
const at = (min) => new Date(NOW.getTime() + min * MIN);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loads', require('../../routes/loadRoutes')(io));
  app.use('/api/bids', require('../../routes/bidRoutes'));
  app.use('/api/appointments', require('../../routes/appointmentRoutes'));
  return app;
}
const bearer = (u) => ({ Authorization: `Bearer ${generateToken(u)}` });
const subToken = (sub, owner, companyRole) => ({
  Authorization: `Bearer ${jwt.sign({ userId: sub._id, role: 'carrier', companyOwnerId: owner._id, companyRole }, process.env.JWT_SECRET)}`,
});
const verifiedCarrier = (o = {}) => createTestUser({
  role: 'carrier',
  verification: { status: 'verified', identityVerified: true, insurance: { status: 'valid' } },
  fleet: [{ truckId: 'T1', status: 'Available' }],
  ...o,
});
const notes = (userId, type) => Notification.find({ userId, ...(type ? { type } : {}) }).lean();
const bookedLoad = async (shipper, carrier, over = {}) => {
  const load = await createTestLoad(shipper._id, { pickupTimeWindow: { start: at(60), end: at(180) }, ...over });
  // book through the real update path (fires the Load hooks like production)
  await Load.findOneAndUpdate({ _id: load._id, status: 'open' }, { $set: { status: 'accepted', acceptedBy: carrier._id } });
  return Load.findById(load._id);
};

describe('pickup risk monitor', () => {
  let shipper, carrier, load;
  beforeEach(async () => {
    shipper = await createTestUser({ role: 'shipper' });
    carrier = await verifiedCarrier();
    load = await bookedLoad(shipper, carrier); // pickup in 60 min, no GPS -> at_risk
  });

  test('writes state and notifies each level exactly once across runs', async () => {
    await runPickupRiskCheck(NOW);
    let fresh = await Load.findById(load._id);
    expect(fresh.pickupRisk.level).toBe('at_risk');
    expect(fresh.pickupRisk.reason).toBe('no_gps');
    expect(fresh.pickupRisk.notified).toEqual(['at_risk']);
    expect(await notes(carrier._id, 'pickup:at_risk')).toHaveLength(1);
    expect(await notes(shipper._id, 'pickup:at_risk')).toHaveLength(1);

    await runPickupRiskCheck(at(5)); // same level again: no new notification
    expect(await notes(carrier._id)).toHaveLength(1);
    expect(await notes(shipper._id)).toHaveLength(1);

    await runPickupRiskCheck(at(180 + 31)); // 31 min after latest arrival, never arrived
    fresh = await Load.findById(load._id);
    expect(fresh.pickupRisk.level).toBe('no_show');
    expect(fresh.pickupRisk.notified.sort()).toEqual(['at_risk', 'no_show']);
    expect(await notes(shipper._id, 'pickup:no_show')).toHaveLength(1);
    expect(await notes(carrier._id, 'pickup:no_show')).toHaveLength(1);
    expect((await notes(shipper._id, 'pickup:no_show'))[0].body).toMatch(/release the load to standby/);

    await runPickupRiskCheck(at(180 + 40));
    expect(await notes(shipper._id)).toHaveLength(2);
  });

  test('two concurrent runs notify once', async () => {
    await Promise.all([runPickupRiskCheck(NOW), runPickupRiskCheck(NOW)]);
    expect(await notes(carrier._id, 'pickup:at_risk')).toHaveLength(1);
    expect(await notes(shipper._id, 'pickup:at_risk')).toHaveLength(1);
  });

  test('an improving level updates state and does not notify', async () => {
    await runPickupRiskCheck(NOW);
    // fresh GPS ~ right at the origin
    await Load.updateOne({ _id: load._id }, { $set: { carrierLocation: { latitude: load.originLat + 0.01, longitude: load.originLng, updatedAt: NOW, source: 'mobile_app' } } });
    await runPickupRiskCheck(NOW);
    const fresh = await Load.findById(load._id);
    expect(fresh.pickupRisk.level).toBe('on_track');
    expect(await notes(carrier._id)).toHaveLength(1);
    expect(await notes(shipper._id)).toHaveLength(1);
  });

  test('a pickup DwellEvent (arrival) suppresses alerts', async () => {
    await DwellEvent.create({ load: load._id, carrier: carrier._id, shipper: shipper._id, stopType: 'pickup', arrivedAt: new Date() }); // after booking: counts
    await runPickupRiskCheck(at(180 + 60));
    const fresh = await Load.findById(load._id);
    expect(fresh.pickupRisk.level).toBe('on_track');
    expect(fresh.pickupRisk.reason).toBe('arrived');
    expect(await Notification.countDocuments({})).toBe(0);
  });

  test("another carrier's earlier arrival does not count", async () => {
    const other = await verifiedCarrier();
    await DwellEvent.create({ load: load._id, carrier: other._id, shipper: shipper._id, stopType: 'pickup', arrivedAt: at(-5) });
    await runPickupRiskCheck(NOW);
    expect((await Load.findById(load._id)).pickupRisk.level).toBe('at_risk');
  });

  test('a load re-booked between evaluation and write is not written to', async () => {
    const snapshot = await Load.findById(load._id).lean(); // what the run saw
    const next = await verifiedCarrier();
    await Load.findOneAndUpdate({ _id: load._id }, { $set: { status: 'open', acceptedBy: null } });
    await Load.findOneAndUpdate({ _id: load._id, status: 'open' }, { $set: { status: 'accepted', acceptedBy: next._id } });
    const out = await _applyEvaluation(snapshot, false, NOW);
    expect(out.notified).toBe(false);
    const fresh = await Load.findById(load._id);
    expect(fresh.pickupRisk && fresh.pickupRisk.level).toBeFalsy();
    expect(await Notification.countDocuments({})).toBe(0);
  });

  test('state is wiped when the load is un-booked or re-booked', async () => {
    await runPickupRiskCheck(NOW);
    await Load.updateOne({ _id: load._id }, { $set: { carrierLocation: { latitude: 1, longitude: 1, updatedAt: NOW } } });
    await Load.findOneAndUpdate({ _id: load._id }, { $set: { status: 'open', acceptedBy: null } });
    let fresh = await Load.findById(load._id);
    expect(fresh.pickupRisk && fresh.pickupRisk.level).toBeFalsy();
    expect(fresh.carrierLocation && fresh.carrierLocation.latitude).toBeFalsy();

    await Load.updateOne({ _id: load._id }, { $set: { 'pickupRisk.level': 'no_show', 'pickupRisk.notified': ['no_show'] } });
    const next = await verifiedCarrier();
    await Load.findOneAndUpdate({ _id: load._id, status: 'open' }, { $set: { status: 'accepted', acceptedBy: next._id } });
    fresh = await Load.findById(load._id);
    expect(fresh.pickupRisk && fresh.pickupRisk.level).toBeFalsy();

    // save() path (doc-based unassign)
    await Load.updateOne({ _id: load._id }, { $set: { 'pickupRisk.level': 'at_risk' } });
    const doc = await Load.findById(load._id);
    doc.acceptedBy = null; doc.status = 'open';
    await doc.save();
    expect((await Load.findById(load._id)).pickupRisk.level).toBeUndefined();
  });

  test('ignores loads outside the pickup range and non-accepted loads', async () => {
    const far = await bookedLoad(shipper, carrier, { pickupTimeWindow: { start: at(13 * 60), end: at(14 * 60) } });
    const old = await bookedLoad(shipper, carrier, { pickupTimeWindow: { start: at(-25 * 60), end: at(-24 * 60) } });
    const open = await createTestLoad(shipper._id, { pickupTimeWindow: { start: at(30), end: at(90) } });
    const stats = await runPickupRiskCheck(NOW);
    expect(stats.checked).toBe(1);
    for (const l of [far, old, open]) expect((await Load.findById(l._id)).pickupRisk?.level).toBeUndefined();
  });
});

describe('POST /api/loads/:id/pickup-confirm', () => {
  let app, shipper, carrier, load, driver, otherCarrier;
  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    carrier = await verifiedCarrier();
    otherCarrier = await verifiedCarrier();
    driver = await createTestUser({ role: 'carrier', companyRole: 'driver', parentAccountId: carrier._id });
    load = await bookedLoad(shipper, carrier);
    await runPickupRiskCheck(NOW);
  });
  const post = (id, headers, body) => request(app).post(`/api/loads/${id}/pickup-confirm`).set(headers).send(body);

  test('booked company owner and its driver sub-account may answer; recorded with the acting person', async () => {
    await post(load._id, bearer(carrier), { status: 'on_my_way' }).expect(200);
    let fresh = await Load.findById(load._id);
    expect(fresh.pickupRisk.carrierConfirmation.status).toBe('on_my_way');
    expect(String(fresh.pickupRisk.carrierConfirmation.by)).toBe(String(carrier._id));
    expect(fresh.pickupRisk.level).toBe('on_track'); // on_my_way suppresses the missing-GPS rule
    await post(load._id, subToken(driver, carrier, 'driver'), { status: 'on_my_way' }).expect(200);
    fresh = await Load.findById(load._id);
    expect(String(fresh.pickupRisk.carrierConfirmation.by)).toBe(String(driver._id));
  });

  test('cannot_make_it tells the shipper, keeps the booking, and is not double-sent', async () => {
    const before = (await notes(shipper._id)).length; // the earlier at_risk
    const res = await post(load._id, bearer(carrier), { status: 'cannot_make_it' }).expect(200);
    expect(res.body.pickupRisk.level).toBe('at_risk');
    expect(res.body.pickupRisk.reason).toBe('carrier_declined');
    const declined = await notes(shipper._id, 'pickup:carrier_declined');
    expect(declined).toHaveLength(1);
    expect(declined[0].body).toMatch(/can't make this pickup/);
    expect((await Load.findById(load._id)).status).toBe('accepted');
    expect(String((await Load.findById(load._id)).acceptedBy)).toBe(String(carrier._id));
    await post(load._id, bearer(carrier), { status: 'cannot_make_it' }).expect(200);
    expect(await notes(shipper._id, 'pickup:carrier_declined')).toHaveLength(1);
    expect((await notes(shipper._id)).length).toBe(before + 1);
    await runPickupRiskCheck(NOW); // monitor does not re-announce
    expect((await notes(shipper._id)).length).toBe(before + 1);
  });

  test('other carrier, shipper, unauthenticated, bad body and wrong status are refused', async () => {
    await post(load._id, bearer(otherCarrier), { status: 'on_my_way' }).expect(403);
    await post(load._id, bearer(shipper), { status: 'on_my_way' }).expect(403);
    await request(app).post(`/api/loads/${load._id}/pickup-confirm`).send({ status: 'on_my_way' }).expect(401);
    await post(load._id, bearer(carrier), { status: 'whatever' }).expect(400);
    await post('not-an-id', bearer(carrier), { status: 'on_my_way' }).expect(400);
    await Load.updateOne({ _id: load._id }, { $set: { status: 'in-transit' } });
    await post(load._id, bearer(carrier), { status: 'on_my_way' }).expect(409);
    const open = await createTestLoad(shipper._id);
    await post(open._id, bearer(carrier), { status: 'on_my_way' }).expect(403);
  });
});

describe('standby carriers', () => {
  let app, shipper;
  beforeEach(async () => { app = buildApp(); shipper = await createTestUser({ role: 'shipper' }); });
  const bid = (load, c, amount) => Bid.create({ loadId: load._id, carrierId: c._id, amount, status: 'pending', history: [{ actor: 'carrier', action: 'placed', amount }] });
  const acceptBid = (b) => request(app).put(`/api/bids/${b._id}/accept`).set(bearer(shipper)).expect(200);

  test('built at booking: cheapest first, ties by trust score, capped at 5, winner excluded', async () => {
    const load = await createTestLoad(shipper._id);
    const winner = await verifiedCarrier();
    const bids = [];
    const amounts = [1900, 2000, 2000, 2100, 2200, 2300, 2400];
    for (let i = 0; i < amounts.length; i++) {
      const c = await verifiedCarrier({ trustScore: { score: i === 2 ? 90 : 50 } });
      bids.push(await bid(load, c, amounts[i]));
    }
    await acceptBid(await bid(load, winner, 2500));
    const marked = await Bid.find({ loadId: load._id, 'standby.rank': { $ne: null } }).sort({ 'standby.rank': 1 }).lean();
    expect(marked).toHaveLength(5);
    // 1900, then the 2000 with trust 90 (index 2) before the 2000 with trust 50, then 2100, 2200
    expect(marked.map((b) => b.amount)).toEqual([1900, 2000, 2000, 2100, 2200]);
    expect(String(marked[1]._id)).toBe(String(bids[2]._id));
    expect(marked.map((b) => b.standby.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(await Bid.countDocuments({ loadId: load._id, carrierId: winner._id, 'standby.rank': { $ne: null } })).toBe(0);
  });

  test('excludes unverified, inactive and carriers not allowed to see the load', async () => {
    const load = await createTestLoad(shipper._id, { loadVisibility: 'private' });
    const winner = await verifiedCarrier(), good = await verifiedCarrier(), inactive = await verifiedCarrier({ active: false });
    const unverified = await createTestUser({ role: 'carrier' }), hidden = await verifiedCarrier();
    for (const c of [winner, good, inactive, unverified]) await PreferredCarrier.create({ shipper: shipper._id, carrier: c._id });
    const gb = await bid(load, good, 2100);
    await bid(load, inactive, 1000); await bid(load, unverified, 1000); await bid(load, hidden, 1000);
    await acceptBid(await bid(load, winner, 2500));
    const marked = await Bid.find({ loadId: load._id, 'standby.rank': { $ne: null } }).lean();
    expect(marked.map((b) => String(b._id))).toEqual([String(gb._id)]);
  });

  test('also built on the direct-accept path, and a carrier can opt out', async () => {
    const load = await createTestLoad(shipper._id);
    const winner = await verifiedCarrier(), c1 = await verifiedCarrier(), c2 = await verifiedCarrier();
    const b1 = await bid(load, c1, 2000); await bid(load, c2, 2100);
    await request(app).put(`/api/loads/${load._id}/accept`).set(bearer(winner)).send({}).expect(200);
    expect(await Bid.countDocuments({ loadId: load._id, 'standby.rank': { $ne: null } })).toBe(2);
    await request(app).put(`/api/bids/${b1._id}/standby-opt-out`).set(bearer(c2)).expect(404); // not their bid
    await request(app).put(`/api/bids/${b1._id}/standby-opt-out`).set(bearer(c1)).expect(200);
    expect((await Bid.findById(b1._id)).standby.optedOut).toBe(true);
  });
});

describe('POST /api/loads/:id/release-to-standby', () => {
  let app, shipper, winner, s1, s2, load, outsider;
  const release = (id, headers, reason) => request(app).post(`/api/loads/${id}/release-to-standby`).set(headers).send({ reason });
  const bid = (c, amount) => Bid.create({ loadId: load._id, carrierId: c._id, amount, status: 'pending', history: [{ actor: 'carrier', action: 'placed', amount }] });

  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    winner = await verifiedCarrier({ trustScore: { score: 50 } });
    s1 = await verifiedCarrier(); s2 = await verifiedCarrier(); outsider = await verifiedCarrier();
    load = await createTestLoad(shipper._id, { pickupTimeWindow: { start: at(-240), end: at(-180) } });
    await bid(s1, 2000); await bid(s2, 2100);
    const wb = await bid(winner, 2500);
    await request(app).put(`/api/bids/${wb._id}/accept`).set(bearer(shipper)).expect(200);
    // GPS: truck is ~40 miles from pickup, authenticated fix taken 20 min before the latest arrival (-180)
    await Load.updateOne({ _id: load._id }, { $set: {
      carrierLocation: { latitude: load.originLat - 0.58, longitude: load.originLng, updatedAt: at(-200), source: 'mobile_app', authenticated: true },
      'evidence': [{ stage: 'pickup', file: 'x.jpg', kind: 'cargo' }],
    } });
    await Appointment.create({ load: load._id, shipper: shipper._id, carrier: winner._id, pickup: { status: 'pending' } });
    await Payment.create({ loadId: load._id, shipperId: shipper._id, carrierId: winner._id, amount: 2500, status: 'in_escrow' });
    await runPickupRiskCheck(NOW);
  });

  test('refused when not allowed: wrong party, bad reason, risk does not support it', async () => {
    expect((await Load.findById(load._id)).pickupRisk.level).toBe('no_show');
    await release(load._id, bearer(winner), 'no_show').expect(403);
    await release(load._id, bearer(await createTestUser({ role: 'shipper' })), 'no_show').expect(403);
    await release(load._id, bearer(shipper), 'bogus').expect(400);
    await release(load._id, bearer(shipper), 'late_certain').expect(409); // level is no_show, not late_certain
    await release(load._id, bearer(shipper), 'carrier_declined').expect(409); // carrier never declined
    // truck arrives: the release re-evaluates and refuses on fresh evidence, not on the stale stored level
    await DwellEvent.create({ load: load._id, carrier: winner._id, shipper: shipper._id, stopType: 'pickup', arrivedAt: new Date() });
    await release(load._id, bearer(shipper), 'no_show').expect(409);
    expect((await Load.findById(load._id)).status).toBe('accepted');
  });

  test('no_show with GPS evidence: real cancel cascade, re-opened, standby notified, standard -5 penalty, carrier told', async () => {
    const res = await release(load._id, bearer(shipper), 'no_show').expect(200);
    expect(res.body).toMatchObject({ loadStatus: 'open', standbyNotified: 2, trustScorePenalty: -5, escrowRefunded: true });
    const fresh = await Load.findById(load._id).select('+pickupVerification.code +evidence');
    expect(fresh.status).toBe('open');
    expect(fresh.acceptedBy).toBeNull();
    expect(fresh.pickupVerification.code).toBeUndefined();            // pickup code cleared
    expect(fresh.evidence.every((e) => e.archived)).toBe(true);        // evidence archived
    expect(fresh.pickupRisk && fresh.pickupRisk.level).toBeFalsy();    // risk state reset
    expect((await Payment.findOne({ loadId: load._id })).status).toBe('cancelled');
    expect(await Bid.countDocuments({ loadId: load._id, status: { $in: ['pending', 'countered', 'accepted'] } })).toBe(0);
    expect(await Bid.countDocuments({ loadId: load._id, 'standby.rank': { $ne: null } })).toBe(0);
    await new Promise((r) => setTimeout(r, 100)); // adjustScore is fire-and-forget
    expect((await User.findById(winner._id)).trustScore.score).toBe(45);
    // notifications: standby carriers only (not the outsider, not the winner), winner told with the reason
    expect(await notes(s1._id, 'load:standby_available')).toHaveLength(1);
    expect(await notes(s2._id, 'load:standby_available')).toHaveLength(1);
    expect(await notes(outsider._id, 'load:standby_available')).toHaveLength(0);
    expect(await notes(winner._id, 'load:standby_available')).toHaveLength(0);
    const told = await notes(winner._id, 'pickup:released');
    expect(told).toHaveLength(1);
    expect(told[0].body).toMatch(/predicted no-show.*reduced by 5 points/);
    expect(told[0].body).toMatch(/about 40 miles from the pickup/);
    expect(told[0].body).toMatch(/support@freightconnect\.com.*quote load/);
    expect(told[0].body).not.toMatch(/-?\d+\.\d{3,}/); // distances only, no coordinates
    const h = (await User.findById(winner._id)).trustScore.history.at(-1);
    expect(h.reason).toBe('carrier_pickup_no_show');
    expect(String(h.loadId)).toBe(String(load._id));
    expect((await Appointment.findOne({ load: load._id })).pickup.status).toBe('cancelled'); // cascade
    // audit trail names the reason
    const StatusHistory = require('../../models/StatusHistory');
    const hist = await StatusHistory.find({ entityType: 'load', entityId: load._id }).lean();
    expect(hist.some((h) => /Released by shipper after predicted no-show/.test(h.reason || ''))).toBe(true);

    // a standby carrier can now book through the normal gated flow; risk state stays reset
    await request(app).put(`/api/loads/${load._id}/accept`).set(bearer(s1)).send({}).expect(200);
    const rebooked = await Load.findById(load._id);
    expect(String(rebooked.acceptedBy)).toBe(String(s1._id));
    expect(rebooked.pickupRisk && rebooked.pickupRisk.level).toBeFalsy();
  });

  test('standby count: shipper sees it, carrier and other shippers cannot', async () => {
    const get = (h) => request(app).get(`/api/loads/${load._id}/standby`).set(h);
    expect((await get(bearer(shipper)).expect(200)).body.count).toBe(2);
    await get(bearer(winner)).expect(403);
    await get(bearer(await createTestUser({ role: 'shipper' }))).expect(403);
  });

  test('no_show without GPS evidence carries no automatic penalty', async () => {
    await Load.updateOne({ _id: load._id }, { $unset: { carrierLocation: 1 } });
    const res = await release(load._id, bearer(shipper), 'no_show').expect(200);
    expect(res.body.trustScorePenalty).toBe(0);
    await new Promise((r) => setTimeout(r, 100));
    expect((await User.findById(winner._id)).trustScore.score).toBe(50);
    expect((await notes(winner._id, 'pickup:released'))[0].body).toMatch(/No trust score change/);
  });

  test('late_certain release: no penalty, records estimated lateness; carrier_declined release allowed', async () => {
    // pickup in 30 min, truck fresh and ~58 mi away -> cannot make it even at 60 mph
    await Load.updateOne({ _id: load._id }, { $set: {
      pickupTimeWindow: { start: at(10), end: at(30) }, bookedWindow: { start: at(10), end: at(30) },
      carrierLocation: { latitude: load.originLat - 0.9, longitude: load.originLng, updatedAt: new Date(), source: 'mobile_app', authenticated: true },
    } });
    await release(load._id, bearer(shipper), 'no_show').expect(409);
    const res = await release(load._id, bearer(shipper), 'late_certain').expect(200);
    expect(res.body.trustScorePenalty).toBe(0);
    const StatusHistory = require('../../models/StatusHistory');
    const hist = await StatusHistory.find({ entityType: 'load', entityId: load._id }).lean();
    expect(hist.some((h) => /predicted lateness.*est\. \d+ min late/.test(h.reason || ''))).toBe(true);
  });

  test('carrier_declined release (admin may also release)', async () => {
    await Load.updateOne({ _id: load._id }, { $set: { pickupTimeWindow: { start: at(300), end: at(400) }, bookedWindow: { start: at(300), end: at(400) } }, $unset: { carrierLocation: 1 } });
    await request(app).post(`/api/loads/${load._id}/pickup-confirm`).set(bearer(winner)).send({ status: 'cannot_make_it' }).expect(200);
    const admin = await createTestUser({ role: 'admin' });
    const res = await release(load._id, bearer(admin), 'carrier_declined').expect(200);
    expect(res.body.trustScorePenalty).toBe(0);
    expect((await Load.findById(load._id)).status).toBe('open');
  });

  test('an arrival from an EARLIER booking by the same carrier does not block a release', async () => {
    const booked = await Load.findById(load._id);
    await DwellEvent.create({ load: load._id, carrier: winner._id, shipper: shipper._id, stopType: 'pickup', arrivedAt: new Date(booked.bookedAt.getTime() - 3600000) });
    await release(load._id, bearer(shipper), 'no_show').expect(200);
  });
});

describe('appointment cascade, carrier cancel and standby', () => {
  let app, shipper, carrier, s1, load, appt;
  const cancel = (headers) => request(app).put(`/api/loads/${load._id}/cancel`).set(headers).send({ reason: 'test' });
  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    carrier = await verifiedCarrier(); s1 = await verifiedCarrier();
    load = await bookedLoad(shipper, carrier);
    // pickup leg live, delivery leg already terminal ('missed'): the schema has no 'completed' leg state
    appt = await Appointment.create({ load: load._id, shipper: shipper._id, carrier: carrier._id, pickup: { status: 'confirmed' }, delivery: { status: 'missed' } });
    await Bid.create({ loadId: load._id, carrierId: s1._id, amount: 2000, status: 'pending', standby: { rank: 1 }, history: [{ actor: 'carrier', action: 'placed', amount: 2000 }] });
  });

  test('shipper cancel cancels live legs and leaves a terminal leg untouched', async () => {
    await cancel(bearer(shipper)).expect(200);
    const a = await Appointment.findById(appt._id);
    expect(a.pickup.status).toBe('cancelled');
    expect(a.delivery.status).toBe('missed');
    expect(a.history.filter((x) => x.action === 'cancelled').map((x) => x.type)).toEqual(['pickup']);
  });

  test('carrier cancel cancels legs, notifies standby once, clears markers, and the next carrier can book + schedule', async () => {
    const res = await cancel(bearer(carrier)).expect(200);
    expect(res.body).toMatchObject({ loadStatus: 'open', standbyNotified: 1 });
    const a = await Appointment.findById(appt._id);
    expect([a.pickup.status, a.delivery.status]).toEqual(['cancelled', 'missed']);
    expect(await notes(s1._id, 'load:standby_available')).toHaveLength(1);
    expect(await Bid.countDocuments({ loadId: load._id, 'standby.rank': { $ne: null } })).toBe(0);
    // standby carrier books; the stale cancelled record must not block a new appointment
    await request(app).put(`/api/loads/${load._id}/accept`).set(bearer(s1)).send({}).expect(200);
    await request(app).post('/api/appointments').set(bearer(s1)).send({ loadId: String(load._id), pickup: { scheduledAt: at(90) } }).expect(201);
  });

  test('carrier cancel skips standby carriers that are no longer eligible', async () => {
    await User.updateOne({ _id: s1._id }, { $set: { active: false } });
    const res = await cancel(bearer(carrier)).expect(200);
    expect(res.body.standbyNotified).toBe(0);
    expect(await notes(s1._id, 'load:standby_available')).toHaveLength(0);
  });
});

describe('pickup window changed after an alert; arrival bound to the booking', () => {
  let app, shipper, carrier, load;
  const move = (start, end) => request(app).put(`/api/loads/${load._id}/pickup-window`).set(bearer(shipper)).send({ start, end });
  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    carrier = await verifiedCarrier();
    load = await bookedLoad(shipper, carrier);
    await runPickupRiskCheck(NOW); // at_risk (no GPS) announced
    await Load.updateOne({ _id: load._id }, { $set: { 'pickupRisk.carrierConfirmation': { status: 'on_my_way', at: NOW } } });
  });

  test('moving the window resets risk state, tells the carrier; moving it earlier while late alerts again', async () => {
    await move(at(300), at(400)).expect(200);
    let fresh = await Load.findById(load._id);
    expect(fresh.pickupRisk && fresh.pickupRisk.level).toBeFalsy();
    expect(fresh.pickupRisk && fresh.pickupRisk.notified).toBeUndefined();
    expect(fresh.pickupRisk && fresh.pickupRisk.carrierConfirmation && fresh.pickupRisk.carrierConfirmation.status).toBeFalsy();
    expect(await notes(carrier._id, 'pickup:window_changed')).toHaveLength(1);

    // new, EARLIER window: only a proposal until the carrier accepts; then with a fresh authenticated fix ~58 miles away: NEW alert
    await Load.updateOne({ _id: load._id }, { $set: { carrierLocation: { latitude: load.originLat - 3, longitude: load.originLng, updatedAt: NOW, source: 'mobile_app', authenticated: true } } });
    await move(at(130), at(150)).expect(200); // start must be >= 2h out
    await request(app).post(`/api/loads/${load._id}/pickup-window-response`).set(bearer(carrier)).send({ accept: true }).expect(200);
    await runPickupRiskCheck(NOW);
    fresh = await Load.findById(load._id);
    expect(fresh.pickupRisk.level).toBe('late_certain');
    expect(await notes(carrier._id, 'pickup:late')).toHaveLength(1);
    expect(await notes(shipper._id, 'pickup:late')).toHaveLength(1);
  });

  test('re-saving the same window changes nothing and sends nothing', async () => {
    const w = (await Load.findById(load._id)).pickupTimeWindow;
    await move(w.start, w.end).expect(200);
    expect((await Load.findById(load._id)).pickupRisk.notified).toEqual(['at_risk']);
    expect(await notes(carrier._id, 'pickup:window_changed')).toHaveLength(0);
  });

  test('an arrival that predates the current booking does not suppress alerts; one after it does', async () => {
    const booked = await Load.findById(load._id);
    const ev = await DwellEvent.create({ load: load._id, carrier: carrier._id, shipper: shipper._id, stopType: 'pickup', arrivedAt: new Date(booked.bookedAt.getTime() - 3600000) });
    await Load.updateOne({ _id: load._id }, { $unset: { 'pickupRisk.carrierConfirmation': 1 } });
    await runPickupRiskCheck(at(180 + 60));
    expect((await Load.findById(load._id)).pickupRisk.level).toBe('no_show');
    await DwellEvent.updateOne({ _id: ev._id }, { $set: { arrivedAt: new Date(booked.bookedAt.getTime() + 1000) } });
    await runPickupRiskCheck(at(180 + 61));
    expect((await Load.findById(load._id)).pickupRisk.reason).toBe('arrived');
  });
});

describe('the agreed pickup window cannot be changed unilaterally', () => {
  let app, shipper, carrier, driver, other, load;
  const move = (start, end, headers) => request(app).put(`/api/loads/${load._id}/pickup-window`).set(headers || bearer(shipper)).send({ start, end });
  const respond = (headers, accept) => request(app).post(`/api/loads/${load._id}/pickup-window-response`).set(headers).send({ accept });
  const release = (reason) => request(app).post(`/api/loads/${load._id}/release-to-standby`).set(bearer(shipper)).send({ reason });
  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    carrier = await verifiedCarrier();
    other = await verifiedCarrier();
    driver = await createTestUser({ role: 'carrier', companyRole: 'driver', parentAccountId: carrier._id });
    load = await bookedLoad(shipper, carrier, { pickupTimeWindow: { start: at(300), end: at(420) } }); // agreed window: +300..+420 min (edits need a 2h lead)
  });

  test('booking snapshots the agreed window; un-booking clears it', async () => {
    const fresh = await Load.findById(load._id);
    expect(fresh.bookedWindow.start.getTime()).toBe(fresh.pickupTimeWindow.start.getTime());
    expect(fresh.bookedWindow.end.getTime()).toBe(fresh.pickupTimeWindow.end.getTime());
    await Load.findOneAndUpdate({ _id: load._id }, { $set: { status: 'open', acceptedBy: null } });
    const open = await Load.findById(load._id);
    expect(open.bookedWindow && open.bookedWindow.start).toBeFalsy();
    expect(open.pickupWindowChange && open.pickupWindowChange.status).toBeFalsy();
  });

  test('a shipper shortening the window is only a proposal: carrier judged on the agreed window, monitor quiet, release refused', async () => {
    const agreedEnd = (await Load.findById(load._id)).bookedWindow.end;
    const res = await move(at(150), at(200)).expect(200); // earlier start and end
    expect(res.body.windowChangeProposed).toBe(true);
    let fresh = await Load.findById(load._id);
    expect(fresh.pickupTimeWindow.end.getTime()).toBe(agreedEnd.getTime());   // displayed window = what both agreed
    expect(fresh.bookedWindow.end.getTime()).toBe(agreedEnd.getTime());
    expect(fresh.pickupWindowChange).toMatchObject({ status: 'pending' });
    expect(fresh.pickupWindowChange.proposedEnd.getTime()).toBe(at(200).getTime());
    expect(await notes(carrier._id, 'pickup:window_change_proposed')).toHaveLength(1);

    await runPickupRiskCheck(at(430)); // 10 min after the AGREED end: inside grace -> not a no-show
    fresh = await Load.findById(load._id);
    expect(fresh.pickupRisk.level).toBe('at_risk');
    expect(fresh.pickupRisk.detail.latestArrivalAt).toBe(agreedEnd.toISOString());
    expect(await notes(shipper._id, 'pickup:no_show')).toHaveLength(0);

    await runPickupRiskCheck(at(420 + 31)); // genuinely a no-show on the agreed window
    expect((await Load.findById(load._id)).pickupRisk.level).toBe('no_show');
    const refused = await release('no_show').expect(409); // ...but not while the shipper's own proposal is pending
    expect(refused.body.error).toMatch(/proposed/);
    expect((await Load.findById(load._id)).status).toBe('accepted');
    expect((await User.findById(carrier._id)).trustScore?.history || []).toHaveLength(0); // no penalty ever applied

    const w = (await Load.findById(load._id)).bookedWindow; // shipper withdraws by re-sending the agreed window
    await move(w.start, w.end).expect(200);
    expect((await Load.findById(load._id)).pickupWindowChange?.status).toBeFalsy();
    // no longer blocked by the proposal (the real clock is before the deadline, so the risk check itself says no)
    expect((await release('no_show').expect(409)).body.error).toMatch(/pickup risk does not support/);
  });

  test('carrier company (owner or driver) accepts: window and agreed window update, shipper told', async () => {
    await move(at(150), at(250)).expect(200); // earlier start + earlier end
    await respond(bearer(other), true).expect(403);
    await respond(bearer(shipper), true).expect(403);
    await respond({}, true).expect(401);
    const res = await respond(subToken(driver, carrier, 'driver'), true).expect(200);
    expect(res.body.pickupWindowChange.status).toBe('accepted');
    const fresh = await Load.findById(load._id);
    expect(fresh.pickupTimeWindow.end.getTime()).toBe(at(250).getTime());
    expect(fresh.bookedWindow.end.getTime()).toBe(at(250).getTime());
    expect(String(fresh.pickupWindowChange.respondedBy)).toBe(String(driver._id));
    expect(await notes(shipper._id, 'pickup:window_change_accepted')).toHaveLength(1);
    await respond(bearer(carrier), true).expect(409); // nothing pending any more
  });

  test('carrier declines: agreed window untouched, shipper told', async () => {
    const before = await Load.findById(load._id);
    await move(at(150), at(250)).expect(200);
    await respond(bearer(carrier), false).expect(200);
    const fresh = await Load.findById(load._id);
    expect(fresh.pickupTimeWindow.end.getTime()).toBe(before.pickupTimeWindow.end.getTime());
    expect(fresh.pickupWindowChange.status).toBe('declined');
    expect(await notes(shipper._id, 'pickup:window_change_declined')).toHaveLength(1);
  });

  test('lenient changes apply immediately and become the agreed window; an earlier START is still a proposal', async () => {
    await move(at(300), at(540)).expect(200); // same start, later end
    let fresh = await Load.findById(load._id);
    expect(fresh.pickupTimeWindow.end.getTime()).toBe(at(540).getTime());
    expect(fresh.bookedWindow.end.getTime()).toBe(at(540).getTime());
    expect(await notes(carrier._id, 'pickup:window_changed')).toHaveLength(1);
    await move(at(360), at(600)).expect(200); // later start, later end
    fresh = await Load.findById(load._id);
    expect(fresh.bookedWindow.start.getTime()).toBe(at(360).getTime());
    const p = await move(at(150), at(700)).expect(200); // earlier start, later end: demanding on the start
    expect(p.body.windowChangeProposed).toBe(true);
    expect((await Load.findById(load._id)).bookedWindow.start.getTime()).toBe(at(360).getTime());
    await move(at(360), at(800)).expect(200); // a lenient edit supersedes the pending proposal
    expect((await Load.findById(load._id)).pickupWindowChange?.status).toBeFalsy();
  });

  test('bad dates are refused', async () => {
    await move('nonsense', at(90)).expect(400);
    await move(at(90), at(30)).expect(400);
  });

  test('an unbooked load keeps the direct edit', async () => {
    const open = await createTestLoad(shipper._id, { pickupTimeWindow: { start: at(60), end: at(180) } });
    await request(app).put(`/api/loads/${open._id}/pickup-window`).set(bearer(shipper)).send({ start: at(10), end: at(20) }).expect(200);
    expect((await Load.findById(open._id)).pickupTimeWindow.end.getTime()).toBe(at(20).getTime());
  });

  test('delivery window of a booked load can only be extended; not edited after delivery', async () => {
    const dw = (s, e) => request(app).put(`/api/loads/${load._id}/delivery-window`).set(bearer(shipper)).send({ start: s, end: e });
    const d = (await Load.findById(load._id)).deliveryTimeWindow;
    await dw(d.start, new Date(d.end.getTime() - MIN)).expect(409);
    await dw(d.start, new Date(d.end.getTime() + MIN)).expect(200);
    await Load.updateOne({ _id: load._id }, { $set: { status: 'delivered' } });
    await dw(d.start, new Date(d.end.getTime() + 2 * MIN)).expect(409);
    const open = await createTestLoad(shipper._id);
    await request(app).put(`/api/loads/${open._id}/delivery-window`).set(bearer(shipper)).send({ start: at(1), end: at(2) }).expect(200);
  });
});

describe('penalty evidence and arrival evidence', () => {
  let app, shipper, carrier, load;
  const release = (reason) => request(app).post(`/api/loads/${load._id}/release-to-standby`).set(bearer(shipper)).send({ reason });
  const score = async () => { await new Promise((r) => setTimeout(r, 100)); return (await User.findById(carrier._id)).trustScore.score; };
  const fix = (updatedAt, authenticated) => Load.updateOne({ _id: load._id }, { $set: { carrierLocation: { latitude: load.originLat - 0.58, longitude: load.originLng, updatedAt, source: authenticated ? 'mobile_app' : 'owntracks', authenticated } } });
  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    carrier = await verifiedCarrier({ trustScore: { score: 50 } });
    load = await bookedLoad(shipper, carrier, { pickupTimeWindow: { start: at(-240), end: at(-180) } }); // latest arrival 3h ago
  });

  test('authenticated far fix taken near the deadline: penalty applies', async () => {
    await fix(at(-200), true);
    expect((await release('no_show').expect(200)).body.trustScorePenalty).toBe(-5);
    expect(await score()).toBe(45);
  });

  test('authenticated far fix just inside the 30 min lead: penalty applies', async () => {
    await fix(at(-209), true);
    expect((await release('no_show').expect(200)).body.trustScorePenalty).toBe(-5);
    expect(await score()).toBe(45);
  });

  test('authenticated far fix just outside the 30 min lead: no penalty', async () => {
    await fix(at(-211), true);
    expect((await release('no_show').expect(200)).body.trustScorePenalty).toBe(0);
    expect(await score()).toBe(50);
  });

  test('authenticated far fix from 5 hours before the deadline: released, no penalty', async () => {
    await fix(at(-480), true);
    expect((await release('no_show').expect(200)).body.trustScorePenalty).toBe(0);
    expect(await score()).toBe(50);
  });

  test('token-ingested (unauthenticated) far fix: released, no penalty', async () => {
    await fix(at(-200), false);
    const res = await release('no_show').expect(200);
    expect(res.body.trustScorePenalty).toBe(0);
    expect(await score()).toBe(50);
  });

  test('token-ingested far fix never produces late_certain', async () => {
    await Load.updateOne({ _id: load._id }, { $set: { pickupTimeWindow: { start: at(10), end: at(20) }, bookedWindow: { start: at(10), end: at(20) } } });
    await fix(new Date(), false);
    await runPickupRiskCheck(new Date());
    expect((await Load.findById(load._id)).pickupRisk.level).toBe('at_risk');
    await release('late_certain').expect(409);
    await fix(new Date(), true);
    await runPickupRiskCheck(new Date());
    expect((await Load.findById(load._id)).pickupRisk.level).toBe('late_certain');
  });

  const arrivalCases = {
    'a verified pickup code': () => ({ 'pickupVerification.verifiedAt': new Date(), 'pickupVerification.verifiedBy': 'dock_link' }),
    'a pickup signature': () => ({ 'pickupSignature.signedAt': new Date(), 'pickupSignature.signedByRole': 'carrier' }),
    'a nearby live pickup photo from the booked carrier': () => ({ evidence: [{ stage: 'pickup', file: 'x.jpg', companyId: carrier._id, facilityDistanceMiles: 0.4 }] }),
  };
  test.each(Object.keys(arrivalCases))('%s counts as arrived: never a no_show, release refused', async (name) => {
    await fix(at(-200), true);
    await Load.updateOne({ _id: load._id }, { $set: arrivalCases[name]() });
    await runPickupRiskCheck(NOW);
    const fresh = await Load.findById(load._id);
    expect(fresh.pickupRisk.level).toBe('on_track');
    expect(fresh.pickupRisk.reason).toBe('arrived');
    await release('no_show').expect(409);
    expect((await Load.findById(load._id)).status).toBe('accepted');
    expect(await score()).toBe(50);
  });

  test('a far, archived, or other-company pickup photo does not count as arrival', async () => {
    const other = await verifiedCarrier();
    await Load.updateOne({ _id: load._id }, { $set: { evidence: [
      { stage: 'pickup', file: 'a.jpg', companyId: carrier._id, facilityDistanceMiles: 3 },
      { stage: 'pickup', file: 'b.jpg', companyId: carrier._id, facilityDistanceMiles: 0.2, archived: true },
      { stage: 'pickup', file: 'c.jpg', companyId: other._id, facilityDistanceMiles: 0.2 },
      { stage: 'delivery', file: 'd.jpg', companyId: carrier._id, facilityDistanceMiles: 0.2 },
    ] } });
    await runPickupRiskCheck(NOW);
    expect((await Load.findById(load._id)).pickupRisk.level).toBe('no_show');
  });
});

describe('pickup window edits on a booked load: lead time, deadline, expiry, immutability', () => {
  let app, shipper, carrier, load;
  const move = (start, end) => request(app).put(`/api/loads/${load._id}/pickup-window`).set(bearer(shipper)).send({ start, end });
  const respond = (accept) => request(app).post(`/api/loads/${load._id}/pickup-window-response`).set(bearer(carrier)).send({ accept });
  const agreed = async () => (await Load.findById(load._id)).bookedWindow;
  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    carrier = await verifiedCarrier();
    load = await bookedLoad(shipper, carrier, { pickupTimeWindow: { start: at(300), end: at(420) } });
  });

  test('a window in the past, or starting inside the 2h lead, is refused (proposal and lenient edit alike)', async () => {
    await move(at(-120), at(-60)).expect(400);   // past (would be a proposal: earlier)
    await move(at(60), at(200)).expect(400);     // inside the lead, earlier: proposal refused
    await move(at(90), at(900)).expect(400);     // inside the lead
    const fresh = await Load.findById(load._id);
    expect(fresh.pickupWindowChange?.status).toBeFalsy();
    expect((await agreed()).start.getTime()).toBe(at(300).getTime());
  });

  test('a lenient edit (later end) cannot be used while the agreed start is already past', async () => {
    await Load.updateOne({ _id: load._id }, { $set: { pickupTimeWindow: { start: at(-30), end: at(200) }, bookedWindow: { start: at(-30), end: at(200) } } });
    await move(at(-30), at(600)).expect(400);
    expect((await agreed()).end.getTime()).toBe(at(200).getTime());
  });

  test('once the agreed latest arrival has passed, no window edit is accepted at all', async () => {
    await Load.updateOne({ _id: load._id }, { $set: { pickupTimeWindow: { start: at(-300), end: at(-10) }, bookedWindow: { start: at(-300), end: at(-10) } } });
    for (const [s, e] of [[at(300), at(400)], [at(-300), at(-10)], [at(-300), at(900)]]) {
      const res = await move(s, e).expect(409);
      expect(res.body.error).toMatch(/pickup deadline has already passed/);
    }
    expect((await agreed()).end.getTime()).toBe(at(-10).getTime());
  });

  test('accepting a proposal whose start has since passed or is inside the lead is refused and the proposal expires', async () => {
    await move(at(150), at(250)).expect(200);
    await Load.updateOne({ _id: load._id }, { $set: { 'pickupWindowChange.proposedStart': at(30) } });
    const res = await respond(true).expect(409);
    expect(res.body.error).toMatch(/expired/);
    const fresh = await Load.findById(load._id);
    expect(fresh.pickupWindowChange.status).toBe('expired');
    expect(fresh.bookedWindow.start.getTime()).toBe(at(300).getTime()); // agreed window untouched
    await respond(true).expect(409); // nothing pending any more
  });

  test('a pending proposal older than 24h expires: on accept and in the monitor sweep', async () => {
    await move(at(150), at(250)).expect(200);
    await Load.updateOne({ _id: load._id }, { $set: { 'pickupWindowChange.proposedAt': at(-25 * 60) } });
    await respond(true).expect(409);
    expect((await Load.findById(load._id)).pickupWindowChange.status).toBe('expired');

    await move(at(150), at(250)).expect(200); // a fresh proposal is possible again
    await Load.updateOne({ _id: load._id }, { $set: { 'pickupWindowChange.proposedAt': at(-25 * 60) } });
    await runPickupRiskCheck(NOW);
    expect((await Load.findById(load._id)).pickupWindowChange.status).toBe('expired');
  });

  test('the pickup window is immutable once the load is in transit or delivered', async () => {
    for (const status of ['in-transit', 'delivered']) {
      await Load.updateOne({ _id: load._id }, { $set: { status } });
      await move(at(600), at(700)).expect(409);
      const fresh = await Load.findById(load._id);
      expect(fresh.pickupTimeWindow.start.getTime()).toBe(at(300).getTime());
      expect(fresh.bookedWindow.start.getTime()).toBe(at(300).getTime());
    }
  });
});

describe('carrier cancellation penalty lands on the company', () => {
  test('a dispatcher sub-account cancels: the company loses 5 points, the dispatcher record is untouched', async () => {
    const app = buildApp();
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await verifiedCarrier({ trustScore: { score: 50 } });
    const dispatcher = await createTestUser({ role: 'carrier', companyRole: 'dispatcher', parentAccountId: carrier._id });
    const load = await bookedLoad(shipper, carrier);
    await request(app).put(`/api/loads/${load._id}/cancel`).set(subToken(dispatcher, carrier, 'dispatcher')).send({ reason: 'test' }).expect(200);
    await new Promise((r) => setTimeout(r, 150)); // adjustScore is fire-and-forget
    const co = await User.findById(carrier._id);
    expect(co.trustScore.score).toBe(45);
    expect(co.trustScore.history).toHaveLength(1);
    expect(String(co.trustScore.history[0].loadId)).toBe(String(load._id));
    const person = await User.findById(dispatcher._id);
    expect(person.trustScore.score).toBe(50);
    expect(person.trustScore.history).toHaveLength(0);
  });
});

describe('dwell events are bound to a booking', () => {
  const { checkGeofence } = require('../../services/geofenceService');
  let app, shipper, carrier, load;
  const atPickup = () => [load.originLat, load.originLng];
  const cancel = (u) => request(app).put(`/api/loads/${load._id}/cancel`).set(bearer(u)).send({ reason: 'test' });
  const rebook = async (who) => {
    await new Promise((r) => setTimeout(r, 5)); // distinct bookedAt
    await Load.findOneAndUpdate({ _id: load._id, status: 'open' }, { $set: { status: 'accepted', acceptedBy: who._id } });
  };
  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    carrier = await verifiedCarrier();
    load = await bookedLoad(shipper, carrier);
  });

  test('same carrier: arrive, cancel (open dwell closed, no billing), re-book, arrive again -> second event, monitor sees arrival', async () => {
    await checkGeofence(carrier._id, ...atPickup());
    const first = await DwellEvent.findOne({ load: load._id });
    const b1 = (await Load.findById(load._id)).bookedAt;
    expect(first.bookedAt.getTime()).toBe(b1.getTime());
    await DwellEvent.updateOne({ _id: first._id }, { $set: { arrivedAt: new Date(Date.now() - 5 * 3600000) } }); // 5h on site: would bill detention if recalculated

    await cancel(carrier).expect(200);
    const closed = await DwellEvent.findById(first._id);
    expect(closed.departedAt).toBeTruthy();
    expect(closed.closedReason).toBe('cancelled');
    expect(closed.detentionFeeCents).toBe(0);
    expect(closed.dwellMinutes).toBe(0);
    expect((await Load.findById(load._id)).accessorialCharges || []).toHaveLength(0);

    await rebook(carrier);
    const b2 = (await Load.findById(load._id)).bookedAt;
    expect(b2.getTime()).toBeGreaterThan(b1.getTime());
    await checkGeofence(carrier._id, ...atPickup());
    const events = await DwellEvent.find({ load: load._id, carrier: carrier._id, stopType: 'pickup' }).sort({ createdAt: 1 });
    expect(events).toHaveLength(2);
    expect(events[1].bookedAt.getTime()).toBe(b2.getTime());
    expect(events[1].departedAt).toBeNull();

    await runPickupRiskCheck(at(180 + 60)); // long after the window: an arrival in THIS booking means not a no-show
    expect((await Load.findById(load._id)).pickupRisk.reason).toBe('arrived');
  });

  test('a different carrier is unaffected and keeps its own event', async () => {
    const other = await verifiedCarrier();
    await checkGeofence(carrier._id, ...atPickup());
    await cancel(carrier).expect(200);
    await rebook(other);
    await checkGeofence(other._id, ...atPickup());
    expect(await DwellEvent.countDocuments({ load: load._id, carrier: carrier._id })).toBe(1);
    const mine = await DwellEvent.find({ load: load._id, carrier: other._id });
    expect(mine).toHaveLength(1);
    expect(mine[0].closedReason).toBeNull();
  });

  test('a legacy load without bookedAt still checks in once, and out', async () => {
    await Load.collection.updateOne({ _id: load._id }, { $unset: { bookedAt: 1 } });
    await checkGeofence(carrier._id, ...atPickup());
    await checkGeofence(carrier._id, ...atPickup()); // already checked in: no duplicate
    const evs = await DwellEvent.find({ load: load._id });
    expect(evs).toHaveLength(1);
    expect(evs[0].bookedAt).toBeNull();
    const out = await checkGeofence(carrier._id, load.originLat + 1, load.originLng);
    expect(out.checkedOut).toHaveLength(1);
  });
});

describe('appointments are bound to the current booking of the load', () => {
  let app, shipper, carrier, former, dispatcher, load, old;
  const call = (method, path, headers, body) => request(app)[method](`/api/appointments${path}`).set(headers).send(body || {});
  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    carrier = await verifiedCarrier();
    former = await verifiedCarrier();
    dispatcher = await createTestUser({ role: 'carrier', companyRole: 'dispatcher', parentAccountId: carrier._id });
    load = await bookedLoad(shipper, former);
    old = await Appointment.create({ load: load._id, shipper: shipper._id, carrier: former._id, pickup: { status: 'pending', scheduledAt: at(400) }, delivery: { status: 'pending', scheduledAt: at(900) } });
    await request(app).put(`/api/loads/${load._id}/cancel`).set(bearer(former)).send({ reason: 'test' }).expect(200); // legs cancelled by the cascade
    await request(app).put(`/api/loads/${load._id}/accept`).set(bearer(carrier)).send({}).expect(200);              // booked to a new carrier
  });

  test('the dropped carrier cannot request, reschedule, confirm, mark missed or cancel, nor revive its old leg', async () => {
    const mine = await call('post', '', bearer(carrier), { loadId: String(load._id), pickup: { scheduledAt: at(400) } }).expect(201);
    const nid = mine.body._id;
    for (const id of [nid, String(old._id)]) {
      await call('patch', `/${id}/request`, bearer(former), { apptType: 'pickup', scheduledAt: at(500) }).expect(403);
      await call('patch', `/${id}/reschedule`, bearer(former), { apptType: 'pickup', scheduledAt: at(500) }).expect(403);
      await call('patch', `/${id}/confirm`, bearer(former), { apptType: 'pickup' }).expect(403);
      await call('patch', `/${id}/missed`, bearer(former), { apptType: 'pickup' }).expect(403);
      await call('delete', `/${id}`, bearer(former)).expect(403);
    }
    await call('post', '', bearer(former), { loadId: String(load._id), pickup: { scheduledAt: at(400) } }).expect(403);
    expect((await Appointment.findById(old._id)).pickup.status).toBe('cancelled');
    expect((await Appointment.findById(nid)).pickup.status).toBe('pending');
  });

  test('the new carrier books its own appointment; the old cancelled one is history for everyone', async () => {
    const mine = await call('post', '', bearer(carrier), { loadId: String(load._id), pickup: { scheduledAt: at(400) } }).expect(201); // old record does not block
    await call('post', '', bearer(carrier), { loadId: String(load._id), pickup: { scheduledAt: at(400) } }).expect(409);           // own live one does
    await call('patch', `/${mine.body._id}/request`, bearer(carrier), { apptType: 'delivery', scheduledAt: at(900) }).expect(200);
    await call('patch', `/${old._id}/request`, bearer(carrier), { apptType: 'pickup', scheduledAt: at(500) }).expect(409);       // a cancelled leg of an earlier booking
    await call('patch', `/${old._id}/confirm`, bearer(shipper), { apptType: 'pickup' }).expect(409);
    await call('patch', `/${mine.body._id}/confirm`, bearer(shipper), { apptType: 'pickup' }).expect(200);
  });

  test('a dispatcher sub-account of the booked carrier can act; cancelled and missed legs stay frozen', async () => {
    const mine = await call('post', '', bearer(carrier), { loadId: String(load._id), pickup: { scheduledAt: at(400) }, delivery: { scheduledAt: at(900) } }).expect(201);
    const disp = subToken(dispatcher, carrier, 'dispatcher');
    await call('patch', `/${mine.body._id}/reschedule`, disp, { apptType: 'pickup', scheduledAt: at(450) }).expect(200);
    await call('patch', `/${mine.body._id}/missed`, disp, { apptType: 'delivery' }).expect(200);
    await call('patch', `/${mine.body._id}/request`, disp, { apptType: 'delivery', scheduledAt: at(950) }).expect(409);     // missed: frozen
    await call('patch', `/${mine.body._id}/reschedule`, bearer(shipper), { apptType: 'delivery', scheduledAt: at(950) }).expect(409);
    await call('delete', `/${mine.body._id}`, disp).expect(200);                                                            // cancels the live pickup leg only
    const a = await Appointment.findById(mine.body._id);
    expect([a.pickup.status, a.delivery.status]).toEqual(['cancelled', 'missed']);
    await call('patch', `/${mine.body._id}/reschedule`, disp, { apptType: 'pickup', scheduledAt: at(500) }).expect(409);    // cancelled: frozen
    await call('delete', `/${mine.body._id}`, disp).expect(409);
  });

  test('reads: the dropped carrier sees its own old record (load redacted) but never the new appointment', async () => {
    const mine = await call('post', '', bearer(carrier), { loadId: String(load._id), pickup: { scheduledAt: at(400) } }).expect(201);
    const list = (await call('get', '', bearer(former)).expect(200)).body;
    expect(list.map((a) => a._id)).toEqual([String(old._id)]);
    expect(Object.keys(list[0].load).sort()).toEqual(['_id', 'destination', 'origin', 'title']);
    await call('get', `/${mine.body._id}`, bearer(former)).expect(403);
    const detail = (await call('get', `/${old._id}`, bearer(former)).expect(200)).body;
    expect(detail.load.rate).toBeUndefined();
    const newList = (await call('get', '', subToken(dispatcher, carrier, 'dispatcher')).expect(200)).body; // company-scoped
    expect(newList.map((a) => a._id)).toEqual([mine.body._id]);
    expect(newList[0].load.rate).toBeDefined();
  });
});
