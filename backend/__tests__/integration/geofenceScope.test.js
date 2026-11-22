/**
 * Geofence scoping — a ping for load A must never check in/out load B,
 * even when both loads belong to the same carrier company.
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const DwellEvent = require('../../models/DwellEvent');
const { checkGeofence } = require('../../services/geofenceService');
const trackingRoutes = require('../../routes/trackingRoutes');

const CHICAGO = { latitude: 41.8781, longitude: -87.6298 };
const DENVER  = { latitude: 39.7392, longitude: -104.9903 };
const FAR     = { latitude: 36.0, longitude: -93.0 };

async function setup() {
  const shipper = await createTestUser({ role: 'shipper' });
  const carrier = await createTestUser({
    role: 'carrier',
    tracking: { gpsConsent: { granted: true, grantedAt: new Date(), version: 'v1' } },
  });
  // A: Chicago -> Dallas (defaults). B: Denver pickup, Boston delivery.
  const a = await createTestLoad(shipper._id, { status: 'in-transit', acceptedBy: carrier._id });
  const b = await createTestLoad(shipper._id, {
    status: 'in-transit', acceptedBy: carrier._id,
    originLat: DENVER.latitude, originLng: DENVER.longitude,
    destinationLat: 42.36, destinationLng: -71.06,
  });
  return { carrier, a, b };
}

describe('geofence scoped to one load', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/tracking', trackingRoutes);

  const ping = (token, loadId, p) =>
    request(app).post('/api/tracking/location')
      .set('Authorization', `Bearer ${token}`)
      .send({ loadId: String(loadId), ...p, source: 'mobile_app' });

  test('ping for load A at load B pickup creates no DwellEvent for B', async () => {
    const { carrier, a, b } = await setup();
    const res = await ping(generateToken(carrier), a._id, DENVER);
    expect(res.status).toBe(200);
    expect(await DwellEvent.countDocuments({ load: b._id })).toBe(0);
    expect(await DwellEvent.countDocuments({ load: a._id })).toBe(0);
  });

  test('ping for load A at its own pickup checks in; leaving checks out', async () => {
    const { carrier, a, b } = await setup();
    const token = generateToken(carrier);
    await ping(token, a._id, CHICAGO);
    const inEv = await DwellEvent.findOne({ load: a._id, stopType: 'pickup' });
    expect(inEv).toBeTruthy();
    expect(inEv.departedAt).toBeNull();

    await ping(token, a._id, FAR);
    const outEv = await DwellEvent.findOne({ load: a._id, stopType: 'pickup' });
    expect(outEv.departedAt).toBeTruthy();
    expect(await DwellEvent.countDocuments({ load: b._id })).toBe(0);
  });

  test('checkGeofence with loadId ignores other loads; without loadId checks all', async () => {
    const { carrier, a, b } = await setup();
    const scoped = await checkGeofence(carrier._id, DENVER.latitude, DENVER.longitude, { loadId: a._id });
    expect(scoped.checkedIn).toHaveLength(0);

    // Legacy: no loadId -> all active loads considered, B's pickup checks in.
    const legacy = await checkGeofence(carrier._id, DENVER.latitude, DENVER.longitude);
    expect(legacy.checkedIn).toHaveLength(1);
    expect(await DwellEvent.countDocuments({ load: b._id, stopType: 'pickup' })).toBe(1);

    const out = await checkGeofence(carrier._id, FAR.latitude, FAR.longitude);
    expect(out.checkedOut).toHaveLength(1);
  });

  test('loadId of a different carrier or inactive load yields nothing', async () => {
    const { carrier, a } = await setup();
    const other = await createTestUser({ role: 'carrier' });
    const r = await checkGeofence(other._id, CHICAGO.latitude, CHICAGO.longitude, { loadId: a._id });
    expect(r.checkedIn).toHaveLength(0);
    expect(await DwellEvent.countDocuments({ load: a._id })).toBe(0);
  });
});
