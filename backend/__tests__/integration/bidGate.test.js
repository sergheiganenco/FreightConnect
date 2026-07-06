/**
 * Integration: bid-path booking gate (real bidRoutes).
 *
 * The direct accept path (PUT /api/loads/:id/accept) is hard-gated by
 * checkLoadEligibility + antiFraudGuard. Booking via negotiation must enforce
 * the SAME gate: PUT /api/bids/:id/accept (shipper) and
 * PUT /api/bids/:id/accept-counter (carrier) assign the load, so an
 * unverified/uninsured/uncredentialed carrier must not be bookable through them.
 */

require('../setup');
const express = require('express');
const request = require('supertest');

const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const Bid = require('../../models/Bid');
const Load = require('../../models/Load');

const bidRoutes = require('../../routes/bidRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/bids', bidRoutes);
  return app;
}

async function createVerifiedCarrier(overrides = {}) {
  return createTestUser({
    role: 'carrier',
    verification: {
      status: 'verified',
      identityVerified: true,
      insurance: { status: 'valid' },
    },
    fleet: [{ truckId: 'TRUCK-1', status: 'Available' }],
    ...overrides,
  });
}

async function createShipper() {
  return createTestUser({ role: 'shipper', companyName: 'Ship Co' });
}

async function placeBid({ load, carrier, amount = 2000 }) {
  return Bid.create({
    loadId: load._id,
    carrierId: carrier._id,
    amount,
    status: 'pending',
    history: [{ actor: 'carrier', action: 'placed', amount }],
  });
}

describe('Bid gate — shipper PUT /api/bids/:id/accept', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  test('blocks booking an UNVERIFIED carrier (403) and leaves load open', async () => {
    const shipper = await createShipper();
    const carrier = await createTestUser({ role: 'carrier' }); // no verification at all
    const load = await createTestLoad(shipper._id);
    const bid = await placeBid({ load, carrier });

    const res = await request(app)
      .put(`/api/bids/${bid._id}/accept`)
      .set('Authorization', `Bearer ${generateToken(shipper)}`);

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body.reasons || res.body.error)).toMatch(/verification/i);

    const freshLoad = await Load.findById(load._id);
    expect(freshLoad.status).toBe('open');
    expect(freshLoad.acceptedBy).toBeNull();
    const freshBid = await Bid.findById(bid._id);
    expect(freshBid.status).toBe('pending'); // bid untouched — shipper can wait for carrier to verify
  });

  test('blocks booking a carrier with LAPSED insurance (403)', async () => {
    const shipper = await createShipper();
    const carrier = await createVerifiedCarrier({
      verification: {
        status: 'verified',
        identityVerified: true,
        insurance: { status: 'lapsed' },
      },
    });
    const load = await createTestLoad(shipper._id);
    const bid = await placeBid({ load, carrier });

    const res = await request(app)
      .put(`/api/bids/${bid._id}/accept`)
      .set('Authorization', `Bearer ${generateToken(shipper)}`);

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body.reasons || res.body.error)).toMatch(/insurance/i);

    const freshLoad = await Load.findById(load._id);
    expect(freshLoad.status).toBe('open');
  });

  test('blocks booking a hazmat load onto a carrier without hazmat endorsement (403)', async () => {
    const shipper = await createShipper();
    const carrier = await createVerifiedCarrier(); // verified but no hazmat endorsement
    const load = await createTestLoad(shipper._id, { hazardousMaterial: true });
    const bid = await placeBid({ load, carrier });

    const res = await request(app)
      .put(`/api/bids/${bid._id}/accept`)
      .set('Authorization', `Bearer ${generateToken(shipper)}`);

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body.reasons || res.body.error)).toMatch(/hazmat/i);

    const freshLoad = await Load.findById(load._id);
    expect(freshLoad.status).toBe('open');
  });

  test('409s when the load is no longer open (already booked by another carrier)', async () => {
    const shipper = await createShipper();
    const carrier = await createVerifiedCarrier();
    const otherCarrier = await createVerifiedCarrier();
    const load = await createTestLoad(shipper._id, {
      status: 'accepted',
      acceptedBy: otherCarrier._id,
    });
    const bid = await placeBid({ load, carrier });

    const res = await request(app)
      .put(`/api/bids/${bid._id}/accept`)
      .set('Authorization', `Bearer ${generateToken(shipper)}`);

    expect(res.status).toBe(409);

    // The original booking must be untouched
    const freshLoad = await Load.findById(load._id);
    expect(String(freshLoad.acceptedBy)).toBe(String(otherCarrier._id));
  });

  test('books a fully verified + eligible carrier (200) and records fingerprint', async () => {
    const shipper = await createShipper();
    const carrier = await createVerifiedCarrier();
    const load = await createTestLoad(shipper._id);
    const bid = await placeBid({ load, carrier, amount: 2100 });

    const res = await request(app)
      .put(`/api/bids/${bid._id}/accept`)
      .set('Authorization', `Bearer ${generateToken(shipper)}`);

    expect(res.status).toBe(200);
    expect(res.body.finalAmount).toBe(2100);

    const freshLoad = await Load.findById(load._id);
    expect(freshLoad.status).toBe('accepted');
    expect(String(freshLoad.acceptedBy)).toBe(String(carrier._id));
    expect(freshLoad.rate).toBe(2100);
    // Audit parity with the direct-accept path
    expect(freshLoad.acceptanceFingerprint).toBeTruthy();
    expect(String(freshLoad.acceptanceFingerprint.carrierId)).toBe(String(carrier._id));
  });
});

describe('Bid gate — carrier PUT /api/bids/:id/accept-counter', () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  async function counteredBid({ load, carrier, counterAmount = 1900 }) {
    return Bid.create({
      loadId: load._id,
      carrierId: carrier._id,
      amount: 2000,
      counterAmount,
      status: 'countered',
      history: [
        { actor: 'carrier', action: 'placed', amount: 2000 },
        { actor: 'shipper', action: 'countered', amount: counterAmount },
      ],
    });
  }

  test('blocks an UNVERIFIED carrier from accepting a counter (403) and leaves load open', async () => {
    const shipper = await createShipper();
    const carrier = await createTestUser({ role: 'carrier' });
    const load = await createTestLoad(shipper._id);
    const bid = await counteredBid({ load, carrier });

    const res = await request(app)
      .put(`/api/bids/${bid._id}/accept-counter`)
      .set('Authorization', `Bearer ${generateToken(carrier)}`);

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body.reasons || res.body.error)).toMatch(/verification/i);

    const freshLoad = await Load.findById(load._id);
    expect(freshLoad.status).toBe('open');
    expect(freshLoad.acceptedBy).toBeNull();
    const freshBid = await Bid.findById(bid._id);
    expect(freshBid.status).toBe('countered');
  });

  test('books a verified carrier accepting a counter (200)', async () => {
    const shipper = await createShipper();
    const carrier = await createVerifiedCarrier();
    const load = await createTestLoad(shipper._id);
    const bid = await counteredBid({ load, carrier, counterAmount: 1850 });

    const res = await request(app)
      .put(`/api/bids/${bid._id}/accept-counter`)
      .set('Authorization', `Bearer ${generateToken(carrier)}`);

    expect(res.status).toBe(200);
    expect(res.body.finalAmount).toBe(1850);

    const freshLoad = await Load.findById(load._id);
    expect(freshLoad.status).toBe('accepted');
    expect(String(freshLoad.acceptedBy)).toBe(String(carrier._id));
    expect(freshLoad.acceptanceFingerprint).toBeTruthy();
  });
});
