/**
 * Integration: provenance of the evidence the pickup no-show logic and detention billing rely on.
 *  - pickup/delivery window handlers fail closed on missing bounds and persist the validated instants
 *  - an unauthenticated ping never touches carrierLocation.lastAuthenticated
 *  - dwell events record whether the position was authenticated; detention from an unverified one is never auto-collected
 *  - an ELD vehicle only ever feeds the load it is assigned to
 */
require('../setup');
const express = require('express');
const request = require('supertest');

const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const Load = require('../../models/Load');
const DwellEvent = require('../../models/DwellEvent');
const EldConnection = require('../../models/EldConnection');
const { recordLocation } = require('../../services/trackingService');
const { resolveVehicleLoad } = require('../../services/eldLoadResolver');

jest.mock('../../services/eld', () => ({ getProvider: jest.fn() }));
const { getProvider } = require('../../services/eld');

const io = { to: () => ({ emit: () => {} }), emit: () => {} };
const MIN = 60000;
const at = (min) => new Date(Date.now() + min * MIN);
const bearer = (u) => ({ Authorization: `Bearer ${generateToken(u)}` });
const consent = { tracking: { gpsConsent: { granted: true, grantedAt: new Date(), version: '1' } } };
const carrierUser = (o = {}) => createTestUser({
  role: 'carrier', ...consent,
  verification: { status: 'verified', identityVerified: true, insurance: { status: 'valid' } },
  fleet: [{ truckId: 'T1', status: 'Available' }], ...o,
});
const book = (load, carrier) => Load.findOneAndUpdate({ _id: load._id, status: 'open' }, { $set: { status: 'accepted', acceptedBy: carrier._id } });

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loads', require('../../routes/loadRoutes')(io));
  app.use('/api/detention', require('../../routes/detentionRoutes'));
  return app;
}

describe('window handlers fail closed and persist the validated instants', () => {
  let app, shipper, carrier, load;
  const pw = (start, end) => request(app).put(`/api/loads/${load._id}/pickup-window`).set(bearer(shipper)).send({ start, end });
  const dw = (start, end) => request(app).put(`/api/loads/${load._id}/delivery-window`).set(bearer(shipper)).send({ start, end });
  const iso = (min) => at(min).toISOString();
  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    carrier = await carrierUser();
    load = await createTestLoad(shipper._id, { pickupTimeWindow: { start: at(300), end: at(420) } });
    await book(load, carrier);
  });

  test('missing agreed END: the effective end is start + 2h; anything tighter is only a proposal', async () => {
    await Load.updateOne({ _id: load._id }, { $unset: { 'bookedWindow.end': 1 } }); // agreed: +300 .. (+420 by the evaluator's fallback)
    const r = await pw(iso(300), iso(400)).expect(200); // ends before the effective end
    expect(r.body.windowChangeProposed).toBe(true);
    expect((await Load.findById(load._id)).pickupWindowChange.status).toBe('pending');
    const r2 = await pw(iso(150), iso(900)).expect(200); // earlier start
    expect(r2.body.windowChangeProposed).toBe(true);
    const end = iso(430);
    const ok = await pw(iso(300), end).expect(200); // not earlier on either effective bound: lenient
    expect(ok.body.windowChangeProposed).toBeUndefined();
    expect((await Load.findById(load._id)).bookedWindow.end.getTime()).toBe(new Date(end).getTime());
  });

  test('missing agreed START and END entirely: never applied without the carrier', async () => {
    await Load.updateOne({ _id: load._id }, { $unset: { bookedWindow: 1, pickupTimeWindow: 1 } });
    const r = await pw(iso(150), iso(200)).expect(200);
    expect(r.body.windowChangeProposed).toBe(true);
    const fresh = await Load.findById(load._id).lean();
    expect(fresh.bookedWindow && fresh.bookedWindow.start).toBeFalsy();
    expect(fresh.pickupTimeWindow && fresh.pickupTimeWindow.start).toBeFalsy(); // not applied
  });

  test('delivery window of a booked load with a missing bound (or no window) is refused', async () => {
    const d = (await Load.findById(load._id)).deliveryTimeWindow;
    await dw(d.start.toISOString(), new Date(d.end.getTime() + MIN).toISOString()).expect(200); // complete window may still be extended
    await Load.updateOne({ _id: load._id }, { $unset: { 'deliveryTimeWindow.end': 1 } });
    const r = await dw(iso(1), iso(5)).expect(409);
    expect(r.body.error).toMatch(/without the carrier/);
    await Load.updateOne({ _id: load._id }, { $unset: { 'deliveryTimeWindow.start': 1 } });
    await dw(iso(1), iso(5)).expect(409);
    await Load.updateOne({ _id: load._id }, { $unset: { deliveryTimeWindow: 1 } });
    await dw(iso(1), iso(5)).expect(409);
    expect((await Load.findById(load._id).lean()).deliveryTimeWindow?.start).toBeFalsy(); // nothing persisted
  });

  test('stored values are the validated instants, as real Date objects', async () => {
    const s = iso(300), e = iso(500);
    await pw(s, e).expect(200); // lenient
    let raw = await Load.collection.findOne({ _id: load._id });
    for (const v of [raw.pickupTimeWindow.start, raw.pickupTimeWindow.end, raw.bookedWindow.start, raw.bookedWindow.end]) expect(v).toBeInstanceOf(Date);
    expect(raw.bookedWindow.start.getTime()).toBe(new Date(s).getTime());
    expect(raw.bookedWindow.end.getTime()).toBe(new Date(e).getTime());
    // an offset form is persisted as the same instant
    const off = '2030-01-01T10:00:00+02:00';
    const open = await createTestLoad(shipper._id);
    await request(app).put(`/api/loads/${open._id}/pickup-window`).set(bearer(shipper)).send({ start: off, end: '2030-01-01T12:00:00+02:00' }).expect(200);
    raw = await Load.collection.findOne({ _id: open._id });
    expect(raw.pickupTimeWindow.start).toBeInstanceOf(Date);
    expect(raw.pickupTimeWindow.start.getTime()).toBe(Date.UTC(2030, 0, 1, 8, 0, 0));
    await request(app).put(`/api/loads/${open._id}/delivery-window`).set(bearer(shipper)).send({ start: '2030-01-02T08:00:00Z', end: '2030-01-02T09:00:00.000Z' }).expect(200);
    raw = await Load.collection.findOne({ _id: open._id });
    expect(raw.deliveryTimeWindow.start).toBeInstanceOf(Date);
    expect(raw.deliveryTimeWindow.end.getTime()).toBe(Date.UTC(2030, 0, 2, 9, 0, 0));
  });

  test.each(['2026-13-45', 'tomorrow', '2030-01-01', '2030-01-01T10:00', '2030-01-01 10:00:00Z', '1893456000000', ''])('non-ISO or zone-less %p is rejected by both handlers', async (bad) => {
    const good = iso(600);
    await pw(bad, good).expect(400);
    await pw(good, bad).expect(400);
    await dw(bad, good).expect(400);
    await dw(good, bad).expect(400);
    await request(app).put(`/api/loads/${load._id}/pickup-window`).set(bearer(shipper)).send({ start: 1893456000000, end: good }).expect(400);
  });
});

describe('carrierLocation.lastAuthenticated', () => {
  test('only authenticated pings write it; a later token ping moves the live point but not the evidence; un-booking clears both', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await carrierUser();
    const load = await createTestLoad(shipper._id);
    await book(load, carrier);
    const ping = (lat, authenticated) => recordLocation({ loadId: load._id, latitude: lat, longitude: -87.6, source: authenticated ? 'mobile_app' : 'owntracks', authenticated });

    await ping(40.0, false);
    let l = await Load.findById(load._id).lean();
    expect(l.carrierLocation.latitude).toBe(40.0);
    expect(l.carrierLocation.lastAuthenticated && l.carrierLocation.lastAuthenticated.latitude).toBeUndefined(); // token ingest never sets it

    await ping(41.0, true);
    await ping(41.5, false);
    l = await Load.findById(load._id).lean();
    expect(l.carrierLocation).toMatchObject({ latitude: 41.5, authenticated: false, source: 'owntracks' }); // live map: latest of any kind
    expect(l.carrierLocation.lastAuthenticated).toMatchObject({ latitude: 41.0, source: 'mobile_app' });    // evidence untouched
    expect(l.carrierLocation.lastAuthenticated.updatedAt).toBeInstanceOf(Date);

    await ping(42.0, true);
    expect((await Load.findById(load._id).lean()).carrierLocation.lastAuthenticated.latitude).toBe(42.0);

    await Load.findOneAndUpdate({ _id: load._id }, { $set: { status: 'open', acceptedBy: null } });
    expect((await Load.findById(load._id).lean()).carrierLocation).toBeUndefined();
  });
});

describe('dwell events and detention from unverified positions', () => {
  const CHICAGO = { latitude: 41.8781, longitude: -87.6298 };
  const FAR = { latitude: 36.0, longitude: -93.0 };
  let app, shipper, carrier, load;
  const ping = (p, authenticated) => recordLocation({ loadId: load._id, ...p, source: authenticated ? 'mobile_app' : 'owntracks', authenticated });
  // Check in at the pickup, backdate the arrival 4h (2h detention), check out.
  async function dwell(arrAuth, depAuth) {
    await ping(CHICAGO, arrAuth);
    await DwellEvent.updateOne({ load: load._id }, { $set: { arrivedAt: new Date(Date.now() - 4 * 3600000) } });
    await ping(FAR, depAuth);
    return DwellEvent.findOne({ load: load._id }).lean();
  }
  const charge = async () => (await Load.findById(load._id)).accessorialCharges.find((c) => c.source === 'system_detention');
  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    carrier = await carrierUser();
    load = await createTestLoad(shipper._id);
    await book(load, carrier);
  });

  test('geofence check-in/out record whether each fix was authenticated; both authenticated = verified charge', async () => {
    const ev = await dwell(true, true);
    expect(ev).toMatchObject({ arrivalAuthenticated: true, departureAuthenticated: true });
    const c = await charge();
    expect(c.amountCents).toBeGreaterThan(0);
    expect(c.locationVerified).toBe(true);
    expect(c.description).not.toMatch(/needs review/);
  });

  test.each([[false, true], [true, false], [false, false]])('arrival auth=%s, departure auth=%s: charge is marked "needs review - location not verified"', async (a, d) => {
    const ev = await dwell(a, d);
    expect(ev).toMatchObject({ arrivalAuthenticated: a, departureAuthenticated: d });
    const c = await charge();
    expect(c.locationVerified).toBe(false);
    expect(c.status).toBe('pending'); // still proposed to the shipper, never auto-approved
    expect(c.description).toMatch(/needs review: location not verified/);
  });

  test('approval of an unverified charge never triggers the off-session collection; a verified one still does', async () => {
    const prev = process.env.ENABLE_ACCESSORIAL_COLLECTION;
    process.env.ENABLE_ACCESSORIAL_COLLECTION = 'true';
    const escrow = require('../../services/escrowService');
    const spy = jest.spyOn(escrow, 'collectAccessorialFromShipper').mockResolvedValue({ ok: false, code: 'stripe_unavailable' });
    const approve = (c) => request(app).put(`/api/loads/${load._id}/accessorials/${c._id}/approve`).set(bearer(shipper)).send({ evidenceHashShown: c.evidenceHash });
    try {
      await dwell(false, true);
      await approve(await charge()).expect(200);
      expect(spy).not.toHaveBeenCalled();
      expect(['approved', 'paid']).toContain((await charge()).status); // Path A accrual settles it as before

      const load2 = await createTestLoad(shipper._id);
      await book(load2, carrier);
      load = load2;
      await dwell(true, true);
      await approve(await charge()).expect(200);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      if (prev === undefined) delete process.env.ENABLE_ACCESSORIAL_COLLECTION; else process.env.ENABLE_ACCESSORIAL_COLLECTION = prev;
    }
  });

  test('manual check-in/depart records who did it and counts as an unverified position', async () => {
    const h = bearer(carrier);
    const inRes = await request(app).post(`/api/detention/check-in/${load._id}`).set(h).send({ stopType: 'pickup' }).expect(201);
    expect(inRes.body).toMatchObject({ arrivalAuthenticated: false, arrivalManualBy: String(carrier._id) });
    await DwellEvent.updateOne({ _id: inRes.body._id }, { $set: { arrivedAt: new Date(Date.now() - 4 * 3600000) } });
    const out = await request(app).patch(`/api/detention/depart/${inRes.body._id}`).set(h).send({}).expect(200);
    expect(out.body).toMatchObject({ departureAuthenticated: false, departureManualBy: String(carrier._id) });
    const c = await charge();
    expect(c.status).toBe('pending');
    expect(c.locationVerified).toBe(false);
  });
});

describe('ELD vehicle -> load resolution', () => {
  let carrier, shipper, l1, l2, conn;
  const mkLoad = async (truckId) => {
    const l = await createTestLoad(shipper._id);
    await book(l, carrier);
    await Load.updateOne({ _id: l._id }, { $set: { assignedTruckId: truckId } });
    return l;
  };
  beforeEach(async () => {
    shipper = await createTestUser({ role: 'shipper' });
    carrier = await carrierUser();
    l1 = await mkLoad('T1');
    l2 = await mkLoad('T2');
    conn = await EldConnection.create({ carrier: carrier._id, provider: 'motive', status: 'active',
      vehicleMap: [{ vehicleId: 'V1', truckId: 'T1' }, { vehicleId: 'V2', truckId: 'T2' }, { vehicleId: 'V3' }] });
  });

  test('each vehicle resolves to the load assigned to ITS truck, authenticated', async () => {
    expect(await resolveVehicleLoad(conn, 'V1')).toEqual({ loadId: l1._id, authenticated: true });
    expect(await resolveVehicleLoad(conn, 'V2')).toEqual({ loadId: l2._id, authenticated: true });
  });

  test('a driver mapping also ties a vehicle to its load', async () => {
    await Load.updateOne({ _id: l2._id }, { $set: { assignedDriverId: 'D9' } });
    conn.vehicleMap.push({ vehicleId: 'V4', driverId: 'D9' });
    expect((await resolveVehicleLoad(conn, 'V4')).loadId).toEqual(l2._id);
  });

  test('a vehicle that matches no load, or is unknown, is skipped when the carrier has several loads', async () => {
    expect(await resolveVehicleLoad(conn, 'V3')).toBeNull(); // mapped but not assigned: no guessing between two loads
    expect(await resolveVehicleLoad(conn, 'NOPE')).toBeNull();
  });

  test('prefers the in-transit leg of the same truck; two loads at the same stage on one truck are ambiguous', async () => {
    const l3 = await mkLoad('T1');
    expect(await resolveVehicleLoad(conn, 'V1')).toBeNull();
    await Load.updateOne({ _id: l3._id }, { $set: { status: 'in-transit' } });
    expect((await resolveVehicleLoad(conn, 'V1')).loadId).toEqual(l3._id);
  });

  test('exactly one active load and one mapped vehicle: unambiguous, unless explicitly assigned to another truck', async () => {
    await Load.updateOne({ _id: l2._id }, { $set: { status: 'cancelled' } });
    await Load.updateOne({ _id: l1._id }, { $set: { assignedTruckId: null } });
    const single = await EldConnection.create({ carrier: carrier._id, provider: 'samsara', status: 'active', vehicleMap: [{ vehicleId: 'S1' }] });
    expect((await resolveVehicleLoad(single, 'S1')).loadId).toEqual(l1._id);
    await Load.updateOne({ _id: l1._id }, { $set: { assignedTruckId: 'T7' } });
    single.vehicleMap = [{ vehicleId: 'S1', truckId: 'T8' }];
    expect(await resolveVehicleLoad(single, 'S1')).toBeNull();
    const two = { carrier: carrier._id, vehicleMap: [{ vehicleId: 'S1' }, { vehicleId: 'S2' }] };
    await Load.updateOne({ _id: l1._id }, { $set: { assignedTruckId: null } });
    expect(await resolveVehicleLoad(two, 'S1')).toBeNull(); // one load but two vehicles: cannot tell which truck
  });

  test('the poller records each vehicle on its own load only and marks it authenticated', async () => {
    const { runEldPoll } = require('../../jobs/eldPoller');
    getProvider.mockReturnValue({ fetchLocations: async () => ([
      { vehicleId: 'V1', latitude: 40.1, longitude: -88.1 },
      { vehicleId: 'V2', latitude: 33.3, longitude: -97.3 },
      { vehicleId: 'V3', latitude: 30.0, longitude: -90.0 }, // unassigned: skipped
    ]) });
    await runEldPoll();
    const a = await Load.findById(l1._id).lean();
    const b = await Load.findById(l2._id).lean();
    expect(a.carrierLocation).toMatchObject({ latitude: 40.1, source: 'eld', authenticated: true });
    expect(a.carrierLocation.lastAuthenticated).toMatchObject({ latitude: 40.1 });
    expect(b.carrierLocation).toMatchObject({ latitude: 33.3, source: 'eld', authenticated: true });
    expect(b.carrierLocation.lastAuthenticated.latitude).toBe(33.3);
  });
});
