/**
 * Integration: lane / deadhead search on the load board.
 *
 * Mounts the REAL loadRoutes factory (with a mock io) and exercises the geo
 * query params added for owner-operator "what's near me" search:
 *   - originLat/originLng/originRadius filters loads by pickup proximity
 *   - each load is annotated with deadheadMiles, tripMiles, ratePerMile
 *   - results are sorted nearest-deadhead first
 */

require('../setup');
const express = require('express');
const request = require('supertest');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');

// Mock io — the GET / handler doesn't emit, but the factory needs an io object.
const mockIo = { to: () => ({ emit: () => {} }), emit: () => {} };

function buildApp() {
  const app = express();
  app.use(express.json());
  const loadRoutes = require('../../routes/loadRoutes')(mockIo);
  app.use('/api/loads', loadRoutes);
  return app;
}

// Reference points
const KC = { lat: 39.10, lng: -94.58 };        // Kansas City (search origin)
const JOPLIN = { lat: 37.08, lng: -94.51 };    // ~139 mi south of KC
const CHICAGO = { lat: 41.88, lng: -87.63 };   // ~415 mi from KC
const DALLAS = { lat: 32.7767, lng: -96.7970 };

describe('lane / deadhead search', () => {
  let app, carrier, token, shipper;

  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    carrier = await createTestUser({ role: 'carrier' });
    token = generateToken(carrier);
  });

  async function seedLoads() {
    // A: pickup AT the search origin (KC) → deadhead ~0
    await createTestLoad(shipper._id, {
      title: 'KC to Dallas', origin: 'Kansas City, MO', destination: 'Dallas, TX',
      originLat: KC.lat, originLng: KC.lng, destinationLat: DALLAS.lat, destinationLng: DALLAS.lng,
      rate: 2500,
    });
    // C: pickup ~139 mi away (Joplin) → within a 200 mi radius
    await createTestLoad(shipper._id, {
      title: 'Joplin to Dallas', origin: 'Joplin, MO', destination: 'Dallas, TX',
      originLat: JOPLIN.lat, originLng: JOPLIN.lng, destinationLat: DALLAS.lat, destinationLng: DALLAS.lng,
      rate: 2000,
    });
    // B: pickup ~415 mi away (Chicago) → OUTSIDE a 200 mi radius
    await createTestLoad(shipper._id, {
      title: 'Chicago to Dallas', origin: 'Chicago, IL', destination: 'Dallas, TX',
      originLat: CHICAGO.lat, originLng: CHICAGO.lng, destinationLat: DALLAS.lat, destinationLng: DALLAS.lng,
      rate: 3000,
    });
  }

  test('filters to loads picking up within the radius and sorts nearest-first', async () => {
    await seedLoads();

    const res = await request(app)
      .get('/api/loads')
      .query({ originLat: KC.lat, originLng: KC.lng, originRadius: 200 })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const titles = res.body.map((l) => l.title);
    // KC (0 mi) and Joplin (~139 mi) are in; Chicago (~415 mi) is out.
    expect(titles).toContain('KC to Dallas');
    expect(titles).toContain('Joplin to Dallas');
    expect(titles).not.toContain('Chicago to Dallas');
    // Nearest deadhead first.
    expect(titles[0]).toBe('KC to Dallas');
  });

  test('annotates deadheadMiles, tripMiles, and ratePerMile', async () => {
    await seedLoads();

    const res = await request(app)
      .get('/api/loads')
      .query({ originLat: KC.lat, originLng: KC.lng, originRadius: 200 })
      .set('Authorization', `Bearer ${token}`);

    const kc = res.body.find((l) => l.title === 'KC to Dallas');
    const joplin = res.body.find((l) => l.title === 'Joplin to Dallas');

    expect(kc.deadheadMiles).toBeLessThanOrEqual(2);          // pickup at the origin
    expect(joplin.deadheadMiles).toBeGreaterThan(120);
    expect(joplin.deadheadMiles).toBeLessThan(160);
    expect(kc.tripMiles).toBeGreaterThan(400);                // KC → Dallas
    expect(kc.ratePerMile).toBeCloseTo(2500 / kc.tripMiles, 2);
    expect(kc.ratePerMile).toBeGreaterThan(0);
  });

  test('without geo params, still annotates trip miles + RPM but no deadhead', async () => {
    await seedLoads();

    const res = await request(app)
      .get('/api/loads')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(3);
    const any = res.body.find((l) => l.title === 'KC to Dallas');
    expect(any.tripMiles).toBeGreaterThan(400);
    expect(any.ratePerMile).toBeGreaterThan(0);
    expect(any.deadheadMiles).toBeNull();
  });
});
