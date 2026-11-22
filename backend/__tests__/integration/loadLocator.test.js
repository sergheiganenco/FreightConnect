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

    expect(fresh.locationAttempts).toBe(1); // backing off now; make it eligible again
    await Load.updateOne({ _id: load._id }, { $set: { locationNextAttemptAt: new Date(Date.now() - 1000) } });

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

  test('at most 20 loads are handled per run, oldest first (spread over 5 shippers: the per-shipper cap is 5)', async () => {
    const shippers = [shipper, ...await Promise.all([1, 2, 3, 4].map(() => createTestUser({ role: 'shipper' })))];
    fetch.mockResolvedValue(hit(41.88, -87.63)); // same place for all: one lookup, cached for the run
    axios.get.mockResolvedValue(ors(1500000));
    const ids = [];
    for (let i = 0; i < 22; i++) {
      const l = await createTestLoad(shippers[i % 5]._id, { title: `L${i}`, originLat: undefined, originLng: undefined, origin: 'Same, TX' });
      await Load.collection.updateOne({ _id: l._id }, { $set: { createdAt: new Date(Date.now() - (30 - i) * 60000) } });
      ids.push(l._id);
    }
    await runLoadLocator();
    const done = await Load.countDocuments({ _id: { $in: ids }, originLat: { $type: 'number' } });
    expect(done).toBe(20);
    const left = await Load.find({ _id: { $in: ids }, originLat: { $exists: false } }).sort({ createdAt: 1 }).lean();
    expect(left.map((l) => l.title)).toEqual(['L20', 'L21']);
  });

  describe('rejected strings, outages, backoff and fairness', () => {
    const status = (code) => ({ ok: false, status: code, json: async () => ({}) });
    const MIN = 60000;
    const addMissing = (extra = {}) => createTestLoad(shipper._id, { originLat: undefined, originLng: undefined, ...extra });
    const reeligible = (id) => Load.updateOne({ _id: id }, { $set: { locationNextAttemptAt: new Date(Date.now() - 1000) } });

    test.each([400, 414, 404, 422])('geocoder HTTP %i is "not found": locationProblem, one notification, never retried', async (code) => {
      const load = await addMissing({ title: 'Rejected' });
      fetch.mockResolvedValue(status(code));
      await runLoadLocator();
      await runLoadLocator();
      const fresh = await Load.findById(load._id).lean();
      expect(fresh.locationProblem).toMatchObject({ field: 'origin', reason: 'not_found' });
      expect(fresh.locationAttempts).toBe(0);
      expect(await Notification.countDocuments({ userId: shipper._id, type: 'load:location_problem' })).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    test.each([
      ['429', () => fetch.mockResolvedValue(status(429))],
      ['500', () => fetch.mockResolvedValue(status(500))],
      ['401 (blocked agent)', () => fetch.mockResolvedValue(status(401))],
      ['403 (blocked IP / WAF)', () => fetch.mockResolvedValue(status(403))],
      ['407', () => fetch.mockResolvedValue(status(407))],
      ['408 (timeout)', () => fetch.mockResolvedValue(status(408))],
      ['425', () => fetch.mockResolvedValue(status(425))],
      ['network error', () => fetch.mockRejectedValue(new Error('ECONNRESET'))],
    ])('%s is an outage: attempts and backoff grow, no problem is recorded', async (_n, arm) => {
      const load = await addMissing();
      arm();
      const before = Date.now();
      await runLoadLocator();
      let fresh = await Load.findById(load._id).lean();
      expect(fresh.locationAttempts).toBe(1);
      expect(fresh.locationNextAttemptAt.getTime() - before).toBeGreaterThanOrEqual(20 * MIN - 1000);
      expect(fresh.locationNextAttemptAt.getTime() - before).toBeLessThan(20 * MIN + 60000);
      expect(fresh.locationProblem?.at).toBeUndefined();

      await runLoadLocator(); // still backing off: not looked at
      expect(fetch).toHaveBeenCalledTimes(1);

      await reeligible(load._id);
      const before2 = Date.now();
      await runLoadLocator();
      fresh = await Load.findById(load._id).lean();
      expect(fresh.locationAttempts).toBe(2);
      expect(fresh.locationNextAttemptAt.getTime() - before2).toBeGreaterThanOrEqual(40 * MIN - 1000);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    test('backoff is capped at 6 hours', async () => {
      const load = await addMissing();
      await Load.updateOne({ _id: load._id }, { $set: { locationAttempts: 6 } });
      fetch.mockResolvedValue(status(500));
      const before = Date.now();
      await runLoadLocator();
      const fresh = await Load.findById(load._id).lean();
      expect(fresh.locationAttempts).toBe(7);
      expect(fresh.locationNextAttemptAt.getTime() - before).toBeLessThan(6 * 60 * MIN + 60000);
      expect(fresh.locationNextAttemptAt.getTime() - before).toBeGreaterThan(6 * 60 * MIN - 60000);
    });

    test('the 8th failed attempt gives up: unreachable, shipper told once', async () => {
      const load = await addMissing({ title: 'Never' });
      await Load.updateOne({ _id: load._id }, { $set: { locationAttempts: 7 } });
      fetch.mockResolvedValue(status(503));
      await runLoadLocator();
      await runLoadLocator();
      const fresh = await Load.findById(load._id).lean();
      expect(fresh.locationProblem).toMatchObject({ field: 'origin', reason: 'unreachable' });
      expect(await Notification.countDocuments({ userId: shipper._id, type: 'load:location_problem' })).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    test('a success clears attempts and backoff', async () => {
      const load = await addMissing();
      await Load.updateOne({ _id: load._id }, { $set: { locationAttempts: 3, locationNextAttemptAt: new Date(Date.now() - 1000) } });
      fetch.mockResolvedValue(hit(41.88, -87.63));
      axios.get.mockResolvedValue(ors(1500000));
      await runLoadLocator();
      const fresh = await Load.findById(load._id).lean();
      expect(fresh.originLat).toBeCloseTo(41.88);
      expect(fresh.locationAttempts).toBe(0);
      expect(fresh.locationNextAttemptAt).toBeNull();
    });

    test('fairness: 30 older failing loads of shipper A do not starve shipper B; A is capped at 5 a run', async () => {
      const other = await createTestUser({ role: 'shipper' });
      const aIds = [];
      for (let i = 0; i < 30; i++) {
        const l = await addMissing({ title: `A${i}`, origin: 'Same, TX' });
        await Load.collection.updateOne({ _id: l._id }, { $set: { createdAt: new Date(Date.now() - (100 - i) * MIN) } });
        aIds.push(l._id);
      }
      const bIds = [];
      for (let i = 0; i < 3; i++) {
        const l = await createTestLoad(other._id, { title: `B${i}`, originLat: undefined, originLng: undefined, origin: 'Same, TX' });
        bIds.push(l._id);
      }
      fetch.mockResolvedValue(status(500));
      await runLoadLocator();
      expect(await Load.countDocuments({ _id: { $in: bIds }, locationAttempts: 1 })).toBe(3);
      expect(await Load.countDocuments({ _id: { $in: aIds }, locationAttempts: 1 })).toBe(5);

      // next run: A's attempted loads are backing off, so the next 5 of A are tried, not the same ones
      await runLoadLocator();
      expect(await Load.countDocuments({ _id: { $in: aIds }, locationAttempts: 1 })).toBe(10);
    });

    test('a run whose budget ran out does not count an attempt for loads it never reached', async () => {
      const ids = [];
      for (let i = 0; i < 3; i++) {
        const l = await addMissing({ title: `Q${i}`, origin: `Place${i}, TX` });
        await Load.collection.updateOne({ _id: l._id }, { $set: { createdAt: new Date(Date.now() - (10 - i) * MIN) } });
        ids.push(l._id);
      }
      const realNow = Date.now;
      const spy = jest.spyOn(Date, 'now');
      fetch.mockImplementation(async () => { spy.mockImplementation(() => realNow() + 60000); throw new Error('down'); });
      try { await runLoadLocator(); } finally { spy.mockRestore(); }
      const [first, second, third] = await Promise.all(ids.map((id) => Load.findById(id).lean()));
      expect(first.locationAttempts).toBe(1);
      expect(second.locationAttempts).toBe(0);
      expect(third.locationAttempts).toBe(0);
      expect(second.locationNextAttemptAt).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    describe('safety valve: a run where most loads are "not found" is suspect', () => {
      let warn;
      beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
      afterEach(() => warn.mockRestore());
      const suspectWarnings = () => warn.mock.calls.filter((c) => /geocoder problem/.test(c[0]));

      test('5 of 5 rejected: none is marked, each is counted as a failed attempt with backoff, one warning, no notification', async () => {
        const ids = [];
        for (let i = 0; i < 5; i++) ids.push((await addMissing({ title: `R${i}`, origin: `Place${i}, TX` }))._id);
        fetch.mockResolvedValue(status(400));
        const before = Date.now();
        await runLoadLocator();
        for (const id of ids) {
          const l = await Load.findById(id).lean();
          expect(l.locationProblem?.at).toBeUndefined();
          expect(l.locationAttempts).toBe(1);
          expect(l.locationNextAttemptAt.getTime() - before).toBeGreaterThanOrEqual(20 * MIN - 1000);
        }
        expect(suspectWarnings()).toHaveLength(1);
        expect(suspectWarnings()[0][0]).toMatch(/5 of 5/);
        expect(await Notification.countDocuments({ type: 'load:location_problem' })).toBe(0);
      });

      test('1 of 5 rejected: that one is marked (not suspect), the others are located', async () => {
        const ids = [];
        for (let i = 0; i < 5; i++) ids.push((await addMissing({ title: `M${i}`, origin: i === 2 ? 'Typo, ZZ' : `Place${i}, TX` }))._id);
        fetch.mockImplementation(async (url) => (url.includes('Typo') ? status(400) : hit(41.88, -87.63)));
        axios.get.mockResolvedValue(ors(1500000));
        await runLoadLocator();
        const marked = await Load.find({ _id: { $in: ids }, 'locationProblem.at': { $exists: true } }).lean();
        expect(marked.map((l) => l.title)).toEqual(['M2']);
        expect(marked[0].locationProblem).toMatchObject({ field: 'origin', reason: 'not_found' });
        expect(await Load.countDocuments({ _id: { $in: ids }, originLat: { $type: 'number' } })).toBe(4);
        expect(await Notification.countDocuments({ type: 'load:location_problem' })).toBe(1);
        expect(suspectWarnings()).toHaveLength(0);
      });

      test('2 of 2 rejected (fewer than 3) is not suspect: both are marked', async () => {
        const ids = [(await addMissing({ origin: 'A1, ZZ' }))._id, (await addMissing({ origin: 'A2, ZZ' }))._id];
        fetch.mockResolvedValue(status(404));
        await runLoadLocator();
        expect(await Load.countDocuments({ _id: { $in: ids }, 'locationProblem.at': { $exists: true } })).toBe(2);
        expect(suspectWarnings()).toHaveLength(0);
      });

      test('exactly half rejected (2 of 4) is not "more than half": both rejected are marked', async () => {
        const ids = [];
        for (let i = 0; i < 4; i++) ids.push((await addMissing({ title: `H${i}`, origin: i < 2 ? `Bad${i}, ZZ` : `Ok${i}, TX` }))._id);
        fetch.mockImplementation(async (url) => (url.includes('Bad') ? status(400) : hit(41.88, -87.63)));
        axios.get.mockResolvedValue(ors(1500000));
        await runLoadLocator();
        expect(await Load.countDocuments({ _id: { $in: ids }, 'locationProblem.at': { $exists: true } })).toBe(2);
        expect(suspectWarnings()).toHaveLength(0);
      });

      test('the same loads are marked on a later run once the pattern is not systemic (they are re-eligible, others located)', async () => {
        const bad = [];
        for (let i = 0; i < 3; i++) bad.push((await addMissing({ title: `S${i}`, origin: `Bad${i}, ZZ` }))._id);
        fetch.mockResolvedValue(status(400));
        await runLoadLocator(); // 3 of 3: suspect, nothing marked
        expect(await Load.countDocuments({ _id: { $in: bad }, 'locationProblem.at': { $exists: true } })).toBe(0);

        for (const id of bad) await reeligible(id);
        // (more loads from other shippers: one shipper is capped at 5 a run)
        for (let i = 0; i < 6; i++) await createTestLoad((await createTestUser({ role: 'shipper' }))._id, { title: `G${i}`, origin: `Good${i}, TX`, ...NO_COORDS });
        fetch.mockReset();
        fetch.mockImplementation(async (url) => (url.includes('Bad') ? status(400) : hit(41.88, -87.63)));
        axios.get.mockResolvedValue(ors(1500000));
        await runLoadLocator(); // 3 of 9: not suspect
        expect(await Load.countDocuments({ _id: { $in: bad }, 'locationProblem.at': { $exists: true } })).toBe(3);
      });
    });

    describe('fairness is applied in the database, before the global limit', () => {
      const raw = (postedBy, n, mk) => Load.collection.insertMany(Array.from({ length: n }, (_, i) => ({
        title: `X${i}`, origin: 'Same, TX', destination: 'Dest, TX', rate: 1, equipmentType: 'Dry Van', status: 'open',
        postedBy, locationAttempts: 0, locationNextAttemptAt: null, updatedAt: new Date(), ...mk(i),
      })));

      test('A: 250 never-attempted loads (older AND newer than B); B: 2 loads whose backoff expired -> both of B attempted, A at most 5', async () => {
        const a = shipper;
        const b = await createTestUser({ role: 'shipper' });
        const bCreated = new Date(Date.now() - 30 * MIN);
        await raw(a._id, 250, (i) => ({ title: `A${i}`, createdAt: new Date(Date.now() - (i % 2 ? 90 : 5) * MIN - i * 1000) }));
        await raw(b._id, 2, (i) => ({
          title: `B${i}`, createdAt: bCreated, locationAttempts: 2, locationNextAttemptAt: new Date(Date.now() - 10 * MIN),
        }));
        fetch.mockResolvedValue(status(500));
        await runLoadLocator();
        expect(await Load.countDocuments({ postedBy: b._id, locationAttempts: 3 })).toBe(2);
        expect(await Load.countDocuments({ postedBy: a._id, locationAttempts: { $gt: 0 } })).toBe(5);
      });

      test('within a shipper the longest-eligible loads go first (eligibility = backoff expiry if set, else createdAt)', async () => {
        await raw(shipper._id, 8, (i) => ({
          title: `W${i}`,
          createdAt: new Date(Date.now() - 1000 * MIN),
          // W0..W2 expired backoffs (W0 longest ago), W3..W7 never attempted but created 100 - i minutes ago
          ...(i < 3 ? { locationAttempts: 1, locationNextAttemptAt: new Date(Date.now() - (50 - i) * MIN) }
            : { createdAt: new Date(Date.now() - (100 - i) * MIN) }),
        }));
        fetch.mockResolvedValue(status(500));
        await runLoadLocator();
        // eligibility instants: W3..W7 = created 97..93 min ago; W0..W2 = backoff expired 50..48 min ago (though created 1000 min ago).
        // The 5 longest-waiting are W3..W7; W0..W2 wait for the next run.
        expect(await Load.countDocuments({ postedBy: shipper._id, title: { $in: ['W3', 'W4', 'W5', 'W6', 'W7'] }, locationAttempts: 1 })).toBe(5);
        expect(await Load.countDocuments({ postedBy: shipper._id, title: { $in: ['W0', 'W1', 'W2'] }, locationNextAttemptAt: { $lte: new Date() } })).toBe(3);
      });

      test('across shippers a run takes round 1 of every shipper before anyone gets a second load; longest-waiting shipper first', async () => {
        const others = await Promise.all([1, 2, 3].map(() => createTestUser({ role: 'shipper' })));
        const all = [shipper, ...others];
        for (let s = 0; s < all.length; s++) {
          await raw(all[s]._id, 8, (i) => ({ title: `S${s}-${i}`, createdAt: new Date(Date.now() - (1000 - s * 10 - i) * MIN) }));
        }
        fetch.mockResolvedValue(status(500));
        await runLoadLocator(); // 20 slots, 4 shippers: 5 each (cap) = 20
        for (const s of all) expect(await Load.countDocuments({ postedBy: s._id, locationAttempts: 1 })).toBe(5);
      });
    });
  });
});
