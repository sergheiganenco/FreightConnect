/**
 * Integration: stored road distance (ORS) on loads. ORS is mocked via axios; no network.
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const axios = require('axios');
const Load = require('../../models/Load');
const User = require('../../models/User');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');

jest.mock('axios');

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {} };
const app = express();
app.use(express.json());
app.use('/api/loads', require('../../routes/loadRoutes')(mockIo));

// 1,609,344 m is exactly 1000 statute miles (1609.344 m/mi).
const ors = (meters) => ({ data: { features: [{ geometry: { coordinates: [[-87.6, 41.8], [-96.8, 32.7]] }, properties: { segments: [{ distance: meters, duration: 36000 }] } }] } });
const body = {
  title: 'Dist Load', origin: 'Chicago, IL', destination: 'Dallas, TX', rate: 2650.10, equipmentType: 'Dry Van',
  originLat: 41.8781, originLng: -87.6298, destinationLat: 32.7767, destinationLng: -96.797,
};

describe('load road distance', () => {
  let shipper, sTok;
  const post = (b = body) => request(app).post('/api/loads').set('Authorization', `Bearer ${sTok}`).send(b);

  beforeEach(async () => {
    process.env.ORS_API_KEY = 'test-key';
    axios.get.mockReset();
    shipper = await createTestUser({ role: 'shipper', shipperVerification: { status: 'verified', paymentMethodVerified: true } });
    sTok = generateToken(shipper);
  });

  test('create with coordinates stores converted + rounded road miles', async () => {
    axios.get.mockResolvedValue(ors(1500000)); // 932.055... mi
    const res = await post();
    expect(res.status).toBe(201);
    expect(res.body.distanceMiles).toBe(932.1);
    expect(res.body.distanceSource).toBe('ors');
    const url = axios.get.mock.calls[0][0];
    expect(url).toContain('driving-hgv');
    expect(url).toContain('start=-87.6298,41.8781&end=-96.797,32.7767');
    expect(axios.get.mock.calls[0][1].timeout).toBeGreaterThan(0);
    expect((await Load.findById(res.body._id)).distanceMiles).toBe(932.1);
  });

  test.each([
    ['ORS error/timeout', () => axios.get.mockRejectedValue(new Error('timeout of 4000ms exceeded'))],
    ['unset key', () => { delete process.env.ORS_API_KEY; }],
    ['shorter than straight-line', () => axios.get.mockResolvedValue(ors(100000))],
    ['zero distance', () => axios.get.mockResolvedValue(ors(0))],
    ['malformed body', () => axios.get.mockResolvedValue({ data: {} })],
  ])('%s -> load still created with null distance', async (_n, arrange) => {
    arrange();
    const res = await post();
    expect(res.status).toBe(201);
    expect(res.body.distanceMiles).toBeNull();
    expect(res.body.distanceSource).toBeNull();
  });

  test('multi-stop load stores null (route would ignore stops)', async () => {
    axios.get.mockResolvedValue(ors(1609344));
    const res = await post({ ...body, stops: [{ type: 'delivery', address: 'Tulsa, OK' }] });
    expect(res.status).toBe(201);
    expect(res.body.distanceMiles).toBeNull();
  });

  test('reconsign recomputes, and clears when ORS fails', async () => {
    const load = await createTestLoad(shipper._id, { status: 'accepted', distanceMiles: 1000, distanceSource: 'ors' });
    const put = (b) => request(app).put(`/api/loads/${load._id}/reconsign`).set('Authorization', `Bearer ${sTok}`).send(b);
    axios.get.mockResolvedValue(ors(500000)); // 310.7 mi; Chicago->Indianapolis straight-line ~165
    expect((await put({ newDestination: 'Indianapolis, IN', newDestinationLat: 39.7684, newDestinationLng: -86.1581 })).status).toBe(200);
    expect((await Load.findById(load._id)).distanceMiles).toBe(310.7);
    axios.get.mockRejectedValue(new Error('down'));
    expect((await put({ newDestination: 'Columbus, OH', newDestinationLat: 39.9612, newDestinationLng: -82.9988 })).status).toBe(200);
    expect((await Load.findById(load._id)).distanceMiles).toBeNull();
  });

  test('PUT /stops with stops clears the stored distance', async () => {
    const load = await createTestLoad(shipper._id, { distanceMiles: 1000, distanceSource: 'ors' });
    const res = await request(app).put(`/api/loads/${load._id}/stops`).set('Authorization', `Bearer ${sTok}`)
      .send({ stops: [{ type: 'delivery', address: 'Tulsa, OK', lat: 36.15, lng: -95.99 }] });
    expect(res.status).toBe(200);
    expect((await Load.findById(load._id)).distanceMiles).toBeNull();
  });

  test('GET /:id/route backfills a null distance and returns the same figure', async () => {
    const load = await createTestLoad(shipper._id);
    axios.get.mockResolvedValue(ors(1609344));
    const res = await request(app).get(`/api/loads/${load._id}/route`).set('Authorization', `Bearer ${sTok}`);
    expect(res.status).toBe(200);
    expect(Number(res.body.distance)).toBe(1000);
    expect(res.body.route.length).toBe(2);
    const saved = await Load.findById(load._id);
    expect(saved.distanceMiles).toBe(1000);
    expect(saved.distanceSource).toBe('ors');
  });

  test('GET /:id/route does not overwrite a stored distance', async () => {
    const load = await createTestLoad(shipper._id, { distanceMiles: 900, distanceSource: 'ors' });
    axios.get.mockResolvedValue(ors(1609344));
    const res = await request(app).get(`/api/loads/${load._id}/route`).set('Authorization', `Bearer ${sTok}`);
    expect(Number(res.body.distance)).toBe(900);
    expect((await Load.findById(load._id)).distanceMiles).toBe(900);
  });

  describe('GET /api/loads annotation', () => {
    let owner, oTok;
    const list = async (id) => (await request(app).get('/api/loads').set('Authorization', `Bearer ${oTok}`)).body.find((l) => String(l._id) === String(id));
    beforeEach(async () => {
      owner = await createTestUser({ role: 'carrier', companyRole: 'owner' });
      await User.findByIdAndUpdate(owner._id, { 'preferences.costPerMileCents': 187 });
      oTok = generateToken(owner);
    });

    test('stored road miles drive tripMiles, ratePerMile and economics (integer cents)', async () => {
      const load = await createTestLoad(shipper._id, { rate: 2650.10, distanceMiles: 1000, distanceSource: 'ors' });
      const l = await list(load._id);
      expect(l.tripMiles).toBe(1000);
      expect(l.milesBasis).toBe('road');
      expect(l.ratePerMile).toBe(2.65);
      // cost 187*1000 = 187000; profit 265010-187000 = 78010; per mile round(78010/1000) = 78
      expect(l.economics).toMatchObject({
        rateCents: 265010, costCents: 187000, profitCents: 78010, profitPerMileCents: 78,
        totalMiles: 1000, milesBasis: 'road', includesDeadhead: false,
      });
    });

    test('no stored distance falls back to straight-line', async () => {
      const load = await createTestLoad(shipper._id, { rate: 2650.10 });
      const l = await list(load._id);
      expect(l.milesBasis).toBe('straight_line');
      expect(l.tripMiles).toBeGreaterThan(780);
      expect(l.tripMiles).toBeLessThan(830);
      expect(l.economics.milesBasis).toBe('straight_line');
    });
  });
});
