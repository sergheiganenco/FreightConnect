/**
 * Integration: posting a load with typed city names (no coordinates).
 * A place the geocoder cannot find is refused (a load without coordinates can
 * never be accepted); a geocoder outage still lets the load post.
 * Nominatim is reached through node-fetch, which is mocked here; no network.
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const Load = require('../../models/Load');
const { createTestUser, generateToken } = require('../helpers');

jest.mock('axios'); // ORS road-distance lookup: unconfigured mock => null distance
jest.mock('node-fetch'); // the route geocodes through node-fetch
const fetch = require('node-fetch');

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {} };
const app = express();
app.use(express.json());
app.use('/api/loads', require('../../routes/loadRoutes')(mockIo));

const body = { title: 'Typed cities', origin: 'Austin, TX', destination: 'Denver, CO', rate: 1800, equipmentType: 'Dry Van' };
const hit = (lat, lon) => ({ ok: true, json: async () => [{ lat: String(lat), lon: String(lon) }] });
const miss = { ok: true, json: async () => [] };

describe('load posting geocode', () => {
  let tok;
  const post = (b = body) => request(app).post('/api/loads').set('Authorization', `Bearer ${tok}`).send(b);

  beforeEach(async () => {
    fetch.mockReset();
    const shipper = await createTestUser({ role: 'shipper', shipperVerification: { status: 'verified', paymentMethodVerified: true } });
    tok = generateToken(shipper);
  });

  test('typed cities are geocoded and stored', async () => {
    fetch
      .mockResolvedValueOnce(hit(30.2672, -97.7431))
      .mockResolvedValueOnce(hit(39.7392, -104.9903));
    const res = await post();
    expect(res.status).toBe(201);
    const load = await Load.findById(res.body._id);
    expect(load.originLat).toBeCloseTo(30.2672);
    expect(load.destinationLng).toBeCloseTo(-104.9903);
  });

  test('unknown pickup city is refused and nothing is saved', async () => {
    fetch.mockResolvedValueOnce(miss).mockResolvedValueOnce(hit(39.7392, -104.9903));
    const res = await post({ ...body, origin: 'Asutin TX' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/couldn't find the pickup location "Asutin TX"/);
    expect(await Load.countDocuments({ title: 'Typed cities' })).toBe(0);
  });

  test('unknown delivery city is refused', async () => {
    fetch.mockResolvedValueOnce(hit(30.2672, -97.7431)).mockResolvedValueOnce(miss);
    const res = await post({ ...body, destination: 'Dnver' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/delivery location "Dnver"/);
  });

  test('geocoder outage does not block posting', async () => {
    fetch.mockRejectedValue(new Error('network down'));
    const res = await post();
    expect(res.status).toBe(201);
    expect((await Load.findById(res.body._id)).originLat == null).toBe(true);
  });

  test('geocoder error status does not block posting', async () => {
    fetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    expect((await post()).status).toBe(201);
  });
});
