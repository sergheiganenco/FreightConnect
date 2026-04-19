/**
 * Load State Machine Tests
 *
 * Tests the loadStateMachine service directly, including:
 * - Valid and invalid transitions
 * - Atomic concurrent transition handling
 */

require('./setup');
const { canTransition, transitionLoadStatus, VALID_TRANSITIONS } = require('../services/loadStateMachine');
const { createTestUser, createTestLoad } = require('./helpers');
const Load = require('../models/Load');

describe('Load State Machine', () => {
  // ─── canTransition (pure function) ─────────────────────────────────────────

  test('should allow open -> accepted', () => {
    expect(canTransition('open', 'accepted')).toBe(true);
  });

  test('should allow open -> cancelled', () => {
    expect(canTransition('open', 'cancelled')).toBe(true);
  });

  test('should allow accepted -> in-transit', () => {
    expect(canTransition('accepted', 'in-transit')).toBe(true);
  });

  test('should allow accepted -> cancelled', () => {
    expect(canTransition('accepted', 'cancelled')).toBe(true);
  });

  test('should allow in-transit -> delivered', () => {
    expect(canTransition('in-transit', 'delivered')).toBe(true);
  });

  test('should allow in-transit -> disputed', () => {
    expect(canTransition('in-transit', 'disputed')).toBe(true);
  });

  test('should allow delivered -> disputed', () => {
    expect(canTransition('delivered', 'disputed')).toBe(true);
  });

  test('should reject delivered -> open', () => {
    expect(canTransition('delivered', 'open')).toBe(false);
  });

  test('should reject cancelled -> accepted', () => {
    expect(canTransition('cancelled', 'accepted')).toBe(false);
  });

  test('should reject open -> delivered (skip)', () => {
    expect(canTransition('open', 'delivered')).toBe(false);
  });

  test('should reject open -> in-transit (skip)', () => {
    expect(canTransition('open', 'in-transit')).toBe(false);
  });

  test('should reject unknown status', () => {
    expect(canTransition('nonexistent', 'open')).toBe(false);
  });

  // ─── transitionLoadStatus (DB-backed) ─────────────────────────────────────

  test('should atomically transition open -> accepted in the database', async () => {
    const shipper = await createTestUser({ email: 'sm-open@test.com', role: 'shipper' });
    const carrier = await createTestUser({ email: 'sm-carrier@test.com', role: 'carrier' });
    const load = await createTestLoad(shipper._id);

    const result = await transitionLoadStatus(
      load._id, 'open', 'accepted',
      { acceptedBy: carrier._id },
      carrier._id
    );

    expect(result.success).toBe(true);
    expect(result.load.status).toBe('accepted');

    // Verify in DB
    const reloaded = await Load.findById(load._id);
    expect(reloaded.status).toBe('accepted');
  });

  test('should fail when expected status does not match current', async () => {
    const shipper = await createTestUser({ email: 'sm-mismatch@test.com', role: 'shipper' });
    const load = await createTestLoad(shipper._id); // status = 'open'

    const result = await transitionLoadStatus(load._id, 'accepted', 'in-transit');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot transition');
  });

  test('should return error for non-existent load', async () => {
    const fakeId = new (require('mongoose').Types.ObjectId)();
    const result = await transitionLoadStatus(fakeId, 'open', 'accepted');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('should handle concurrent transitions atomically', async () => {
    const shipper = await createTestUser({ email: 'sm-conc@test.com', role: 'shipper' });
    const carrier1 = await createTestUser({ email: 'sm-c1@test.com', role: 'carrier' });
    const carrier2 = await createTestUser({ email: 'sm-c2@test.com', role: 'carrier' });
    const load = await createTestLoad(shipper._id); // status = 'open'

    // Fire two transitions simultaneously
    const [r1, r2] = await Promise.all([
      transitionLoadStatus(load._id, 'open', 'accepted', { acceptedBy: carrier1._id }, carrier1._id),
      transitionLoadStatus(load._id, 'open', 'accepted', { acceptedBy: carrier2._id }, carrier2._id),
    ]);

    // Exactly one should succeed
    const successes = [r1, r2].filter(r => r.success);
    const failures = [r1, r2].filter(r => !r.success);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(successes[0].load.status).toBe('accepted');

    // DB should reflect exactly one winner
    const finalLoad = await Load.findById(load._id);
    expect(finalLoad.status).toBe('accepted');
  });

  // ─── Full lifecycle ────────────────────────────────────────────────────────

  test('should complete full lifecycle: open -> accepted -> in-transit -> delivered', async () => {
    const shipper = await createTestUser({ email: 'sm-full@test.com', role: 'shipper' });
    const carrier = await createTestUser({ email: 'sm-fulc@test.com', role: 'carrier' });
    const load = await createTestLoad(shipper._id);

    const r1 = await transitionLoadStatus(load._id, 'open', 'accepted', { acceptedBy: carrier._id });
    expect(r1.success).toBe(true);

    const r2 = await transitionLoadStatus(load._id, 'accepted', 'in-transit');
    expect(r2.success).toBe(true);

    const r3 = await transitionLoadStatus(load._id, 'in-transit', 'delivered');
    expect(r3.success).toBe(true);

    const final = await Load.findById(load._id);
    expect(final.status).toBe('delivered');
  });
});
