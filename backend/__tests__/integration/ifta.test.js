/**
 * Integration: IFTA quarterly reporting (real iftaRoutes).
 *
 * Contract under test:
 *  - fuel receipts are logged with an enum-validated jurisdiction + positive gallons
 *  - GET /:year/:quarter builds a seeded DRAFT aggregating fuel gallons per state
 *    and hints total miles / jurisdictions from completed trips
 *  - PUT saves manual miles; a later build recomputes taxableGallons = miles / mpg
 *  - finalize FREEZES the worksheet — a later GET does not re-seed from new data
 *  - everything is scoped to the acting company (companyOwnerId || userId)
 */

require('../setup');
const express = require('express');
const request = require('supertest');

const { createTestUser, generateToken } = require('../helpers');
const FuelPurchase = require('../../models/FuelPurchase');
const Trip = require('../../models/Trip');

const iftaRoutes = require('../../routes/iftaRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ifta', iftaRoutes);
  return app;
}

const YEAR = 2025;
const Q = 1; // Jan–Mar
const inQ1 = new Date('2025-02-15T12:00:00.000Z');

describe('IFTA quarterly reporting', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  // ── Fuel receipts ──────────────────────────────────────────────────────────

  test('POST /fuel with a valid jurisdiction + gallons creates a record', async () => {
    const carrier = await createTestUser({ role: 'carrier' });

    const res = await request(app)
      .post('/api/ifta/fuel')
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({ date: inQ1, jurisdiction: 'IL', gallons: 100, totalCostCents: 35990 });

    expect(res.status).toBe(201);
    expect(res.body.jurisdiction).toBe('IL');
    expect(res.body.gallons).toBe(100);
    // pricePerGallonCents derived from total / gallons: round(35990 / 100) = 360
    expect(res.body.pricePerGallonCents).toBe(360);
    expect(String(res.body.carrier)).toBe(String(carrier._id));

    const stored = await FuelPurchase.find({ carrier: carrier._id });
    expect(stored).toHaveLength(1);
  });

  test('POST /fuel with an invalid jurisdiction is rejected 400', async () => {
    const carrier = await createTestUser({ role: 'carrier' });

    const res = await request(app)
      .post('/api/ifta/fuel')
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({ date: inQ1, jurisdiction: 'ZZ', gallons: 100 });

    expect(res.status).toBe(400);
  });

  test('POST /fuel with non-positive gallons is rejected 400', async () => {
    const carrier = await createTestUser({ role: 'carrier' });

    const res = await request(app)
      .post('/api/ifta/fuel')
      .set('Authorization', `Bearer ${generateToken(carrier)}`)
      .send({ date: inQ1, jurisdiction: 'IL', gallons: 0 });

    expect(res.status).toBe(400);
  });

  // ── Worksheet build (seeding) ────────────────────────────────────────────────

  test('GET /:year/:quarter builds a draft aggregating fuel gallons per state + trip hints', async () => {
    const carrier = await createTestUser({ role: 'carrier' });
    const token = generateToken(carrier);

    // Two IL receipts + one TX receipt in Q1
    await request(app).post('/api/ifta/fuel').set('Authorization', `Bearer ${token}`)
      .send({ date: inQ1, jurisdiction: 'IL', gallons: 60 });
    await request(app).post('/api/ifta/fuel').set('Authorization', `Bearer ${token}`)
      .send({ date: inQ1, jurisdiction: 'IL', gallons: 40 });
    await request(app).post('/api/ifta/fuel').set('Authorization', `Bearer ${token}`)
      .send({ date: inQ1, jurisdiction: 'TX', gallons: 25 });

    // A receipt OUTSIDE the quarter must not be aggregated in
    await request(app).post('/api/ifta/fuel').set('Authorization', `Bearer ${token}`)
      .send({ date: new Date('2025-05-01T12:00:00.000Z'), jurisdiction: 'IL', gallons: 999 });

    // A completed trip travelling IL + IN, 500 miles, in Q1
    await Trip.create({
      carrier: carrier._id,
      name: 'Q1 Trip',
      status: 'completed',
      actualDepartureAt: inQ1,
      route: { totalDistanceMiles: 500 },
      waypoints: [
        { type: 'origin', state: 'IL' },
        { type: 'delivery', state: 'IN' },
      ],
    });

    const res = await request(app)
      .get(`/api/ifta/${YEAR}/${Q}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.report.status).toBe('draft');

    // Fuel aggregated per state (Q1 only — the May receipt is excluded)
    expect(res.body.fuelByState.IL).toBe(100);
    expect(res.body.fuelByState.TX).toBe(25);
    expect(res.body.fuelByState.IL).not.toBe(1099);

    const byCode = Object.fromEntries(res.body.report.jurisdictions.map((j) => [j.jurisdiction, j]));
    expect(byCode.IL.taxPaidGallons).toBe(100);
    expect(byCode.TX.taxPaidGallons).toBe(25);
    // IN seeded from the trip even though it has no fuel
    expect(byCode.IN).toBeDefined();
    expect(byCode.IN.taxPaidGallons).toBe(0);

    // Trip miles surfaced as a hint (manual entry is what actually counts)
    expect(res.body.quarterTotalMilesHint).toBe(500);
    expect(res.body.disclaimer).toMatch(/not tax advice/i);
  });

  // ── Manual miles + recompute ─────────────────────────────────────────────────

  test('PUT saves manual miles and recompute reflects taxableGallons = taxableMiles / fleetMpg', async () => {
    const carrier = await createTestUser({ role: 'carrier' });
    const token = generateToken(carrier);

    await request(app).post('/api/ifta/fuel').set('Authorization', `Bearer ${token}`)
      .send({ date: inQ1, jurisdiction: 'IL', gallons: 80 });

    // Build the seeded draft
    await request(app).get(`/api/ifta/${YEAR}/${Q}`).set('Authorization', `Bearer ${token}`);

    // Save manual miles + a fleet MPG of 6
    const put = await request(app)
      .put(`/api/ifta/${YEAR}/${Q}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fleetMpg: 6,
        jurisdictions: [{ jurisdiction: 'IL', totalMiles: 600, taxableMiles: 600 }],
      });

    expect(put.status).toBe(200);
    // 600 taxable miles / 6 mpg = 100 taxable gallons
    expect(put.body.report.totalTaxableGallons).toBe(100);
    // net = taxable (100) − tax-paid (80) = 20
    expect(put.body.report.totalTaxPaidGallons).toBe(80);
    expect(put.body.report.netTaxableGallons).toBe(20);

    // A later build preserves the manual miles + mpg and recomputes the same way
    const rebuilt = await request(app)
      .get(`/api/ifta/${YEAR}/${Q}`)
      .set('Authorization', `Bearer ${token}`);

    expect(rebuilt.body.report.fleetMpg).toBe(6);
    const il = rebuilt.body.report.jurisdictions.find((j) => j.jurisdiction === 'IL');
    expect(il.taxableMiles).toBe(600);
    expect(rebuilt.body.report.totalTaxableGallons).toBe(100);
  });

  // ── Freeze on finalize ───────────────────────────────────────────────────────

  test('finalize freezes the worksheet so a later GET does not re-seed from new data', async () => {
    const carrier = await createTestUser({ role: 'carrier' });
    const token = generateToken(carrier);

    await request(app).post('/api/ifta/fuel').set('Authorization', `Bearer ${token}`)
      .send({ date: inQ1, jurisdiction: 'IL', gallons: 100 });

    await request(app).get(`/api/ifta/${YEAR}/${Q}`).set('Authorization', `Bearer ${token}`);

    const fin = await request(app)
      .post(`/api/ifta/${YEAR}/${Q}/finalize`)
      .set('Authorization', `Bearer ${token}`);
    expect(fin.status).toBe(200);
    expect(fin.body.report.status).toBe('finalized');
    expect(fin.body.report.finalizedAt).toBeTruthy();

    // New fuel arrives AFTER finalize — the frozen worksheet must ignore it
    await request(app).post('/api/ifta/fuel').set('Authorization', `Bearer ${token}`)
      .send({ date: inQ1, jurisdiction: 'IL', gallons: 50 });

    const after = await request(app)
      .get(`/api/ifta/${YEAR}/${Q}`)
      .set('Authorization', `Bearer ${token}`);

    expect(after.body.report.status).toBe('finalized');
    // Still 100 — NOT re-aggregated to 150
    expect(after.body.report.totalTaxPaidGallons).toBe(100);
    const il = after.body.report.jurisdictions.find((j) => j.jurisdiction === 'IL');
    expect(il.taxPaidGallons).toBe(100);

    // A finalized report cannot be edited
    const put = await request(app)
      .put(`/api/ifta/${YEAR}/${Q}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fleetMpg: 7 });
    expect(put.status).toBe(409);
  });

  // ── Company scoping ──────────────────────────────────────────────────────────

  test('company-scoping isolates another carrier\'s data', async () => {
    const carrierA = await createTestUser({ role: 'carrier' });
    const carrierB = await createTestUser({ role: 'carrier' });
    const tokenA = generateToken(carrierA);
    const tokenB = generateToken(carrierB);

    await request(app).post('/api/ifta/fuel').set('Authorization', `Bearer ${tokenA}`)
      .send({ date: inQ1, jurisdiction: 'IL', gallons: 120 });

    // Carrier B sees none of A's receipts
    const listB = await request(app)
      .get(`/api/ifta/fuel?year=${YEAR}&quarter=${Q}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(listB.status).toBe(200);
    expect(listB.body.fuelPurchases).toHaveLength(0);

    // Carrier B's worksheet is empty (no IL row seeded from A's fuel)
    const reportB = await request(app)
      .get(`/api/ifta/${YEAR}/${Q}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(reportB.status).toBe(200);
    expect(reportB.body.report.jurisdictions).toHaveLength(0);
    expect(reportB.body.fuelByState).toEqual({});

    // Carrier A still sees their own
    const listA = await request(app)
      .get(`/api/ifta/fuel?year=${YEAR}&quarter=${Q}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(listA.body.fuelPurchases).toHaveLength(1);
    expect(listA.body.fuelPurchases[0].jurisdiction).toBe('IL');
  });

  // ── Non-carrier guard ────────────────────────────────────────────────────────

  test('non-carriers are forbidden', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const res = await request(app)
      .get(`/api/ifta/${YEAR}/${Q}`)
      .set('Authorization', `Bearer ${generateToken(shipper)}`);
    expect(res.status).toBe(403);
  });
});
