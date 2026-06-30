/**
 * Driver GPS-consent gate (privacy).
 *
 * Background location may not be ingested for a carrier until that carrier has
 * explicitly consented. Consent is recordable, queryable, and revocable.
 */

require('../setup');
const express = require('express');
const request = require('supertest');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const trackingRoutes = require('../../routes/trackingRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tracking', trackingRoutes);
  return app;
}

async function carrierAndLoad() {
  const shipper = await createTestUser({ role: 'shipper' });
  const carrier = await createTestUser({ role: 'carrier' });
  const load = await createTestLoad(shipper._id, { status: 'in-transit', acceptedBy: carrier._id });
  return { shipper, carrier, load };
}

const PING = { latitude: 41.0, longitude: -87.0 };

describe('GPS consent gate', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('location ingest is blocked without consent (403 gps_consent_required)', async () => {
    const { carrier, load } = await carrierAndLoad();
    const res = await request(app)
      .post('/api/tracking/location')
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({ loadId: String(load._id), ...PING });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('gps_consent_required');
  });

  test('granting consent records it and lets location through the gate', async () => {
    const { carrier, load } = await carrierAndLoad();
    const token = generateToken(carrier);

    const consent = await request(app)
      .post('/api/tracking/consent')
      .set('Authorization', `Bearer ${token}`)
      .send({ granted: true, version: 'v1' });
    expect(consent.status).toBe(200);
    expect(consent.body.gpsConsent.granted).toBe(true);
    expect(consent.body.gpsConsent.grantedAt).toBeTruthy();

    const status = await request(app)
      .get('/api/tracking/consent')
      .set('Authorization', `Bearer ${token}`);
    expect(status.status).toBe(200);
    expect(status.body.gpsConsent.granted).toBe(true);

    const res = await request(app)
      .post('/api/tracking/location')
      .set('Authorization', `Bearer ${token}`)
      .send({ loadId: String(load._id), ...PING });
    expect(res.status).not.toBe(403); // gate passed
  });

  test('revoking consent re-blocks location ingest', async () => {
    const { carrier, load } = await carrierAndLoad();
    const token = generateToken(carrier);
    await request(app).post('/api/tracking/consent').set('Authorization', `Bearer ${token}`).send({ granted: true });
    await request(app).post('/api/tracking/consent').set('Authorization', `Bearer ${token}`).send({ granted: false });

    const res = await request(app)
      .post('/api/tracking/location')
      .set('Authorization', `Bearer ${token}`)
      .send({ loadId: String(load._id), ...PING });
    expect(res.status).toBe(403);
  });
});
