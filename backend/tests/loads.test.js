/**
 * Load Lifecycle Tests
 *
 * Tests the full load lifecycle via HTTP endpoints:
 *   - Shipper posts load
 *   - Carrier accepts load
 *   - Double-accept prevention (409)
 *   - Unverified carrier rejection (403)
 *   - Cancellation flows (open, accepted by shipper, accepted by carrier)
 *   - Cannot cancel in-transit (409)
 *   - Dispute filing on delivered load
 *   - Admin resolves dispute
 */

require('./setup');
const request = require('supertest');
const Load = require('../models/Load');
const {
  createTestUser,
  createVerifiedCarrier,
  createVerifiedShipper,
  generateToken,
  createTestLoad,
  createLoadTestApp,
} = require('./setup');

describe('Load Lifecycle', () => {
  let app;

  beforeAll(() => {
    app = createLoadTestApp();
  });

  // ─── Shipper posts load ───────────────────────────────────────────────────

  describe('POST /api/loads', () => {
    test('should create load with status open (201)', async () => {
      const shipper = await createVerifiedShipper({ email: 'post-shipper@test.com' });
      const token = generateToken(shipper);

      const res = await request(app)
        .post('/api/loads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Chicago to Dallas',
          origin: 'Chicago, IL',
          destination: 'Dallas, TX',
          rate: 2500,
          equipmentType: 'Dry Van',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('open');
      expect(res.body.title).toBe('Chicago to Dallas');
      expect(res.body.postedBy.toString()).toBe(shipper._id.toString());
    });

    test('should reject load creation by carrier (403)', async () => {
      const carrier = await createVerifiedCarrier({ email: 'carrier-post@test.com' });
      const token = generateToken(carrier);

      const res = await request(app)
        .post('/api/loads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Some Load',
          origin: 'A',
          destination: 'B',
          rate: 1000,
          equipmentType: 'Flatbed',
        });

      expect(res.status).toBe(403);
    });
  });

  // ─── Carrier accepts load ─────────────────────────────────────────────────

  describe('PUT /api/loads/:id/accept', () => {
    test('should accept open load (status = accepted)', async () => {
      const shipper = await createVerifiedShipper({ email: 'sh-accept@test.com' });
      const carrier = await createVerifiedCarrier({ email: 'cr-accept@test.com' });
      const load = await createTestLoad(shipper._id);
      const token = generateToken(carrier);

      const res = await request(app)
        .put(`/api/loads/${load._id}/accept`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.load.status).toBe('accepted');
      expect(res.body.load.acceptedBy.toString()).toBe(carrier._id.toString());
    });

    test('should reject double-accept (409)', async () => {
      const shipper = await createVerifiedShipper({ email: 'sh-dbl@test.com' });
      const carrier1 = await createVerifiedCarrier({ email: 'cr1-dbl@test.com' });
      const carrier2 = await createVerifiedCarrier({ email: 'cr2-dbl@test.com' });
      const load = await createTestLoad(shipper._id);

      // First carrier accepts
      const token1 = generateToken(carrier1);
      const res1 = await request(app)
        .put(`/api/loads/${load._id}/accept`)
        .set('Authorization', `Bearer ${token1}`);
      expect(res1.status).toBe(200);

      // Second carrier tries to accept same load
      const token2 = generateToken(carrier2);
      const res2 = await request(app)
        .put(`/api/loads/${load._id}/accept`)
        .set('Authorization', `Bearer ${token2}`);
      expect(res2.status).toBe(409);
    });

    test('should reject unverified carrier (403)', async () => {
      const shipper = await createVerifiedShipper({ email: 'sh-unv@test.com' });
      const unverifiedCarrier = await createTestUser({
        email: 'cr-unv@test.com',
        role: 'carrier',
        // No verification sub-doc -> status defaults to 'unverified'
      });
      const load = await createTestLoad(shipper._id);
      const token = generateToken(unverifiedCarrier);

      const res = await request(app)
        .put(`/api/loads/${load._id}/accept`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('verification');
    });
  });

  // ─── Cancellation flows ───────────────────────────────────────────────────

  describe('PUT /api/loads/:id/cancel', () => {
    test('should cancel open load (shipper) with no fee', async () => {
      const shipper = await createVerifiedShipper({ email: 'sh-canopen@test.com' });
      const load = await createTestLoad(shipper._id);
      const token = generateToken(shipper);

      const res = await request(app)
        .put(`/api/loads/${load._id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Changed plans' });

      expect(res.status).toBe(200);
      expect(res.body.loadStatus).toBe('cancelled');
      expect(res.body.tonuFeeCents).toBe(0);
    });

    test('should cancel accepted load (shipper) with TONU fee', async () => {
      const shipper = await createVerifiedShipper({ email: 'sh-cantonu@test.com' });
      const carrier = await createVerifiedCarrier({ email: 'cr-cantonu@test.com' });
      const load = await createTestLoad(shipper._id, {
        status: 'accepted',
        acceptedBy: carrier._id,
      });
      const token = generateToken(shipper);

      const res = await request(app)
        .put(`/api/loads/${load._id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Found cheaper carrier' });

      expect(res.status).toBe(200);
      expect(res.body.tonuFeeCents).toBe(25000); // $250 TONU
    });

    test('should cancel accepted load (carrier) with trust penalty and re-open', async () => {
      const shipper = await createVerifiedShipper({ email: 'sh-crcan@test.com' });
      const carrier = await createVerifiedCarrier({ email: 'cr-crcan@test.com' });
      const load = await createTestLoad(shipper._id, {
        status: 'accepted',
        acceptedBy: carrier._id,
      });
      const token = generateToken(carrier);

      const res = await request(app)
        .put(`/api/loads/${load._id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Truck broke down' });

      expect(res.status).toBe(200);
      expect(res.body.loadStatus).toBe('open'); // load re-opened
      expect(res.body.trustScorePenalty).toBe(-5);

      // Verify load is actually re-opened in DB
      const reloaded = await Load.findById(load._id);
      expect(reloaded.status).toBe('open');
      expect(reloaded.acceptedBy).toBeNull();
    });

    test('should reject cancel of in-transit load (409)', async () => {
      const shipper = await createVerifiedShipper({ email: 'sh-intransit@test.com' });
      const carrier = await createVerifiedCarrier({ email: 'cr-intransit@test.com' });
      const load = await createTestLoad(shipper._id, {
        status: 'in-transit',
        acceptedBy: carrier._id,
      });
      const token = generateToken(shipper);

      const res = await request(app)
        .put(`/api/loads/${load._id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Too late' });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('in-transit');
    });
  });

  // ─── Dispute flows ────────────────────────────────────────────────────────

  describe('PUT /api/loads/:id/dispute', () => {
    test('should file dispute on delivered load (status = disputed)', async () => {
      const shipper = await createVerifiedShipper({ email: 'sh-disp@test.com' });
      const carrier = await createVerifiedCarrier({ email: 'cr-disp@test.com' });
      const load = await createTestLoad(shipper._id, {
        status: 'delivered',
        acceptedBy: carrier._id,
        deliveredAt: new Date(),
      });
      const token = generateToken(shipper);

      const res = await request(app)
        .put(`/api/loads/${load._id}/dispute`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Cargo damaged during transit', type: 'cargo_damage' });

      expect(res.status).toBe(200);
      expect(res.body.loadStatus).toBe('disputed');
      expect(res.body.disputeType).toBe('cargo_damage');

      // Verify in DB
      const reloaded = await Load.findById(load._id);
      expect(reloaded.status).toBe('disputed');
    });

    test('should reject dispute on open load (409)', async () => {
      const shipper = await createVerifiedShipper({ email: 'sh-nodisp@test.com' });
      const load = await createTestLoad(shipper._id); // status = open
      const token = generateToken(shipper);

      const res = await request(app)
        .put(`/api/loads/${load._id}/dispute`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Some reason' });

      expect(res.status).toBe(409);
    });

    test('should require dispute reason', async () => {
      const shipper = await createVerifiedShipper({ email: 'sh-noreason@test.com' });
      const carrier = await createVerifiedCarrier({ email: 'cr-noreason@test.com' });
      const load = await createTestLoad(shipper._id, {
        status: 'delivered',
        acceptedBy: carrier._id,
      });
      const token = generateToken(shipper);

      const res = await request(app)
        .put(`/api/loads/${load._id}/dispute`)
        .set('Authorization', `Bearer ${token}`)
        .send({}); // no reason

      expect(res.status).toBe(400);
    });
  });

  // ─── Admin resolves dispute ───────────────────────────────────────────────

  describe('PUT /api/loads/:id/resolve', () => {
    test('should resolve disputed load (admin, status = resolved)', async () => {
      const shipper = await createVerifiedShipper({ email: 'sh-resolve@test.com' });
      const carrier = await createVerifiedCarrier({ email: 'cr-resolve@test.com' });
      const admin = await createTestUser({ email: 'admin-resolve@test.com', role: 'admin' });

      const load = await createTestLoad(shipper._id, {
        status: 'disputed',
        acceptedBy: carrier._id,
        disputedBy: shipper._id,
        disputeReason: 'Damaged cargo',
      });

      const token = generateToken(admin);
      const res = await request(app)
        .put(`/api/loads/${load._id}/resolve`)
        .set('Authorization', `Bearer ${token}`)
        .send({ resolution: 'carrier_fault', notes: 'Photos confirmed damage' });

      expect(res.status).toBe(200);
      expect(res.body.loadStatus).toBe('resolved');
      expect(res.body.resolution).toBe('carrier_fault');

      // Verify in DB
      const reloaded = await Load.findById(load._id);
      expect(reloaded.status).toBe('resolved');
      expect(reloaded.disputeResolution).toBe('carrier_fault');
    });

    test('should reject resolve by non-admin (403)', async () => {
      const shipper = await createVerifiedShipper({ email: 'sh-noadm@test.com' });
      const carrier = await createVerifiedCarrier({ email: 'cr-noadm@test.com' });
      const load = await createTestLoad(shipper._id, {
        status: 'disputed',
        acceptedBy: carrier._id,
      });

      const token = generateToken(shipper);
      const res = await request(app)
        .put(`/api/loads/${load._id}/resolve`)
        .set('Authorization', `Bearer ${token}`)
        .send({ resolution: 'dismissed' });

      expect(res.status).toBe(403);
    });

    test('should reject resolve on non-disputed load (409)', async () => {
      const shipper = await createVerifiedShipper({ email: 'sh-notdisp@test.com' });
      const admin = await createTestUser({ email: 'admin-notdisp@test.com', role: 'admin' });
      const load = await createTestLoad(shipper._id); // status = open

      const token = generateToken(admin);
      const res = await request(app)
        .put(`/api/loads/${load._id}/resolve`)
        .set('Authorization', `Bearer ${token}`)
        .send({ resolution: 'dismissed' });

      expect(res.status).toBe(409);
    });
  });
});
