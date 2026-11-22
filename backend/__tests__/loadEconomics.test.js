const { estimateEconomics } = require('../utils/loadEconomics');

const base = { rateCents: 250000, tripMiles: 500, deadheadMiles: 100, costPerMileCents: 200 };

describe('estimateEconomics', () => {
  test('with deadhead: cost over trip+deadhead miles, exact cents', () => {
    expect(estimateEconomics(base)).toEqual({
      costCents: 120000, profitCents: 130000, profitPerMileCents: 217, totalMiles: 600, includesDeadhead: true,
    });
  });

  test('without deadhead: trip miles only and flagged', () => {
    const e = estimateEconomics({ ...base, deadheadMiles: null });
    expect(e).toEqual({
      costCents: 100000, profitCents: 150000, profitPerMileCents: 300, totalMiles: 500, includesDeadhead: false,
    });
  });

  test('negative profit is a valid result', () => {
    const e = estimateEconomics({ ...base, rateCents: 90000 });
    expect(e.profitCents).toBe(-30000);
    expect(e.profitPerMileCents).toBe(-50);
  });

  test('null when cost, miles or rate missing/invalid', () => {
    expect(estimateEconomics({ ...base, costPerMileCents: null })).toBeNull();
    expect(estimateEconomics({ ...base, costPerMileCents: 0 })).toBeNull();
    expect(estimateEconomics({ ...base, costPerMileCents: 1.5 })).toBeNull();
    expect(estimateEconomics({ ...base, tripMiles: null })).toBeNull();
    expect(estimateEconomics({ ...base, tripMiles: 0 })).toBeNull();
    expect(estimateEconomics({ ...base, rateCents: null })).toBeNull();
    expect(estimateEconomics({ ...base, rateCents: 0 })).toBeNull();
  });

  test('rounds once at the end: 967.22 mi x 187 c = 180,870.14 -> 180870', () => {
    const e = estimateEconomics({ rateCents: 300000, tripMiles: 967.22, deadheadMiles: null, costPerMileCents: 187 });
    expect(e.costCents).toBe(180870);
    expect(Number.isInteger(e.profitCents)).toBe(true);
    expect(e.profitCents).toBe(119130);
  });

  test('no float drift: rate $2650.10 as 265010 cents stays exact', () => {
    const rateCents = Math.round(2650.10 * 100);
    expect(rateCents).toBe(265010);
    const e = estimateEconomics({ rateCents, tripMiles: 1000, deadheadMiles: 0, costPerMileCents: 150 });
    expect(e.costCents).toBe(150000);
    expect(e.profitCents).toBe(115010);
    expect(e.profitPerMileCents).toBe(115);
  });
});
