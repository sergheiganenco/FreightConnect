/**
 * Contract creation — validation error handling.
 * Regression: an incomplete body must return 400 (client error), not 500.
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const { createTestUser, generateToken } = require('../helpers');

const contractRoutes = require('../../routes/contractRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/contracts', contractRoutes);
  return app;
}

describe('Contract creation', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('incomplete body → 400 (not 500)', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const res = await request(app)
      .post('/api/contracts')
      .set('Authorization', `Bearer ${generateToken(shipper)}`)
      .send({ title: 'Bad', pricing: { rateType: 'flat', rateCents: 1000 } }); // missing lane.*.name, terms.endDate

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  test('complete body → 201 with a contract number', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const res = await request(app)
      .post('/api/contracts')
      .set('Authorization', `Bearer ${generateToken(shipper)}`)
      .send({
        title: 'Good Contract',
        lane: {
          origin: { name: 'Dallas DC', city: 'Dallas', state: 'TX' },
          destination: { name: 'Austin DC', city: 'Austin', state: 'TX' },
        },
        equipmentType: 'Dry Van',
        pricing: { rateType: 'flat', rateCents: 90000 },
        volume: { frequency: 'weekly', loadsPerPeriod: 2 },
        terms: {
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 90 * 86400000).toISOString(),
          paymentTerms: 'net30',
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.contractNumber).toBeTruthy();
    expect(res.body.status).toBe('draft');
  });

  test('a carrier cannot create a contract (403)', async () => {
    const carrier = await createTestUser({ role: 'carrier' });
    const res = await request(app)
      .post('/api/contracts')
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({ title: 'x' });
    expect(res.status).toBe(403);
  });
});
