/**
 * Integration: tax summary accuracy (real taxRoutes).
 *
 * The audit found the tax layer recomputed gross from Load.rate with a
 * hardcoded 5% fee while the actual payment pipeline charges 2% and stores
 * cents-accurate payouts on Payment — so the tax page disagreed with settled
 * money. It also never subtracted expenses from the persisted summary.
 *
 * Contract under test:
 *  - fee comes from the shared platform-fee constant (2%), not a stale 5%
 *  - when a released Payment exists for a load, its cents are the truth
 *  - deductible expenses are aggregated into the persisted record
 */

require('../setup');
const express = require('express');
const request = require('supertest');

const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const Payment = require('../../models/Payment');
const Expense = require('../../models/Expense');
const { PLATFORM_FEE_PCT } = require('../../config/fees');

const taxRoutes = require('../../routes/taxRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tax', taxRoutes);
  return app;
}

const YEAR = new Date().getFullYear();
const midYear = new Date(`${YEAR}-06-15T12:00:00.000Z`);

describe('Tax summary accuracy', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  test('shared fee constant is the payment pipeline rate (2%)', () => {
    expect(PLATFORM_FEE_PCT).toBe(0.02);
  });

  test('load WITHOUT a payment record: fee estimated at the shared 2% (not 5%)', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await createTestUser({ role: 'carrier' });
    await createTestLoad(shipper._id, {
      status: 'delivered',
      acceptedBy: carrier._id,
      deliveredAt: midYear,
      rate: 1000, // $1,000
    });

    const res = await request(app)
      .get(`/api/tax/summary/${YEAR}`)
      .set('Authorization', `Bearer ${generateToken(carrier)}`);

    expect(res.status).toBe(200);
    expect(res.body.totalEarningsCents).toBe(100000);
    expect(res.body.platformFeeCents).toBe(2000);  // 2% — was 5000 under the 5% bug
    expect(res.body.netEarningsCents).toBe(98000);
  });

  test('load WITH a released payment: cents-accurate Payment values win over Load.rate', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await createTestUser({ role: 'carrier' });
    const load = await createTestLoad(shipper._id, {
      status: 'delivered',
      acceptedBy: carrier._id,
      deliveredAt: midYear,
      rate: 1000, // list rate — but the settled amount below differs
    });
    await Payment.create({
      loadId: load._id,
      shipperId: shipper._id,
      carrierId: carrier._id,
      amountCents: 123456,          // actually settled $1,234.56
      platformFeeCents: 2469,
      carrierPayoutCents: 120987,
      amount: 1234.56,
      platformFee: 24.69,
      carrierPayout: 1209.87,
      status: 'released',
    });

    const res = await request(app)
      .get(`/api/tax/summary/${YEAR}`)
      .set('Authorization', `Bearer ${generateToken(carrier)}`);

    expect(res.status).toBe(200);
    expect(res.body.totalEarningsCents).toBe(123456);
    expect(res.body.platformFeeCents).toBe(2469);
    expect(res.body.netEarningsCents).toBe(120987);
  });

  test('deductible expenses are aggregated into the persisted summary', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await createTestUser({ role: 'carrier' });
    await createTestLoad(shipper._id, {
      status: 'delivered',
      acceptedBy: carrier._id,
      deliveredAt: midYear,
      rate: 1000,
    });
    await Expense.create({
      carrier: carrier._id,
      category: 'fuel',
      amountCents: 30000, // $300 deductible
      date: midYear,
      isDeductible: true,
    });
    await Expense.create({
      carrier: carrier._id,
      category: 'other',
      amountCents: 5000, // $50 NOT deductible — must be excluded
      date: midYear,
      isDeductible: false,
    });

    const res = await request(app)
      .get(`/api/tax/summary/${YEAR}`)
      .set('Authorization', `Bearer ${generateToken(carrier)}`);

    expect(res.status).toBe(200);
    expect(res.body.totalExpensesCents).toBe(30000);
    // net profit = net earnings (98000) - deductible expenses (30000)
    expect(res.body.netProfitCents).toBe(68000);
  });
});
