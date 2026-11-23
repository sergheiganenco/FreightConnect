/**
 * Integration: auto-tender (services/tenderService, jobs/tenderMonitor). A load is offered to the shipper's network one
 * carrier at a time; only the carrier holding the live offer can see or book it; nothing about the line reaches a carrier.
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const Load = require('../../models/Load');
const User = require('../../models/User');
const Notification = require('../../models/Notification');
const PreferredCarrier = require('../../models/PreferredCarrier');
const { createTestUser, generateToken } = require('../helpers');
const { runTenderCheck } = require('../../jobs/tenderMonitor');
const { atomicBookLoad } = require('../../services/bookingGuard');
const { carrierOpenVisibleConditions } = require('../../services/loadVisibility');

jest.mock('axios');
jest.mock('node-fetch');
const fetch = require('node-fetch');

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {} };
const app = express();
app.use(express.json());
app.use('/api/loads', require('../../routes/loadRoutes')(mockIo));
app.use('/api/bids', require('../../routes/bidRoutes'));
app.use('/api/preferred-carriers', require('../../routes/preferredCarrierRoutes'));

const yearFromNow = new Date(Date.now() + 365 * 86400000);
const verifiedShipper = () => createTestUser({ role: 'shipper', shipperVerification: { status: 'verified', paymentMethodVerified: true } });
const verifiedCarrier = (o = {}) => createTestUser({
  role: 'carrier',
  fleet: [{ truckId: 'TRK-1', status: 'Available', available: true }],
  verification: {
    status: 'verified', identityVerified: true,
    fmcsaData: { operatingStatus: 'AUTHORIZED FOR PROPERTY', lastChecked: new Date(), dotNumber: o.dot },
    insurance: {
      cargoLiability: { amount: 100000, policyNumber: 'C1', expiry: yearFromNow, underwriter: 'X' },
      autoLiability: { amount: 1000000, policyNumber: 'A1', expiry: yearFromNow, underwriter: 'X' },
      status: 'valid', lastChecked: new Date(),
    },
  },
});
const as = (m, url, user) => request(app)[m](url).set('Authorization', `Bearer ${generateToken(user)}`);
const body = (o = {}) => ({ title: 'Tender me', origin: 'Chicago, IL', destination: 'Dallas, TX', rate: 2500, equipmentType: 'Dry Van', ...o });
const later = (min) => new Date(Date.now() + min * 60000);
const plan = async (id) => (await Load.findById(id).select('+tenderPlan').lean());
const visibleTo = async (carrier, id) => !!(await Load.exists({ _id: id, $or: await carrierOpenVisibleConditions(carrier._id) }));

describe('auto-tender', () => {
  let shipper, gold, silver, std, outsider;
  beforeEach(async () => {
    fetch.mockReset();
    fetch.mockResolvedValue({ ok: true, json: async () => [{ lat: '41.8', lon: '-87.6' }] });
    shipper = await verifiedShipper();
    [gold, silver, std, outsider] = await Promise.all([verifiedCarrier(), verifiedCarrier(), verifiedCarrier(), verifiedCarrier()]);
    await PreferredCarrier.create({ shipper: shipper._id, carrier: std._id, tier: 'standard' });
    await PreferredCarrier.create({ shipper: shipper._id, carrier: silver._id, tier: 'silver' });
    await PreferredCarrier.create({ shipper: shipper._id, carrier: gold._id, tier: 'gold' });
  });
  const post = (tender = {}, extra = {}) => as('post', '/api/loads', shipper).send(body({ tender, ...extra }));

  test('posting offers the load to the first carrier in tier order, and to nobody else', async () => {
    const r = await post();
    expect(r.status).toBe(201);
    expect(r.body.loadVisibility).toBe('tender');
    expect(r.body.tender.offeredTo).toBe(String(gold._id));
    expect(r.body.tenderPlan).toBeUndefined();
    const p = (await plan(r.body._id)).tenderPlan;
    expect(p.queue.map(String)).toEqual([gold, silver, std].map((c) => String(c._id)));
    expect(p.position).toBe(0);

    expect(await visibleTo(gold, r.body._id)).toBe(true);
    for (const c of [silver, std, outsider]) expect(await visibleTo(c, r.body._id)).toBe(false);
    expect((await as('get', `/api/loads/${r.body._id}`, silver)).status).toBe(404);
    expect((await as('put', `/api/loads/${r.body._id}/accept`, silver).send({})).status).toBe(404);
    // the offered carrier reads the load but never the line behind it
    const seen = await as('get', `/api/loads/${r.body._id}`, gold);
    expect(seen.status).toBe(200);
    expect(JSON.stringify(seen.body)).not.toContain(String(silver._id));
    expect(await Notification.countDocuments({ userId: gold._id, type: 'tender:offered' })).toBe(1);
    expect(await Notification.countDocuments({ userId: { $in: [silver._id, std._id] } })).toBe(0);
  });

  test('the offered carrier books it through the ordinary accept route', async () => {
    const r = await post();
    const ok = await as('put', `/api/loads/${r.body._id}/accept`, gold).send({});
    expect(ok.status).toBe(200);
    const l = await Load.findById(r.body._id);
    expect(String(l.acceptedBy)).toBe(String(gold._id));
    const s = await as('get', `/api/loads/${r.body._id}/tender`, shipper);
    expect(s.body.tender.result).toBe('accepted');
    expect(s.body.tender.queue[0].state).toBe('accepted');
    expect((await runTenderCheck(later(600))).moved).toBe(0);
  });

  test('decline moves to the next carrier at once; only the holder can decline', async () => {
    const r = await post();
    const id = r.body._id;
    expect((await as('post', `/api/loads/${id}/tender/decline`, silver).send({})).status).toBe(404);
    expect((await as('post', `/api/loads/${id}/tender/decline`, shipper).send({})).status).toBe(403);
    const driver = await createTestUser({ role: 'carrier', parentAccountId: gold._id, companyRole: 'driver' });
    const dTok = require('jsonwebtoken').sign({ userId: driver._id, role: 'carrier', companyOwnerId: String(gold._id), companyRole: 'driver' }, process.env.JWT_SECRET);
    expect((await request(app).post(`/api/loads/${id}/tender/decline`).set('Authorization', `Bearer ${dTok}`).send({})).status).toBe(403);

    const d = await as('post', `/api/loads/${id}/tender/decline`, gold).send({ reason: 'No truck <b>there</b>' });
    expect(d.status).toBe(200);
    const l = await plan(id);
    expect(String(l.tender.offeredTo)).toBe(String(silver._id));
    expect(l.tenderPlan.history[0]).toMatchObject({ outcome: 'declined', reason: 'No truck  b there /b' });
    expect((await as('put', `/api/loads/${id}/accept`, gold).send({})).status).toBe(404);
    expect((await as('post', `/api/loads/${id}/tender/decline`, gold).send({})).status).toBe(404);
    expect(await visibleTo(silver, id)).toBe(true);
  });

  test('an offer that runs out passes on; when the line is done the load falls back and the shipper is told', async () => {
    const r = await post({ responseMinutes: 15, fallback: 'public' });
    const id = r.body._id;
    expect((await runTenderCheck(later(10))).moved).toBe(0);
    expect((await runTenderCheck(later(16))).moved).toBe(1);
    let l = await plan(id);
    expect(String(l.tender.offeredTo)).toBe(String(silver._id));
    // offers are timed from when they were made
    expect(new Date(l.tender.expiresAt).getTime()).toBeGreaterThan(later(30).getTime());
    await runTenderCheck(later(40));
    await runTenderCheck(later(60));
    l = await plan(id);
    expect(l.loadVisibility).toBe('public');
    expect(l.tender?.offeredTo).toBeUndefined();
    expect(l.tenderPlan.result).toBe('exhausted');
    expect(l.tenderPlan.history.map((h) => h.outcome)).toEqual(['expired', 'expired', 'expired']);
    expect(await Notification.countDocuments({ userId: shipper._id, type: 'tender:exhausted' })).toBe(1);
    expect(await visibleTo(outsider, id)).toBe(true);
    expect((await as('put', `/api/loads/${id}/accept`, outsider).send({})).status).toBe(200);
  });

  test('an expired offer cannot be booked even before the job has moved it', async () => {
    const r = await post({ responseMinutes: 5 });
    await Load.updateOne({ _id: r.body._id }, { $set: { 'tender.expiresAt': new Date(Date.now() - 1000) } });
    expect((await as('put', `/api/loads/${r.body._id}/accept`, gold).send({})).status).toBe(404);
    expect(await visibleTo(gold, r.body._id)).toBe(false);
  });

  test('the atomic booking write refuses a carrier that does not hold the offer', async () => {
    const r = await post();
    const gate = { fingerprint: {}, riskFlags: [] };
    expect(await atomicBookLoad({ loadId: r.body._id, carrierId: silver._id, gate })).toBeNull();
    expect(await atomicBookLoad({ loadId: r.body._id, carrierId: gold._id, gate })).not.toBeNull();
  });

  test('suspended, deactivated and removed carriers are skipped', async () => {
    await User.updateOne({ _id: gold._id }, { $set: { 'verification.status': 'suspended' } });
    await PreferredCarrier.updateOne({ shipper: shipper._id, carrier: silver._id }, { $set: { isActive: true } });
    const r = await post({ carrierIds: [String(gold._id), String(silver._id), String(std._id)] });
    expect(r.body.tender.offeredTo).toBe(String(silver._id));
    await PreferredCarrier.deleteOne({ shipper: shipper._id, carrier: std._id });
    await as('post', `/api/loads/${r.body._id}/tender/decline`, silver).send({});
    const l = await plan(r.body._id);
    expect(l.loadVisibility).toBe('public');
    expect(l.tenderPlan.history.map((h) => h.outcome)).toEqual(['skipped', 'declined', 'skipped']);
  });

  test('a carrier that books and gives the load back loses the offer to the next in line', async () => {
    const r = await post({ responseMinutes: 240 });
    const id = r.body._id;
    await as('put', `/api/loads/${id}/accept`, gold).send({});
    await Load.updateOne({ _id: id }, { $set: { status: 'open', acceptedBy: null } });
    // still inside the original answer window, but the offer was used up by booking
    expect(await visibleTo(gold, id)).toBe(false);
    expect((await as('put', `/api/loads/${id}/accept`, gold).send({})).status).toBe(404);
    await runTenderCheck();
    const l = await plan(id);
    expect(String(l.tender.offeredTo)).toBe(String(silver._id));
    expect(l.tenderPlan.history[0].outcome).toBe('cancelled');
  });

  test('no bids on a tender load', async () => {
    const r = await post();
    const b = await as('post', '/api/bids', gold).send({ loadId: r.body._id, amount: 2600 });
    expect(b.status).toBeGreaterThanOrEqual(400);
    expect((await as('post', '/api/bids', silver).send({ loadId: r.body._id, amount: 2600 })).status).toBeGreaterThanOrEqual(400);
  });

  test('input is validated; tender visibility cannot be set directly', async () => {
    expect((await as('post', '/api/loads', shipper).send(body({ loadVisibility: 'tender' }))).status).toBe(400);
    expect((await post({ responseMinutes: 2 })).status).toBe(400);
    expect((await post({ fallback: 'nobody' })).status).toBe(400);
    expect((await post({ carrierIds: [String(outsider._id)] })).status).toBe(400);
    expect((await post({ carrierIds: [String(gold._id), String(gold._id)] })).status).toBe(400);
    expect((await post({ carrierIds: [{ $ne: null }] })).status).toBe(400);
    expect((await post('yes')).status).toBe(400);
    const lonely = await verifiedShipper();
    expect((await as('post', '/api/loads', lonely).send(body({ tender: {} }))).status).toBe(400);
    expect(await Load.countDocuments({})).toBe(0);
    const pub = await as('post', '/api/loads', shipper).send(body());
    expect((await as('put', `/api/loads/${pub.body._id}`, shipper).send({ loadVisibility: 'tender' })).status).toBe(400);
  });

  test('the shipper sees the line; nobody else does; changing visibility stops the tender', async () => {
    const r = await post({ fallback: 'private' });
    const id = r.body._id;
    await as('post', `/api/loads/${id}/tender/decline`, gold).send({});
    const s = await as('get', `/api/loads/${id}/tender`, shipper);
    expect(s.status).toBe(200);
    expect(s.body.tender.queue.map((q) => q.state)).toEqual(['declined', 'offered', 'waiting']);
    expect(s.body.tender.fallback).toBe('private');
    expect((await as('get', `/api/loads/${id}/tender`, silver)).status).toBe(403);
    expect((await as('get', `/api/loads/${id}/tender`, await verifiedShipper())).status).toBe(404);

    const e = await as('put', `/api/loads/${id}`, shipper).send({ loadVisibility: 'public' });
    expect(e.status).toBe(200);
    const l = await plan(id);
    expect(l.loadVisibility).toBe('public');
    expect(l.tender?.offeredTo).toBeUndefined();
    expect(l.tenderPlan.result).toBe('stopped');
    expect((await runTenderCheck(later(600))).checked).toBe(0);
    const after = await as('get', `/api/loads/${id}/tender`, shipper);
    expect(after.body.tender.active).toBe(false);
    expect(after.body.tender.queue.map((q) => q.state)).toEqual(['declined', 'not_offered', 'not_offered']);
  });

  test('a load posted without coordinates starts its tender once it is located', async () => {
    fetch.mockRejectedValue(new Error('geocoder down'));
    const r = await post();
    expect(r.status).toBe(201);
    expect(r.body.needsLocation).toBe(true);
    expect(r.body.tender?.offeredTo).toBeUndefined();
    expect((await runTenderCheck()).checked).toBe(0);
    await Load.updateOne({ _id: r.body._id }, { $set: { originLat: 41, originLng: -87, destinationLat: 32, destinationLng: -96 } });
    expect((await runTenderCheck()).moved).toBe(1);
    expect(String((await plan(r.body._id)).tender.offeredTo)).toBe(String(gold._id));
  });
});

describe('carrier network routes', () => {
  test('add by DOT number, company-level ownership, candidates, for-load', async () => {
    const shipper = await verifiedShipper();
    const carrier = await verifiedCarrier({ dot: '7654321' });
    const member = await createTestUser({ role: 'carrier', parentAccountId: carrier._id });
    expect((await as('post', '/api/preferred-carriers', shipper).send({})).status).toBe(400);
    expect((await as('post', '/api/preferred-carriers', shipper).send({ dotNumber: '1111111' })).status).toBe(404);
    expect((await as('post', '/api/preferred-carriers', shipper).send({ carrierId: String(member._id) })).status).toBe(404);
    const add = await as('post', '/api/preferred-carriers', shipper).send({ dotNumber: '7654321', tier: 'gold' });
    expect(add.status).toBe(201);
    expect(String(add.body.carrier)).toBe(String(carrier._id));
    expect((await as('post', '/api/preferred-carriers', shipper).send({ dotNumber: '7654321' })).status).toBe(409);

    const hauler = await verifiedCarrier();
    await Load.create({ title: 'Done', origin: 'A', destination: 'B', rate: 100, equipmentType: 'Dry Van', postedBy: shipper._id, acceptedBy: hauler._id, status: 'delivered' });
    const c = await as('get', '/api/preferred-carriers/candidates', shipper);
    expect(c.body.map((u) => String(u._id))).toEqual([String(hauler._id)]);
    expect(c.body[0].email).toBeUndefined();

    const priv = await Load.create({ title: 'P', origin: 'A', destination: 'B', rate: 100, equipmentType: 'Dry Van', postedBy: shipper._id, status: 'open', loadVisibility: 'private' });
    expect((await as('get', `/api/preferred-carriers/for-load/${priv._id}`, hauler)).status).toBe(404);
    const mine = await as('get', `/api/preferred-carriers/for-load/${priv._id}`, carrier);
    expect(mine.body).toMatchObject({ hasAccess: true, isPreferred: true, tier: 'gold' });
    expect((await as('delete', '/api/preferred-carriers/not-an-id', shipper)).status).toBe(400);
  });
});
