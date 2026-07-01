/**
 * Predictive delivery-delay alert — fires once when the projected ETA (from the
 * current GPS position + speed) slips past the delivery window.
 */
require('../setup');
const { createTestUser, createTestLoad } = require('../helpers');
const Load = require('../../models/Load');
const { checkPredictedDelay } = require('../../services/delayService');

async function setup(overrides) {
  const shipper = await createTestUser({ role: 'shipper' });
  const carrier = await createTestUser({ role: 'carrier' });
  const load = await createTestLoad(shipper._id, { status: 'in-transit', acceptedBy: carrier._id, ...overrides });
  return { shipper, carrier, load };
}

describe('Predictive delivery-delay alert', () => {
  test('projected arrival past the delivery window → alerts once (idempotent)', async () => {
    const { load } = await setup({
      deliveryTimeWindow: { start: new Date(Date.now() - 2 * 3600000), end: new Date(Date.now() - 3600000) }, // due 1h ago
    });
    // Carrier still ~far from the Dallas destination.
    const r1 = await checkPredictedDelay({ loadId: load._id, latitude: 41.0, longitude: -87.0, speed: 90 });
    expect(r1.alerted).toBe(true);
    expect(r1.minutesLate).toBeGreaterThan(0);

    const fresh = await Load.findById(load._id);
    expect(fresh.delayAlertSentAt).toBeTruthy();

    // A later ping must NOT re-alert.
    const r2 = await checkPredictedDelay({ loadId: load._id, latitude: 40.0, longitude: -88.0, speed: 90 });
    expect(r2.alerted).toBe(false);
    expect(r2.reason).toBe('already_alerted');
  });

  test('on-time (arriving well before the window closes) → no alert', async () => {
    const { load } = await setup({
      deliveryTimeWindow: { start: new Date(Date.now() + 3600000), end: new Date(Date.now() + 10 * 86400000) },
    });
    // Basically at the destination already.
    const r = await checkPredictedDelay({ loadId: load._id, latitude: 32.7767, longitude: -96.797, speed: 60 });
    expect(r.alerted).toBe(false);
    const fresh = await Load.findById(load._id);
    expect(fresh.delayAlertSentAt).toBeFalsy();
  });

  test('not in-transit → no alert', async () => {
    const { load } = await setup({
      status: 'accepted',
      deliveryTimeWindow: { start: new Date(), end: new Date(Date.now() - 3600000) },
    });
    const r = await checkPredictedDelay({ loadId: load._id, latitude: 41.0, longitude: -87.0, speed: 90 });
    expect(r.alerted).toBe(false);
    expect(r.reason).toBe('not_in_transit');
  });
});
