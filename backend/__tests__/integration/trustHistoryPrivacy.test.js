/**
 * Per-event trust history (loadIds + reasons) reveals which loads a carrier hauled:
 * only the subject company and admins may receive it; counterparties get aggregates only.
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const Bid = require('../../models/Bid');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/reputation', require('../../routes/reputationRoutes'));
  app.use('/api/verification', require('../../routes/verificationRoutes'));
  app.use('/api/bids', require('../../routes/bidRoutes'));
  return app;
};
const bearer = (u) => ({ Authorization: `Bearer ${generateToken(u)}` });

describe('trust score history exposure', () => {
  let app, carrier, shipper, other, admin, dispatcher, load, loadId;
  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    other = await createTestUser({ role: 'carrier' });
    admin = await createTestUser({ role: 'admin' });
    load = await createTestLoad(shipper._id);
    loadId = String(load._id);
    carrier = await createTestUser({
      role: 'carrier',
      trustScore: { score: 45, onTimeRate: 90, totalLoadsCompleted: 4, history: [{ score: 45, reason: 'carrier_cancelled_load', change: -5, loadId: load._id }] },
    });
    dispatcher = await createTestUser({ role: 'carrier', companyRole: 'dispatcher', parentAccountId: carrier._id });
    await Bid.create({ loadId: load._id, carrierId: carrier._id, amount: 2000, status: 'pending', history: [{ actor: 'carrier', action: 'placed', amount: 2000 }] });
  });
  const rep = (headers) => request(app).get(`/api/reputation/${carrier._id}`).set(headers).expect(200);

  test('shipper and other carriers get aggregates, never history or loadIds', async () => {
    for (const who of [shipper, other]) {
      const res = await rep(bearer(who));
      expect(res.body.trustScore.score).toBe(45);
      expect(res.body.trustScore.onTimeRate).toBe(90);
      expect(res.body.trustScore.history).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain(loadId);
    }
    const pub = await request(app).get(`/api/verification/trust-score/${carrier._id}`).set(bearer(shipper)).expect(200);
    expect(JSON.stringify(pub.body)).not.toContain(loadId);
  });

  test('the carrier itself, its sub-account and an admin do get history', async () => {
    const sub = { Authorization: `Bearer ${jwt.sign({ userId: dispatcher._id, role: 'carrier', companyOwnerId: carrier._id, companyRole: 'dispatcher' }, process.env.JWT_SECRET)}` };
    for (const h of [bearer(carrier), bearer(admin), sub]) {
      const res = await rep(h);
      expect(res.body.trustScore.history[0]).toMatchObject({ reason: 'carrier_cancelled_load', change: -5 });
      expect(String(res.body.trustScore.history[0].loadId)).toBe(loadId);
    }
    const own = await request(app).get('/api/verification/trust-score').set(bearer(carrier)).expect(200);
    expect(own.body.history).toHaveLength(1);
    const viaSub = await request(app).get('/api/verification/trust-score').set(sub).expect(200); // the company score, not the dispatcher one
    expect(viaSub.body.score).toBe(45);
  });

  test('a sub-account id resolves to the reputation of its company', async () => {
    const res = await request(app).get(`/api/reputation/${dispatcher._id}`).set(bearer(shipper)).expect(200);
    expect(String(res.body.userId)).toBe(String(carrier._id));
    expect(res.body.trustScore.score).toBe(45);
  });

  test('bid list shows the shipper score aggregates without history', async () => {
    const res = await request(app).get(`/api/bids/load/${loadId}`).set(bearer(shipper)).expect(200);
    expect(res.body[0].carrierId.trustScore.score).toBe(45);
    expect(res.body[0].carrierId.trustScore.history).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/carrier_cancelled_load/);
  });
});
