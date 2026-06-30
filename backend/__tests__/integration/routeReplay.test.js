/**
 * Route replay — "fake the route, watch the shipment get tracked."
 *
 * Drives a sequence of GPS pings (Chicago -> ... -> Dallas) through the REAL
 * tracking endpoints and asserts the full pipeline works end to end:
 *   - consent gate lets the pings through
 *   - live position (Load.carrierLocation) follows the truck
 *   - a durable breadcrumb trail accumulates (GET /history)
 *   - ETA to destination shrinks as the truck approaches (GET /eta)
 *   - geofence auto check-in at pickup, check-out on departure, and check-in
 *     at delivery — the same DwellEvents that drive detention
 */

require('../setup');
const express = require('express');
const request = require('supertest');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const Load = require('../../models/Load');
const DwellEvent = require('../../models/DwellEvent');

const trackingRoutes = require('../../routes/trackingRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tracking', trackingRoutes);
  return app;
}

// createTestLoad defaults: origin Chicago (41.8781,-87.6298), dest Dallas (32.7767,-96.7970).
const CHICAGO = { latitude: 41.8781, longitude: -87.6298 };
const DALLAS  = { latitude: 32.7767, longitude: -96.7970 };
const ROUTE = [
  CHICAGO,                              // 0: at pickup facility  -> geofence check-in
  { latitude: 40.0, longitude: -90.0 }, // 1: left Chicago        -> pickup check-out
  { latitude: 36.0, longitude: -93.0 }, // 2: en route
  { latitude: 34.0, longitude: -95.5 }, // 3: approaching Dallas
  DALLAS,                               // 4: at delivery facility -> geofence check-in
];

async function consentedCarrierLoad() {
  const shipper = await createTestUser({ role: 'shipper' });
  const carrier = await createTestUser({
    role: 'carrier',
    tracking: { gpsConsent: { granted: true, grantedAt: new Date(), version: 'v1' } },
  });
  const load = await createTestLoad(shipper._id, { status: 'in-transit', acceptedBy: carrier._id });
  return { shipper, carrier, load };
}

function post(app, token, loadId, point) {
  return request(app)
    .post('/api/tracking/location')
    .set('Authorization', `Bearer ${token}`)
    .send({ loadId: String(loadId), ...point, source: 'mobile_app' });
}

describe('Route replay — tracking a faked shipment', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('replaying a Chicago->Dallas route tracks the shipment end to end', async () => {
    const { carrier, load } = await consentedCarrierLoad();
    const token = generateToken(carrier);

    // ── Ping 0: at the pickup facility ──────────────────────────────────────
    const first = await post(app, token, load._id, ROUTE[0]);
    expect(first.status).toBe(200);

    // Geofence auto check-in created a pickup dwell event.
    const pickup = await DwellEvent.findOne({ load: load._id, stopType: 'pickup' });
    expect(pickup).toBeTruthy();
    expect(pickup.arrivedAt).toBeTruthy();

    // ETA from Chicago to Dallas is a long way out.
    const etaStart = await request(app)
      .get(`/api/tracking/${load._id}/eta`)
      .set('Authorization', `Bearer ${token}`);
    expect(etaStart.status).toBe(200);
    expect(etaStart.body.distanceRemainingMiles).toBeGreaterThan(500);

    // ── Pings 1..4: drive the rest of the route ─────────────────────────────
    for (let i = 1; i < ROUTE.length; i++) {
      const res = await post(app, token, load._id, ROUTE[i]);
      expect(res.status).toBe(200);
    }

    // Leaving Chicago closed the pickup dwell (auto check-out).
    const pickupAfter = await DwellEvent.findOne({ load: load._id, stopType: 'pickup' });
    expect(pickupAfter.departedAt).toBeTruthy();

    // Arriving in Dallas opened a delivery dwell (auto check-in).
    const delivery = await DwellEvent.findOne({ load: load._id, stopType: 'delivery' });
    expect(delivery).toBeTruthy();
    expect(delivery.arrivedAt).toBeTruthy();

    // Live position now follows the truck to Dallas.
    const live = await request(app)
      .get(`/api/tracking/${load._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(live.status).toBe(200);
    expect(live.body.carrierLocation.latitude).toBeCloseTo(DALLAS.latitude, 2);
    expect(live.body.carrierLocation.longitude).toBeCloseTo(DALLAS.longitude, 2);

    // The breadcrumb trail captured every (well-separated) point.
    const history = await request(app)
      .get(`/api/tracking/${load._id}/history`)
      .set('Authorization', `Bearer ${token}`);
    expect(history.status).toBe(200);
    expect(history.body.points.length).toBe(ROUTE.length);

    // ETA at the destination is essentially zero — much smaller than at the start.
    const etaEnd = await request(app)
      .get(`/api/tracking/${load._id}/eta`)
      .set('Authorization', `Bearer ${token}`);
    expect(etaEnd.body.distanceRemainingMiles).toBeLessThan(etaStart.body.distanceRemainingMiles);
    expect(etaEnd.body.distanceRemainingMiles).toBeLessThan(50);
  });

  test('without consent the faked route is rejected (privacy gate holds)', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await createTestUser({ role: 'carrier' }); // no consent
    const load = await createTestLoad(shipper._id, { status: 'in-transit', acceptedBy: carrier._id });

    const res = await post(app, generateToken(carrier), load._id, CHICAGO);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('gps_consent_required');
  });
});
