/**
 * Unit: tripChainPlanner -- pure feasibility + profit ranking for the Truck Autopilot.
 * Geometry: points along one meridian, 1 degree of latitude = ~69.1 mi straight = ~86.4 road mi = ~104 min at 50 mph.
 */
const { planChains } = require('../../services/tripChainPlanner');

const NOW = new Date('2026-01-05T08:00:00Z');
const H = 3600000;
const at = (hours) => new Date(NOW.getTime() + hours * H);
const pt = (deg) => ({ lat: 35 + deg, lng: -90 });
const START = { ...pt(0), availableAt: NOW };
const FRESH = { driveMinLeft: 660, dutyWindowMinLeft: 840, cycleMinLeft: 4200, minSinceLastBreak: 0 };

function load(id, from, to, rateCents, over = {}) {
  return {
    id, originLat: pt(from).lat, originLng: pt(from).lng, destinationLat: pt(to).lat, destinationLng: pt(to).lng,
    distanceMiles: Math.abs(to - from) * 86, rateCents, equipmentType: 'Dry Van', loadWeight: 30000,
    pickupWindow: { start: at(0), end: at(48) }, deliveryWindow: null, ...over,
  };
}
const plan = (o) => planChains({ start: START, now: NOW, ...o });
const allInts = (p) => [p.totals.revenueCents, p.totals.ratePerMileCents, ...p.legs.map((l) => l.rateCents),
  ...(p.totals.costCents != null ? [p.totals.costCents, p.totals.netCents] : [])].every(Number.isInteger);

describe('tripChainPlanner', () => {
  test('single feasible load; unknown HOS is flagged and assumed fresh', () => {
    const r = plan({ candidates: [load('A', 0.05, 3, 100000)] });
    expect(r.plans).toHaveLength(1);
    const p = r.plans[0];
    expect(p.loadIds).toEqual(['A']);
    expect(p.hosAssumed).toBe(true);
    expect(p.warnings.join(' ')).toMatch(/Hours-of-service clock unknown/);
    expect(p.warnings.join(' ')).toMatch(/straight-line/);
    expect(allInts(p)).toBe(true);
  });

  test('known HOS is not flagged as assumed', () => {
    const r = plan({ hos: FRESH, candidates: [load('A', 0.05, 3, 100000)] });
    expect(r.plans[0].hosAssumed).toBe(false);
  });

  test('pickup window that cannot be met is excluded with a reason', () => {
    const r = plan({ candidates: [load('A', 1.5, 3, 100000, { pickupWindow: { start: at(0), end: new Date(NOW.getTime() + 10 * 60000) } })] });
    expect(r.plans).toHaveLength(0);
    expect(r.excluded.windowCantBeMet).toBe(1);
  });

  test('delivery window that cannot be met is excluded', () => {
    const r = plan({ candidates: [load('A', 0.05, 3, 100000, { deliveryWindow: { start: at(0), end: at(3) } })] });
    expect(r.plans).toHaveLength(0);
    expect(r.excluded.windowCantBeMet).toBe(1);
  });

  test('a load with no pickup window at all is not auto-plannable', () => {
    const r = plan({ candidates: [load('A', 0.05, 3, 100000, { pickupWindow: {} })] });
    expect(r.plans).toHaveLength(0);
    expect(r.excluded.noWindow).toBe(1);
  });

  test('pickup start only: latest arrival is start + 4h', () => {
    const ok = plan({ candidates: [load('A', 1.5, 3, 100000, { pickupWindow: { start: at(0) } })] }); // 208 min < 4h
    expect(ok.plans).toHaveLength(1);
    const late = plan({ candidates: [load('A', 1.5, 3, 100000, { pickupWindow: { start: at(-4) } })] }); // would have closed
    expect(late.plans).toHaveLength(0);
  });

  test('missing coordinates are excluded', () => {
    const r = plan({ candidates: [{ ...load('A', 0, 1, 100000), originLat: null }] });
    expect(r.excluded.noCoordinates).toBe(1);
  });

  describe('chains and ranking (cost known)', () => {
    const rules = { costPerMileCents: 150 };
    const A = load('A', 0.05, 3, 100000, { pickupWindow: { start: at(0), end: at(6) }, distanceMiles: 260 });

    test('a chain of 2 beats the single load when it nets more', () => {
      const B = load('B', 3, 5, 100000, { distanceMiles: 170 });
      const r = plan({ rules, candidates: [A, B], maxPlans: 5 });
      expect(r.plans[0].loadIds).toEqual(['A', 'B']);
      expect(r.plans.map((p) => p.loadIds.join('>'))).toContain('A');
      expect(r.plans[0].totals.netCents).toBeGreaterThan(r.plans.find((p) => p.loadIds.length === 1).totals.netCents);
      expect(r.plans[0].legs[1].deadheadMiles).toBe(0);
    });

    test('a chain does NOT outrank the single load when the second leg loses money', () => {
      const B = load('B', 3, 5, 1000, { distanceMiles: 170 });
      const r = plan({ rules, candidates: [A, B], maxPlans: 5 });
      expect(r.plans[0].loadIds).toEqual(['A']);
      const chain = r.plans.find((p) => p.loadIds.length === 2);
      expect(chain.totals.netCents).toBeLessThan(r.plans[0].totals.netCents);
    });

    test('plans that lose money are dropped and counted', () => {
      const r = plan({ rules, candidates: [load('A', 0.05, 3, 1000)] });
      expect(r.plans).toHaveLength(0);
      expect(r.excluded.unprofitable).toBeGreaterThan(0);
    });

    test('cost known => cost and net are integer cents', () => {
      const p = plan({ rules, candidates: [A] }).plans[0];
      expect(Number.isInteger(p.totals.costCents)).toBe(true);
      expect(p.totals.netCents).toBe(p.totals.revenueCents - p.totals.costCents);
      expect(allInts(p)).toBe(true);
    });
  });

  test('cost unknown => cost and net are null (never made up), with a warning', () => {
    const p = plan({ candidates: [load('A', 0.05, 3, 100000)] }).plans[0];
    expect(p.totals.costCents).toBeNull();
    expect(p.totals.netCents).toBeNull();
    expect(p.warnings.join(' ')).toMatch(/Cost per mile is not set/);
  });

  describe('hours of service', () => {
    const far = (over) => load('A', 1.5, 2, 100000, { pickupWindow: { start: at(0), end: at(5) }, ...over }); // ~155 min away

    test('11h drive limit forces a 10h reset that pushes a late pickup out of feasibility', () => {
      const hos = { ...FRESH, driveMinLeft: 60 };
      const r = plan({ hos, candidates: [far()] });
      expect(r.plans).toHaveLength(0);
      expect(r.excluded.hos).toBe(1);
    });

    test('...and when the window is long enough the reset is shown as a rest stop', () => {
      const hos = { ...FRESH, driveMinLeft: 60 };
      const r = plan({ hos, candidates: [far({ pickupWindow: { start: at(0), end: at(20) } })] });
      const stops = r.plans[0].legs[0].restStops;
      expect(stops.some((s) => s.type === 'reset' && s.minutes === 600)).toBe(true);
    });

    test('a 30-minute break is inserted after 8 hours of driving', () => {
      // 6 degrees = ~621 min of driving
      const r = plan({ hos: FRESH, rules: { maxDeadheadMiles: 600 }, candidates: [load('A', 6, 6.2, 100000, { pickupWindow: { start: at(0), end: at(24) } })] });
      const stops = r.plans[0].legs[0].restStops;
      expect(stops.filter((s) => s.type === 'break')).toHaveLength(1);
      expect(stops.some((s) => s.type === 'reset')).toBe(false);
    });

    test('the 70h cycle blocks a leg it cannot cover (no 34h restart modelled)', () => {
      const r = plan({ hos: { ...FRESH, cycleMinLeft: 100 }, candidates: [far()] });
      expect(r.plans).toHaveLength(0);
      expect(r.excluded.hos).toBe(1);
    });
  });

  test('min all-in rate per mile and max deadhead are hard filters', () => {
    const cands = [load('A', 0.05, 3, 100000), load('B', 1.4, 3, 100000)];
    const lowRate = plan({ rules: { minRatePerMileCents: 100000 }, candidates: cands });
    expect(lowRate.plans).toHaveLength(0);
    expect(lowRate.excluded.belowMinRate).toBe(2);
    const tight = plan({ rules: { maxDeadheadMiles: 50 }, candidates: cands });
    expect(tight.plans.map((p) => p.loadIds[0])).toEqual(['A']);
    expect(tight.excluded.tooFar).toBe(1);
  });

  test('equipment, weight and hazmat rules are hard filters', () => {
    const r = plan({
      rules: { equipmentTypes: ['Reefer'], maxWeightLbs: 10000 },
      candidates: [load('A', 0, 1, 100000), load('B', 0, 1, 100000, { equipmentType: 'Reefer', loadWeight: 20000 }),
        load('C', 0, 1, 100000, { equipmentType: 'Reefer', hazardousMaterial: true, loadWeight: 5000 })],
    });
    expect(r.plans).toHaveLength(0);
    expect(r.excluded).toMatchObject({ wrongEquipment: 1, overweight: 1, hazmat: 1 });
  });

  describe('be-home-by', () => {
    const rules = (homeBy) => ({ homeBase: pt(0), homeBy });
    const A = load('A', 0.05, 3, 100000, { distanceMiles: 260, pickupWindow: { start: at(0), end: at(6) } });

    test('is enforced: delivery plus the drive home must land before the deadline', () => {
      const r = plan({ rules: rules(at(12)), candidates: [A] });
      expect(r.plans).toHaveLength(0);
      expect(r.excluded.homeBy).toBeGreaterThan(0);
    });

    test('feasible deadline: empty miles home are included in the totals', () => {
      const r = plan({ rules: rules(at(72)), candidates: [A] });
      const p = r.plans[0];
      expect(p.returnHome.miles).toBeGreaterThan(200);
      expect(p.totals.deadheadMiles).toBeGreaterThan(p.returnHome.miles);
      expect(new Date(p.returnHome.arriveAt).getTime()).toBeLessThanOrEqual(at(72).getTime());
    });

    test('homeBy without a home base is ignored with a warning', () => {
      const r = plan({ rules: { homeBy: at(1) }, candidates: [A] });
      expect(r.plans).toHaveLength(1);
      expect(r.plans[0].warnings.join(' ')).toMatch(/Be home by/i);
    });
  });

  test('deterministic: identical input gives identical output', () => {
    const cands = [load('B', 0.1, 3, 90000), load('A', 0.1, 3, 90000), load('C', 3, 5, 80000), load('D', 3, 4, 80000)];
    const run = () => JSON.stringify(plan({ rules: { costPerMileCents: 120 }, candidates: cands, maxPlans: 5 }));
    expect(run()).toBe(run());
    // equal-scoring loads tie-break by id
    const tie = plan({ candidates: [load('B', 0.1, 3, 90000), load('A', 0.1, 3, 90000)], maxLoads: 1, maxPlans: 2 });
    expect(tie.plans.map((p) => p.loadIds[0])).toEqual(['A', 'B']);
  });

  test('every money output is an integer (chain, cost known)', () => {
    const r = plan({ rules: { costPerMileCents: 137 }, candidates: [load('A', 0.05, 3, 100001), load('B', 3, 5, 77777)], maxPlans: 5 });
    expect(r.plans.length).toBeGreaterThan(0);
    r.plans.forEach((p) => expect(allInts(p)).toBe(true));
  });

  test('requires now and a start', () => {
    expect(() => planChains({ start: START })).toThrow(/now/);
    expect(() => planChains({ now: NOW })).toThrow(/start/);
  });
});
