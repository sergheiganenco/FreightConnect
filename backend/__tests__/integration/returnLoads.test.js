/**
 * Integration: return-load (deadhead) suggestions for a carrier company's load.
 */

require('../setup');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');

const HOUR = 3600000;
const DEST = { lat: 32.7767, lng: -96.7970 };     // Dallas
const NEAR = { lat: 32.9, lng: -96.9 };           // ~10 mi from Dallas
const FAR = { lat: 41.88, lng: -87.63 };          // Chicago

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/return-loads', require('../../routes/returnLoadRoutes'));
  return app;
}

describe('return load suggestions', () => {
  let app, shipper, owner, ownerToken, dispatcherToken, otherToken, current;
  const deliveryEnd = new Date(Date.now() + 24 * HOUR);
  const after = (h) => ({ start: new Date(deliveryEnd.getTime() + h * HOUR), end: new Date(deliveryEnd.getTime() + (h + 8) * HOUR) });

  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    owner = await createTestUser({ role: 'carrier', companyRole: 'owner' });
    ownerToken = generateToken(owner);
    dispatcherToken = jwt.sign(
      { userId: String(shipper._id), role: 'carrier', companyRole: 'dispatcher', companyOwnerId: String(owner._id) },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );
    otherToken = generateToken(await createTestUser({ role: 'carrier' }));

    current = await createTestLoad(shipper._id, {
      title: 'Current', status: 'in-transit', acceptedBy: owner._id,
      destinationLat: DEST.lat, destinationLng: DEST.lng,
      deliveryTimeWindow: { start: new Date(), end: deliveryEnd },
    });

    const mk = (title, over) => createTestLoad(shipper._id, {
      title, originLat: DEST.lat, originLng: DEST.lng, pickupTimeWindow: after(4), ...over,
    });
    await mk('near-ok', { originLat: NEAR.lat, originLng: NEAR.lng, rate: 1000 });
    await mk('far', { originLat: FAR.lat, originLng: FAR.lng });
    await mk('not-open', { originLat: NEAR.lat, originLng: NEAR.lng, status: 'accepted' });
    await mk('too-early', {
      originLat: NEAR.lat, originLng: NEAR.lng,
      pickupTimeWindow: { start: new Date(deliveryEnd.getTime() - 10 * HOUR), end: new Date(deliveryEnd.getTime() - 2 * HOUR) },
    });
    await createTestLoad(owner._id, { title: 'own-posting', originLat: NEAR.lat, originLng: NEAR.lng, pickupTimeWindow: after(4) });
  });

  const get = (id, token) => request(app).get(`/api/return-loads/${id}`).set('Authorization', `Bearer ${token}`);

  test('owner gets nearby open, time-compatible loads only', async () => {
    const res = await get(current._id, ownerToken);
    expect(res.status).toBe(200);
    expect(res.body.distanceMethod).toBe('straight-line');
    expect(res.body.suggestions.map((s) => s.load.title)).toEqual(['near-ok']);
    const s = res.body.suggestions[0];
    expect(s.load.rateCents).toBe(100000);
    expect(s.approxDeadheadMiles).toBeGreaterThan(0);
    expect(s.approxDeadheadMiles).toBeLessThan(50);
  });

  describe('first-look (preferred visibility) gating', () => {
    const PreferredCarrier = require('../../models/PreferredCarrier');
    const titles = async () => (await get(current._id, ownerToken)).body.suggestions.map((s) => s.load.title);
    const mkPreferred = (over) => createTestLoad(shipper._id, {
      title: 'pref', loadVisibility: 'preferred', originLat: NEAR.lat, originLng: NEAR.lng,
      pickupTimeWindow: after(4), ...over,
    });

    test('hidden from a non-preferred carrier inside the window', async () => {
      await mkPreferred();
      expect(await titles()).not.toContain('pref');
    });
    test('suggested once the carrier is preferred', async () => {
      await mkPreferred();
      await PreferredCarrier.create({ shipper: shipper._id, carrier: owner._id });
      expect(await titles()).toContain('pref');
    });
    test('suggested after the 2h window', async () => {
      await mkPreferred({ createdAt: new Date(Date.now() - 3 * HOUR) });
      expect(await titles()).toContain('pref');
    });
  });

  test('dispatcher sub-account of the same company gets the same result', async () => {
    const res = await get(current._id, dispatcherToken);
    expect(res.status).toBe(200);
    expect(res.body.suggestions.map((s) => s.load.title)).toEqual(['near-ok']);
  });

  test('a different carrier is forbidden', async () => {
    expect((await get(current._id, otherToken)).status).toBe(403);
  });

  test('invalid id -> 400', async () => {
    expect((await get('not-an-id', ownerToken)).status).toBe(400);
  });
});
