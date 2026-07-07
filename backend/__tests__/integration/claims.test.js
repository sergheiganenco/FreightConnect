/**
 * Integration: cargo claims (damage / loss / shortage / overage).
 *
 * Covers the claim lifecycle: a party on a booked load files a claim against the
 * counterparty, the counterparty can see it, non-parties cannot, an admin
 * resolves it (approving an amount in integer cents), and the claimant can
 * withdraw an open claim. Money is asserted to stay in integer cents.
 *
 * Harness note: this mirrors the existing integration tests by building a local
 * Express app and mounting the router under test. In production the maintainer
 * mounts claimRoutes at /api/claims in app.js — the path used here matches.
 */

require('../setup');
const express = require('express');
const request = require('supertest');
const Claim = require('../../models/Claim');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/claims', require('../../routes/claimRoutes'));
  return app;
}

describe('cargo claims', () => {
  let app, shipper, carrier, admin, shipperToken, carrierToken, adminToken, load;

  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper', companyName: 'Ship Co' });
    carrier = await createTestUser({ role: 'carrier', companyName: 'Haul Co' });
    admin   = await createTestUser({ role: 'admin', companyName: 'FreightConnect' });
    shipperToken = generateToken(shipper);
    carrierToken = generateToken(carrier);
    adminToken   = generateToken(admin);

    // A booked, delivered load: shipper posted it, carrier hauled it.
    load = await createTestLoad(shipper._id, {
      status: 'delivered',
      acceptedBy: carrier._id,
    });
  });

  function fileClaim(token, overrides = {}) {
    return request(app)
      .post('/api/claims')
      .set('Authorization', `Bearer ${token}`)
      .send({
        loadId: String(load._id),
        type: 'damage',
        amountCents: 150000, // $1,500.00 in integer cents
        description: 'Two pallets crushed on arrival',
        ...overrides,
      });
  }

  test('a shipper files a claim on a delivered load (201) with the carrier as respondent', async () => {
    const res = await fileClaim(shipperToken);
    expect(res.status).toBe(201);
    expect(res.body.claimantRole).toBe('shipper');
    expect(String(res.body.claimant)).toBe(String(shipper._id));
    expect(String(res.body.respondent)).toBe(String(carrier._id));
    expect(res.body.status).toBe('open');
    expect(res.body.amountCents).toBe(150000);
    // A seed note captures the original description.
    expect(res.body.notes).toHaveLength(1);
    expect(res.body.notes[0].content).toBe('Two pallets crushed on arrival');
  });

  test('filing is rejected on a load with no acceptedBy (400)', async () => {
    const openLoad = await createTestLoad(shipper._id, { status: 'open' }); // no acceptedBy
    const res = await request(app)
      .post('/api/claims')
      .set('Authorization', `Bearer ${shipperToken}`)
      .send({ loadId: String(openLoad._id), type: 'loss', amountCents: 5000, description: 'x' });
    expect(res.status).toBe(400);
  });

  test('the counterparty carrier can list the claim', async () => {
    await fileClaim(shipperToken);

    const res = await request(app)
      .get('/api/claims')
      .set('Authorization', `Bearer ${carrierToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.claims).toHaveLength(1);
    expect(res.body.claims[0].type).toBe('damage');
  });

  test('a non-party cannot GET the claim (403)', async () => {
    const filed = await fileClaim(shipperToken);
    const stranger = await createTestUser({ role: 'carrier', companyName: 'Rando LLC' });
    const strangerToken = generateToken(stranger);

    const res = await request(app)
      .get(`/api/claims/${filed.body._id}`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect([403, 404]).toContain(res.status);
    expect(res.status).toBe(403);
  });

  test('an admin resolves a claim, setting status and resolvedAmountCents', async () => {
    const filed = await fileClaim(shipperToken);

    const res = await request(app)
      .put(`/api/claims/${filed.body._id}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'resolved', resolution: 'Approved partial payout', resolvedAmountCents: 120000 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolved');
    expect(res.body.resolvedAmountCents).toBe(120000);
    expect(res.body.resolvedBy).toBeTruthy();
    expect(res.body.resolvedAt).toBeTruthy();

    // A non-admin party cannot resolve.
    const denied = await request(app)
      .put(`/api/claims/${filed.body._id}/resolve`)
      .set('Authorization', `Bearer ${carrierToken}`)
      .send({ status: 'denied' });
    expect(denied.status).toBe(403);
  });

  test('the claimant can withdraw an open claim', async () => {
    const filed = await fileClaim(shipperToken);

    const res = await request(app)
      .put(`/api/claims/${filed.body._id}/withdraw`)
      .set('Authorization', `Bearer ${shipperToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('withdrawn');

    // The respondent (carrier) is NOT the claimant and cannot withdraw.
    const other = await fileClaim(shipperToken);
    const denied = await request(app)
      .put(`/api/claims/${other.body._id}/withdraw`)
      .set('Authorization', `Bearer ${carrierToken}`);
    expect(denied.status).toBe(403);
  });

  test('claim amounts are stored as integer cents', async () => {
    const filed = await fileClaim(shipperToken, { amountCents: 249999 });
    expect(filed.status).toBe(201);

    const stored = await Claim.findById(filed.body._id).lean();
    expect(Number.isInteger(stored.amountCents)).toBe(true);
    expect(stored.amountCents).toBe(249999);
  });
});
