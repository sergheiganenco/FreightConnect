/**
 * Carrier scorecard on-time rate — verifies delivered-late detection
 * (deliveredAt > deliveryTimeWindow.end) and the resulting on-time %.
 */
require('../setup');
const { createTestUser, createTestLoad } = require('../helpers');
const { generateScorecard } = require('../../services/carrierScorecard');

describe('carrierScorecard on-time rate', () => {
  test('2 on-time + 1 late delivery → onTimeRate ≈ 0.67', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await createTestUser({ role: 'carrier' });
    const now = Date.now();

    // 2 on-time: delivered before the window closes
    for (let i = 0; i < 2; i++) {
      await createTestLoad(shipper._id, {
        status: 'delivered', acceptedBy: carrier._id,
        deliveredAt: new Date(now - 3600000),
        deliveryTimeWindow: { start: new Date(now - 7200000), end: new Date(now) },
      });
    }
    // 1 late: delivered after the window closed
    await createTestLoad(shipper._id, {
      status: 'delivered', acceptedBy: carrier._id,
      deliveredAt: new Date(now),
      deliveryTimeWindow: { start: new Date(now - 7200000), end: new Date(now - 3600000) },
    });

    const sc = await generateScorecard(carrier._id, 90);
    expect(sc.metrics.completedLoads).toBe(3);
    expect(sc.metrics.onTimeDeliveries).toBe(2);
    expect(sc.metrics.onTimeRate).toBeCloseTo(0.67, 1);
  });

  test('no completed loads → onTimeRate defaults to 1 (100%)', async () => {
    const carrier = await createTestUser({ role: 'carrier' });
    const sc = await generateScorecard(carrier._id, 90);
    expect(sc.metrics.completedLoads).toBe(0);
    expect(sc.metrics.onTimeRate).toBe(1);
  });
});
