/**
 * Integration: estimated profit annotation on GET /api/loads and the
 * costPerMileCents setting on PUT /api/users/me/preferences.
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const { haversineMiles, round } = require('../../utils/geo');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {} };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loads', require('../../routes/loadRoutes')(mockIo));
  app.use('/api/users', require('../../routes/userRoutes'));
  return app;
}

const subToken = (sub, owner, companyRole) =>
  jwt.sign({ userId: sub._id, role: 'carrier', companyRole, companyOwnerId: owner._id }, process.env.JWT_SECRET, { expiresIn: '1d' });

describe('load economics', () => {
  let app, owner, ownerToken, shipper, load;

  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    owner = await createTestUser({ role: 'carrier', companyRole: 'owner' });
    ownerToken = generateToken(owner);
    load = await createTestLoad(shipper._id, { rate: 2650.10 }); // Chicago -> Dallas
  });

  const getLoad = (token, query = {}) =>
    request(app).get('/api/loads').query(query).set('Authorization', `Bearer ${token}`)
      .then((r) => r.body.find((l) => String(l._id) === String(load._id)));

  const trip = () => round(haversineMiles(41.8781, -87.6298, 32.7767, -96.7970), 0);

  test('owner with cost set gets exact economics (trip only)', async () => {
    await User.findByIdAndUpdate(owner._id, { 'preferences.costPerMileCents': 187 });
    const l = await getLoad(ownerToken);
    const t = trip();
    const cost = 187 * t;
    expect(l.economics).toMatchObject({
      rateCents: 265010, costPerMileCents: 187, costCents: cost, profitCents: 265010 - cost,
      totalMiles: t, includesDeadhead: false, milesBasis: 'straight_line', deadheadBasis: null,
    });
  });

  test('with an origin search the deadhead miles are included', async () => {
    await User.findByIdAndUpdate(owner._id, { 'preferences.costPerMileCents': 100 });
    const l = await getLoad(ownerToken, { originLat: 41.8781, originLng: -87.6298, originRadius: 50 });
    expect(l.economics.includesDeadhead).toBe(true);
    expect(l.economics.deadheadBasis).toBe('straight_line');
    expect(l.economics.totalMiles).toBe(l.tripMiles + l.deadheadMiles);
    expect(l.economics.costCents).toBe(100 * (l.tripMiles + l.deadheadMiles));
  });

  test('GET /loads/:id carries the same annotations as the board (return-load modal)', async () => {
    await User.findByIdAndUpdate(owner._id, { 'preferences.costPerMileCents': 100 });
    const one = await request(app).get(`/api/loads/${load._id}`).query({ deadheadMiles: 25 }).set('Authorization', `Bearer ${ownerToken}`);
    expect(one.status).toBe(200);
    expect(one.body.status).toBe('open');
    expect(one.body.tripMiles).toBe(trip());
    expect(one.body.economics).toMatchObject({ includesDeadhead: true, totalMiles: trip() + 25 });
    const drv = await request(app).get(`/api/loads/${load._id}`)
      .set('Authorization', `Bearer ${subToken(await createTestUser({ role: 'carrier', companyRole: 'driver' }), owner, 'driver')}`);
    expect(drv.status).toBe(200);
    expect(drv.body.economics).toBeUndefined();
    const sh = await request(app).get(`/api/loads/${load._id}`).set('Authorization', `Bearer ${generateToken(shipper)}`);
    expect(sh.body.economics).toBeUndefined();
  });

  test('economics is null when cost is unset', async () => {
    const l = await getLoad(ownerToken);
    expect(l.economics).toBeNull();
  });

  test('shipper never gets economics', async () => {
    await User.findByIdAndUpdate(owner._id, { 'preferences.costPerMileCents': 187 });
    const l = await getLoad(generateToken(shipper));
    expect(l).toBeDefined();
    expect(l).not.toHaveProperty('economics');
  });

  test('dispatcher sees owner cost; driver never gets economics', async () => {
    await User.findByIdAndUpdate(owner._id, { 'preferences.costPerMileCents': 187 });
    const disp = await createTestUser({ role: 'carrier', companyRole: 'dispatcher' });
    const drv = await createTestUser({ role: 'carrier', companyRole: 'driver' });
    const ld = await getLoad(subToken(disp, owner, 'dispatcher'));
    expect(ld.economics.costPerMileCents).toBe(187);
    const lv = await getLoad(subToken(drv, owner, 'driver'));
    expect(lv).toBeDefined();
    expect(lv).not.toHaveProperty('economics');
  });

  describe('PUT /me/preferences costPerMileCents', () => {
    const put = (token, body) => request(app).put('/api/users/me/preferences').set('Authorization', `Bearer ${token}`).send(body);

    test.each([[0], [-5], [1.5], [2001], ['187'], ['abc']])('rejects %p', async (v) => {
      const res = await put(ownerToken, { costPerMileCents: v });
      expect(res.status).toBe(400);
      expect((await User.findById(owner._id)).preferences.costPerMileCents ?? null).toBeNull();
    });

    test('accepts 1, 2000, then null clears', async () => {
      expect((await put(ownerToken, { costPerMileCents: 1 })).status).toBe(200);
      expect((await put(ownerToken, { costPerMileCents: 2000 })).status).toBe(200);
      expect((await User.findById(owner._id)).preferences.costPerMileCents).toBe(2000);
      const res = await put(ownerToken, { costPerMileCents: null });
      expect(res.status).toBe(200);
      expect((await User.findById(owner._id)).preferences.costPerMileCents).toBeNull();
    });

    test('driver and dispatcher are forbidden; only the owner writes', async () => {
      const drv = await createTestUser({ role: 'carrier', companyRole: 'driver' });
      expect((await put(subToken(drv, owner, 'driver'), { costPerMileCents: 150 })).status).toBe(403);
      const disp = await createTestUser({ role: 'carrier', companyRole: 'dispatcher' });
      expect((await put(subToken(disp, owner, 'dispatcher'), { costPerMileCents: 150 })).status).toBe(403);
      expect((await User.findById(owner._id)).preferences.costPerMileCents ?? null).toBeNull();
      expect((await put(ownerToken, { costPerMileCents: 150 })).status).toBe(200);
      expect((await User.findById(owner._id)).preferences.costPerMileCents).toBe(150);
    });
  });
});
