/**
 * Integration: jobs/loadLocator fills in coordinates for open loads that were posted without them.
 * Nominatim (node-fetch) and ORS (axios) are mocked; no network.
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const axios = require('axios');
const Load = require('../../models/Load');
const Notification = require('../../models/Notification');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const { runLoadLocator } = require('../../jobs/loadLocator');

jest.mock('axios');
jest.mock('node-fetch');
const fetch = require('node-fetch');

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {} };
const app = express();
app.use(express.json());
app.use('/api/loads', require('../../routes/loadRoutes')(mockIo));

const hit = (lat, lon) => ({ ok: true, json: async () => [{ lat: String(lat), lon: String(lon) }] });
const miss = { ok: true, json: async () => [] };
const ors = (meters) => ({ data: { features: [{ geometry: { coordinates: [[-87.6, 41.8], [-96.8, 32.7]] }, properties: { segments: [{ distance: meters, duration: 36000 }] } }] } });
const NO_COORDS = { originLat: undefined, originLng: undefined, destinationLat: undefined, destinationLng: undefined };

describe('loadLocator job', () => {
  let shipper;
  beforeEach(async () => {
    fetch.mockReset(); axios.get.mockReset();
    process.env.ORS_API_KEY = 'test-key';
    shipper = await createTestUser({ role: 'shipper' });
  });

  test('a located load becomes visible to carriers and gets road miles', async () => {
    const carrier = await createTestUser({ role: 'carrier' });
    const load = await createTestLoad(shipper._id, { title: 'Hidden', ...NO_COORDS });
    const board = () => request(app).get('/api/loads').set('Authorization', `Bearer ${generateToken(carrier)}`);
    expect((await board()).body.map((l) => l.title)).not.toContain('Hidden');

    fetch.mockResolvedValueOnce(hit(41.88, -87.63)).mockResolvedValueOnce(hit(32.78, -96.8));
    axios.get.mockResolvedValue(ors(1500000));
    await runLoadLocator();

    const fresh = await Load.findById(load._id).lean();
    expect(fresh.originLat).toBeCloseTo(41.88);
    expect(fresh.destinationLng).toBeCloseTo(-96.8);
    expect(fresh.distanceMiles).toBeGreaterThan(900);
    expect((await board()).body.map((l) => l.title)).toContain('Hidden');
  });

  test('not found marks the load and notifies the shipper once across two runs', async () => {
    const load = await createTestLoad(shipper._id, { title: 'Typo', origin: 'Nowhereville, ZZ', ...NO_COORDS });
    fetch.mockResolvedValue(miss);
    await runLoadLocator();
    await runLoadLocator();

    const fresh = await Load.findById(load._id).lean();
    expect(fresh.locationProblem).toMatchObject({ field: 'origin', place: 'Nowhereville, ZZ' });
    const notes = await Notification.find({ userId: shipper._id, type: 'load:location_problem' });
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toMatch(/couldn't find the pickup location "Nowhereville, ZZ" for load "Typo"/);
    expect(notes[0].body).toMatch(/cancel it and re-post/i);
    expect(fetch).toHaveBeenCalledTimes(1); // the second run did not look it up again
  });

  test('a geocoder outage leaves the load untouched and it is retried', async () => {
    const load = await createTestLoad(shipper._id, { ...NO_COORDS });
    fetch.mockRejectedValue(new Error('network down'));
    await runLoadLocator();
    const fresh = await Load.findById(load._id).lean();
    expect(fresh.originLat).toBeUndefined();
    expect(fresh.locationProblem?.at).toBeUndefined();
    expect(await Notification.countDocuments({ type: 'load:location_problem' })).toBe(0);

    fetch.mockReset();
    fetch.mockResolvedValueOnce(hit(41.88, -87.63)).mockResolvedValueOnce(hit(32.78, -96.8));
    axios.get.mockResolvedValue(ors(1500000));
    await runLoadLocator();
    expect((await Load.findById(load._id).lean()).originLat).toBeCloseTo(41.88);
  });

  test('a load booked meanwhile is not written', async () => {
    const carrier = await createTestUser({ role: 'carrier' });
    const load = await createTestLoad(shipper._id, { ...NO_COORDS });
    fetch.mockImplementation(async () => {
      await Load.updateOne({ _id: load._id }, { $set: { status: 'accepted', acceptedBy: carrier._id } });
      return hit(41.88, -87.63);
    });
    await runLoadLocator();
    const fresh = await Load.findById(load._id).lean();
    expect(fresh.status).toBe('accepted');
    expect(fresh.originLat).toBeUndefined();
  });

  test('a cancelled load and a load older than 14 days are not looked at', async () => {
    await createTestLoad(shipper._id, { status: 'cancelled', ...NO_COORDS });
    const old = await createTestLoad(shipper._id, { ...NO_COORDS });
    await Load.collection.updateOne({ _id: old._id }, { $set: { createdAt: new Date(Date.now() - 15 * 86400000) } });
    await runLoadLocator();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('at most 20 loads are handled per run, oldest first', async () => {
    fetch.mockResolvedValue(hit(41.88, -87.63)); // same place for all: one lookup, cached for the run
    axios.get.mockResolvedValue(ors(1500000));
    const ids = [];
    for (let i = 0; i < 22; i++) {
      const l = await createTestLoad(shipper._id, { title: `L${i}`, originLat: undefined, originLng: undefined, origin: 'Same, TX' });
      await Load.collection.updateOne({ _id: l._id }, { $set: { createdAt: new Date(Date.now() - (30 - i) * 60000) } });
      ids.push(l._id);
    }
    await runLoadLocator();
    const done = await Load.countDocuments({ _id: { $in: ids }, originLat: { $type: 'number' } });
    expect(done).toBe(20);
    const left = await Load.find({ _id: { $in: ids }, originLat: { $exists: false } }).sort({ createdAt: 1 }).lean();
    expect(left.map((l) => l.title)).toEqual(['L20', 'L21']);
  });
});
