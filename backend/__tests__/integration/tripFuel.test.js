/**
 * Integration: fuel stop money units (real tripRoutes).
 *
 * The audit found fuelStops.totalCost was stored in DOLLARS right next to the
 * trip's totalFuelCostCents accumulator (cents) — an ambiguity trap for any
 * consumer (e.g. a future IFTA fuel aggregation). Fix follows the Payment
 * model convention: canonical integer-cents field + dollar shadow for the UI.
 */

require('../setup');
const express = require('express');
const request = require('supertest');

const { createTestUser, generateToken } = require('../helpers');
const Trip = require('../../models/Trip');

const tripRoutes = require('../../routes/tripRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/trips', tripRoutes);
  return app;
}

describe('Trip fuel stops — cents-canonical money', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  test('logs a fuel stop with canonical cents + dollar shadow, consistent with the trip total', async () => {
    const carrier = await createTestUser({ role: 'carrier' });
    const trip = await Trip.create({ carrier: carrier._id, name: 'Test Trip' });

    const res = await request(app)
      .post(`/api/trips/${trip._id}/fuel`)
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({ location: 'Loves, Amarillo TX', gallons: 100, pricePerGallon: 3.599 });

    expect(res.status).toBe(200);

    const fresh = await Trip.findById(trip._id);
    const stop = fresh.fuelStops[0];
    expect(stop.totalCostCents).toBe(35990);          // canonical integer cents
    expect(stop.totalCost).toBeCloseTo(359.9, 2);     // dollar shadow for the UI
    expect(fresh.totalFuelCostCents).toBe(35990);     // accumulator agrees with the stop
  });

  test('two stops accumulate consistently', async () => {
    const carrier = await createTestUser({ role: 'carrier' });
    const trip = await Trip.create({ carrier: carrier._id, name: 'Test Trip 2' });
    const token = generateToken(carrier);

    await request(app)
      .post(`/api/trips/${trip._id}/fuel`)
      .set('Authorization', `Bearer ${token}`)
      .send({ gallons: 50, pricePerGallon: 4.0 }); // $200.00

    await request(app)
      .post(`/api/trips/${trip._id}/fuel`)
      .set('Authorization', `Bearer ${token}`)
      .send({ gallons: 10, pricePerGallon: 3.5 }); // $35.00

    const fresh = await Trip.findById(trip._id);
    const sumOfStops = fresh.fuelStops.reduce((s, f) => s + f.totalCostCents, 0);
    expect(sumOfStops).toBe(23500);
    expect(fresh.totalFuelCostCents).toBe(23500);
  });
});
