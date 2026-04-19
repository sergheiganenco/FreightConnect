/**
 * State Machine Unit Tests
 *
 * Tests the loadStateMachine service: canTransition() pure function
 * and transitionLoadStatus() DB-backed atomic transitions.
 */

require('./setup');
const mongoose = require('mongoose');
const {
  VALID_TRANSITIONS,
  canTransition,
  transitionLoadStatus,
} = require('../services/loadStateMachine');
const Load = require('../models/Load');
const { createTestUser, createTestLoad } = require('./setup');

describe('Load State Machine', () => {
  // ─── canTransition: valid transitions ─────────────────────────────────────

  describe('Valid Transitions', () => {
    test('open -> accepted should be valid', () => {
      expect(canTransition('open', 'accepted')).toBe(true);
    });

    test('open -> cancelled should be valid', () => {
      expect(canTransition('open', 'cancelled')).toBe(true);
    });

    test('accepted -> in-transit should be valid', () => {
      expect(canTransition('accepted', 'in-transit')).toBe(true);
    });

    test('accepted -> cancelled should be valid', () => {
      expect(canTransition('accepted', 'cancelled')).toBe(true);
    });

    test('in-transit -> delivered should be valid', () => {
      expect(canTransition('in-transit', 'delivered')).toBe(true);
    });

    test('in-transit -> disputed should be valid', () => {
      expect(canTransition('in-transit', 'disputed')).toBe(true);
    });

    test('delivered -> disputed should be valid', () => {
      expect(canTransition('delivered', 'disputed')).toBe(true);
    });

    test('disputed -> resolved should be valid', () => {
      expect(canTransition('disputed', 'resolved')).toBe(true);
    });
  });

  // ─── canTransition: invalid transitions ───────────────────────────────────

  describe('Invalid Transitions', () => {
    test('open -> delivered should be invalid (skip)', () => {
      expect(canTransition('open', 'delivered')).toBe(false);
    });

    test('open -> in-transit should be invalid (skip)', () => {
      expect(canTransition('open', 'in-transit')).toBe(false);
    });

    test('open -> disputed should be invalid', () => {
      expect(canTransition('open', 'disputed')).toBe(false);
    });

    test('accepted -> delivered should be invalid (skip)', () => {
      expect(canTransition('accepted', 'delivered')).toBe(false);
    });

    test('accepted -> open should be invalid (no rollback)', () => {
      expect(canTransition('accepted', 'open')).toBe(false);
    });

    test('in-transit -> open should be invalid', () => {
      expect(canTransition('in-transit', 'open')).toBe(false);
    });

    test('in-transit -> accepted should be invalid', () => {
      expect(canTransition('in-transit', 'accepted')).toBe(false);
    });

    test('in-transit -> cancelled should be invalid', () => {
      expect(canTransition('in-transit', 'cancelled')).toBe(false);
    });

    test('delivered -> open should be invalid', () => {
      expect(canTransition('delivered', 'open')).toBe(false);
    });

    test('delivered -> accepted should be invalid', () => {
      expect(canTransition('delivered', 'accepted')).toBe(false);
    });

    test('delivered -> in-transit should be invalid', () => {
      expect(canTransition('delivered', 'in-transit')).toBe(false);
    });

    test('delivered -> cancelled should be invalid', () => {
      expect(canTransition('delivered', 'cancelled')).toBe(false);
    });

    test('cancelled -> anything should be invalid (terminal state)', () => {
      expect(canTransition('cancelled', 'open')).toBe(false);
      expect(canTransition('cancelled', 'accepted')).toBe(false);
      expect(canTransition('cancelled', 'in-transit')).toBe(false);
      expect(canTransition('cancelled', 'delivered')).toBe(false);
      expect(canTransition('cancelled', 'disputed')).toBe(false);
      expect(canTransition('cancelled', 'resolved')).toBe(false);
    });

    test('disputed -> open should be invalid', () => {
      expect(canTransition('disputed', 'open')).toBe(false);
    });

    test('disputed -> accepted should be invalid', () => {
      expect(canTransition('disputed', 'accepted')).toBe(false);
    });

    test('disputed -> delivered should be invalid', () => {
      expect(canTransition('disputed', 'delivered')).toBe(false);
    });

    test('disputed -> cancelled should be invalid', () => {
      expect(canTransition('disputed', 'cancelled')).toBe(false);
    });

    test('unknown status should return false', () => {
      expect(canTransition('nonexistent', 'open')).toBe(false);
      expect(canTransition('pending', 'accepted')).toBe(false);
    });
  });

  // ─── VALID_TRANSITIONS completeness ───────────────────────────────────────

  describe('VALID_TRANSITIONS map', () => {
    test('should define all known statuses', () => {
      const knownStatuses = ['open', 'accepted', 'in-transit', 'delivered', 'cancelled', 'disputed'];
      for (const status of knownStatuses) {
        expect(VALID_TRANSITIONS).toHaveProperty(status);
        expect(Array.isArray(VALID_TRANSITIONS[status])).toBe(true);
      }
    });

    test('cancelled should have empty transitions array', () => {
      expect(VALID_TRANSITIONS['cancelled']).toEqual([]);
    });
  });

  // ─── transitionLoadStatus (DB-backed) ─────────────────────────────────────

  describe('transitionLoadStatus (DB)', () => {
    test('should atomically transition open -> accepted', async () => {
      const shipper = await createTestUser({ email: 'sm-s@test.com', role: 'shipper' });
      const carrier = await createTestUser({ email: 'sm-c@test.com', role: 'carrier' });
      const load = await createTestLoad(shipper._id);

      const result = await transitionLoadStatus(
        load._id, 'open', 'accepted',
        { acceptedBy: carrier._id },
        carrier._id
      );

      expect(result.success).toBe(true);
      expect(result.load.status).toBe('accepted');

      const reloaded = await Load.findById(load._id);
      expect(reloaded.status).toBe('accepted');
    });

    test('should fail when expected status mismatches current', async () => {
      const shipper = await createTestUser({ email: 'sm-mm@test.com', role: 'shipper' });
      const load = await createTestLoad(shipper._id); // status = open

      const result = await transitionLoadStatus(load._id, 'accepted', 'in-transit');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot transition');
    });

    test('should fail for invalid transition (open -> delivered)', async () => {
      const shipper = await createTestUser({ email: 'sm-inv@test.com', role: 'shipper' });
      const load = await createTestLoad(shipper._id);

      const result = await transitionLoadStatus(load._id, 'open', 'delivered');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not allowed');
    });

    test('should return error for non-existent load', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const result = await transitionLoadStatus(fakeId, 'open', 'accepted');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('should handle concurrent transitions atomically', async () => {
      const shipper = await createTestUser({ email: 'sm-race@test.com', role: 'shipper' });
      const c1 = await createTestUser({ email: 'sm-r1@test.com', role: 'carrier' });
      const c2 = await createTestUser({ email: 'sm-r2@test.com', role: 'carrier' });
      const load = await createTestLoad(shipper._id);

      const [r1, r2] = await Promise.all([
        transitionLoadStatus(load._id, 'open', 'accepted', { acceptedBy: c1._id }, c1._id),
        transitionLoadStatus(load._id, 'open', 'accepted', { acceptedBy: c2._id }, c2._id),
      ]);

      const successes = [r1, r2].filter((r) => r.success);
      const failures = [r1, r2].filter((r) => !r.success);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
      expect(successes[0].load.status).toBe('accepted');
    });

    test('should complete full lifecycle: open -> accepted -> in-transit -> delivered', async () => {
      const shipper = await createTestUser({ email: 'sm-full@test.com', role: 'shipper' });
      const carrier = await createTestUser({ email: 'sm-fc@test.com', role: 'carrier' });
      const load = await createTestLoad(shipper._id);

      const r1 = await transitionLoadStatus(load._id, 'open', 'accepted', { acceptedBy: carrier._id });
      expect(r1.success).toBe(true);

      const r2 = await transitionLoadStatus(load._id, 'accepted', 'in-transit');
      expect(r2.success).toBe(true);

      const r3 = await transitionLoadStatus(load._id, 'in-transit', 'delivered');
      expect(r3.success).toBe(true);

      const finalLoad = await Load.findById(load._id);
      expect(finalLoad.status).toBe('delivered');
    });

    test('should complete dispute lifecycle: delivered -> disputed -> resolved', async () => {
      const shipper = await createTestUser({ email: 'sm-disp@test.com', role: 'shipper' });
      const carrier = await createTestUser({ email: 'sm-dc@test.com', role: 'carrier' });
      const load = await createTestLoad(shipper._id, {
        status: 'delivered',
        acceptedBy: carrier._id,
      });

      const r1 = await transitionLoadStatus(load._id, 'delivered', 'disputed', {
        disputedBy: shipper._id,
        disputeReason: 'Damaged cargo',
      });
      expect(r1.success).toBe(true);

      const r2 = await transitionLoadStatus(load._id, 'disputed', 'resolved', {
        disputeResolution: 'carrier_fault',
      });
      expect(r2.success).toBe(true);

      const finalLoad = await Load.findById(load._id);
      expect(finalLoad.status).toBe('resolved');
    });
  });
});
