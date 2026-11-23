/**
 * Integration: Truck Autopilot routes (/api/autopilot).
 */
require('../setup');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const User = require('../../models/User');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');

const CHI = { lat: 41.8781, lng: -87.6298 };
const MKE = { lat: 43.0389, lng: -87.9065 };

const subToken = (user, role, owner) => jwt.sign(
  { userId: String(user._id), role: 'carrier', companyRole: role, companyOwnerId: String(owner._id) },
  process.env.JWT_SECRET, { expiresIn: '1d' });

describe('autopilot routes', () => {
  let app, owner, ownerToken, shipper, other;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const plan = (token, q = 'truckId=T1') => request(app).get(`/api/autopilot/plan?${q}`).set(auth(token));
  const mkLoad = (poster, over = {}) => createTestLoad(poster._id || poster, {
    title: 'Chi-Mke', origin: 'Chicago, IL', destination: 'Milwaukee, WI',
    originLat: CHI.lat, originLng: CHI.lng, destinationLat: MKE.lat, destinationLng: MKE.lng,
    distanceMiles: 92, rate: 400,
    pickupTimeWindow: { start: new Date(), end: new Date(Date.now() + 24 * 3600000) },
    deliveryTimeWindow: { start: new Date(), end: new Date(Date.now() + 72 * 3600000) },
    ...over,
  });

  beforeEach(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/autopilot', require('../../routes/autopilotRoutes'));

    shipper = await createTestUser({ role: 'shipper' });
    owner = await createTestUser({
      role: 'carrier', companyRole: 'owner',
      fleet: [
        { truckId: 'T1', driverName: 'Dan Driver', location: { latitude: 41.9, longitude: -87.7, updatedAt: new Date() } },
        { truckId: 'T2', location: { latitude: 41.9, longitude: -87.7, updatedAt: new Date() } },
      ],
      drivers: [{ driverId: 'D1', name: 'Dan Driver', assignedTruckId: 'T1' }],
      preferences: { equipmentTypes: ['Dry Van'], costPerMileCents: 150 },
    });
    ownerToken = generateToken(owner);
    other = await createTestUser({ role: 'carrier', fleet: [{ truckId: 'OTHER-1' }] });
  });

  test('carrier gets a plan from seeded loads, with the public load summary and honest assumptions', async () => {
    const a = await mkLoad(shipper);
    const res = await plan(ownerToken);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.startSource).toBe('truck_location');
    expect(d.hosAssumed).toBe(true);
    expect(d.plans.length).toBeGreaterThan(0);
    const leg = d.plans[0].legs[0];
    expect(leg.loadId).toBe(String(a._id));
    expect(leg.load.rateCents).toBe(40000);
    expect(leg.load.termsVersion).toBe(1);
    expect(leg.load.postedBy.name).toBeDefined();
    expect(leg.load.postedBy.email).toBeUndefined();
    expect(leg.load.postedBy.password).toBeUndefined();
    expect(Number.isInteger(d.plans[0].totals.netCents)).toBe(true);
  });

  test('a private/preferred load of a shipper that has not preferred this carrier never appears', async () => {
    const pub = await mkLoad(shipper, { title: 'public', rate: 300 });
    const priv = await mkLoad(shipper, { title: 'private', loadVisibility: 'private', rate: 9000 });
    const pref = await mkLoad(shipper, { title: 'preferred', loadVisibility: 'preferred', rate: 9000 });
    const d = (await plan(ownerToken)).body.data;
    const ids = d.plans.flatMap((p) => p.loadIds);
    expect(ids).toContain(String(pub._id));
    expect(ids).not.toContain(String(priv._id));
    expect(ids).not.toContain(String(pref._id));
  });

  test("the company's own posting never appears", async () => {
    const own = await mkLoad(owner, { title: 'own', rate: 9000 });
    await mkLoad(shipper, { title: 'public', rate: 300 });
    const ids = (await plan(ownerToken)).body.data.plans.flatMap((p) => p.loadIds);
    expect(ids).not.toContain(String(own._id));
    expect(ids.length).toBeGreaterThan(0);
  });

  test('a load with no pickup window is reported, not planned', async () => {
    await mkLoad(shipper, { pickupTimeWindow: {} });
    const d = (await plan(ownerToken)).body.data;
    expect(d.plans).toHaveLength(0);
    expect(d.excluded.noWindow).toBe(1);
  });

  test('a booked load assigned to the truck moves the start to its destination', async () => {
    await mkLoad(shipper, { status: 'in-transit', acceptedBy: owner._id, assignedTruckId: 'T1', title: 'booked' });
    const d = (await plan(ownerToken)).body.data;
    expect(d.startSource).toBe('booked_load');
    expect(d.start.lat).toBeCloseTo(MKE.lat, 3);
    expect(new Date(d.start.availableAt).getTime()).toBeGreaterThan(Date.now() + 60 * 3600000);
  });

  test('no location anywhere -> 400 asking for a starting location; lat/lng from the request works', async () => {
    await User.updateOne({ _id: owner._id }, { $set: { 'fleet.0.location': {} } });
    const r1 = await plan(ownerToken);
    expect(r1.status).toBe(400);
    expect(r1.body.error).toMatch(/starting location/i);
    const r2 = await plan(ownerToken, 'truckId=T1&lat=41.9&lng=-87.7');
    expect(r2.status).toBe(200);
    expect(r2.body.data.startSource).toBe('request');
  });

  test('shipper role -> 403', async () => {
    expect((await plan(generateToken(shipper))).status).toBe(403);
  });

  test("another company's truckId -> 404", async () => {
    expect((await plan(ownerToken, 'truckId=OTHER-1')).status).toBe(404);
  });

  test('driver sub-account is limited to the truck assigned to them', async () => {
    const driver = await createTestUser({ role: 'carrier', companyRole: 'driver', parentAccountId: owner._id, name: 'Dan Driver' });
    const t = subToken(driver, 'driver', owner);
    await mkLoad(shipper);
    const mine = await plan(t, 'truckId=T1');
    expect(mine.status).toBe(200);
    // cost per mile is owner/dispatcher data: a driver's plan carries no cost or net
    expect(mine.body.data.plans[0].totals.netCents).toBeNull();
    expect(mine.body.data.rules.costPerMileCents).toBeUndefined();
    expect((await plan(ownerToken)).body.data.plans[0].totals.netCents).not.toBeNull();
    expect((await plan(t, 'truckId=T2')).status).toBe(403);
    const dispatcher = await createTestUser({ role: 'carrier', companyRole: 'dispatcher', parentAccountId: owner._id });
    expect((await plan(subToken(dispatcher, 'dispatcher', owner), 'truckId=T2')).status).toBe(200);
  });

  test('invalid query -> 400', async () => {
    for (const q of ['', 'truckId=T1&lat=999&lng=0', 'truckId=T1&lat=10', 'truckId=T1&maxLoads=9',
      'truckId=T1&minRatePerMileCents=-1', 'truckId=T1&maxDeadheadMiles=abc', 'truckId=T1&homeBy=yesterday']) {
      expect((await plan(ownerToken, q)).status).toBe(400);
    }
  });

  test('unauthenticated -> 401', async () => {
    expect((await request(app).get('/api/autopilot/plan?truckId=T1')).status).toBe(401);
  });

  describe('rules', () => {
    const put = (token, body) => request(app).put('/api/autopilot/rules').set(auth(token)).send(body);

    test('owner saves, reads back, and the plan honours the saved min rate', async () => {
      await mkLoad(shipper, { rate: 400 }); // ~$4.3/mi loaded
      const res = await put(ownerToken, { minRatePerMileCents: 5000, maxDeadheadMiles: 80, allowHazmat: false });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ minRatePerMileCents: 5000, maxDeadheadMiles: 80, costPerMileCents: 150 });
      const get = await request(app).get('/api/autopilot/rules').set(auth(ownerToken));
      expect(get.body.data.minRatePerMileCents).toBe(5000);
      const d = (await plan(ownerToken)).body.data;
      expect(d.plans).toHaveLength(0);
      expect(d.excluded.belowMinRate).toBe(1);
      // a request override wins for that one call
      const d2 = (await plan(ownerToken, 'truckId=T1&minRatePerMileCents=0')).body.data;
      expect(d2.plans.length).toBeGreaterThan(0);
    });

    test('values are bounded and typed', async () => {
      for (const body of [{ minRatePerMileCents: 99999 }, { maxDeadheadMiles: 0 }, { maxDeadheadMiles: 5000 },
        { maxWeightLbs: 'heavy' }, { allowHazmat: 'maybe' }, { homeBy: 'soon' }]) {
        expect((await put(ownerToken, body)).status).toBe(400);
      }
    });

    test('null clears a rule', async () => {
      await put(ownerToken, { maxDeadheadMiles: 100 });
      const res = await put(ownerToken, { maxDeadheadMiles: null });
      expect(res.status).toBe(200);
      expect(res.body.data.maxDeadheadMiles).toBeNull();
    });

    test('drivers and shippers cannot change or read rules; dispatchers can', async () => {
      const driver = await createTestUser({ role: 'carrier', companyRole: 'driver', parentAccountId: owner._id });
      const dispatcher = await createTestUser({ role: 'carrier', companyRole: 'dispatcher', parentAccountId: owner._id });
      expect((await put(subToken(driver, 'driver', owner), { maxDeadheadMiles: 50 })).status).toBe(403);
      expect((await put(generateToken(shipper), { maxDeadheadMiles: 50 })).status).toBe(403);
      expect((await request(app).get('/api/autopilot/rules').set(auth(subToken(driver, 'driver', owner)))).status).toBe(403);
      expect((await put(subToken(dispatcher, 'dispatcher', owner), { maxDeadheadMiles: 50 })).status).toBe(200);
      expect((await User.findById(owner._id).lean()).preferences.autopilot.maxDeadheadMiles).toBe(50);
    });
  });
});
