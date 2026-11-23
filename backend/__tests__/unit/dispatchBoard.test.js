/**
 * Unit: dispatchBoardService.deriveTruckRow / matchesSearch (pure, no DB).
 */
const { deriveTruckRow, matchesSearch } = require('../../services/dispatchBoardService');

const now = new Date('2026-11-22T12:00:00Z');
const ago = (min) => new Date(now.getTime() - min * 60000);
const ahead = (min) => new Date(now.getTime() + min * 60000);
const truck = (o = {}) => ({ truckId: 'T1', status: 'Available', available: true, ...o });
const load = (o = {}) => ({
  _id: 'L1', title: 'Chi-Mke', origin: 'Chicago, IL', destination: 'Milwaukee, WI', status: 'accepted',
  pickupTimeWindow: { start: ahead(600), end: ahead(700) },
  deliveryTimeWindow: { start: ahead(800), end: ahead(900) }, ...o,
});
const transit = (o = {}) => load({
  status: 'in-transit', destinationLat: 43.0389, destinationLng: -87.9065,
  carrierLocation: { latitude: 41.9, longitude: -87.7, updatedAt: ago(5), lastAuthenticated: { latitude: 41.9, longitude: -87.7, updatedAt: ago(5) } },
  ...o,
});
const row = (t, loads = [], driver = null) => deriveTruckRow({ truck: t, driver, loads, now });

describe('deriveTruckRow states', () => {
  test('idle: available, no load', () => expect(row(truck()).state).toBe('idle'));
  test.each(['Maintenance', 'Offline', 'Unavailable'])('out_of_service: status %s', (status) => {
    expect(row(truck({ status })).state).toBe('out_of_service');
  });
  test('out_of_service: available=false', () => expect(row(truck({ available: false })).state).toBe('out_of_service'));
  test('booked: accepted load not yet picked up', () => {
    const r = row(truck(), [load()]);
    expect(r.state).toBe('booked');
    expect(r.currentLoad.nextEvent.type).toBe('pickup');
  });
  test('in_transit with a fresh position', () => {
    const r = row(truck(), [transit()]);
    expect(r.state).toBe('in_transit');
    expect(r.currentLoad.nextEvent.type).toBe('delivery');
    expect(r.position).toEqual({ ageMinutes: 5, confirmed: true });
  });
  test('in-transit load is the current one; others count as nextLoads', () => {
    const r = row(truck(), [load({ _id: 'L2', title: 'later' }), transit({ _id: 'L3', title: 'rolling' })]);
    expect(r.currentLoad.title).toBe('rolling');
    expect(r.nextLoads).toBe(1);
  });
  test('earliest pickup is current among accepted loads', () => {
    const r = row(truck(), [load({ _id: 'A', title: 'late', pickupTimeWindow: { end: ahead(900) } }), load({ _id: 'B', title: 'soon', pickupTimeWindow: { end: ahead(100) } })]);
    expect(r.currentLoad.title).toBe('soon');
  });
});

describe('needs_attention reasons', () => {
  test('pickup at risk with estimate beats booked', () => {
    const r = row(truck(), [load({ pickupRisk: { level: 'at_risk', detail: { minutesLateEstimate: 42 } } })]);
    expect(r.state).toBe('needs_attention');
    expect(r.reasons).toEqual(['Pickup at risk: 42 min late by current position']);
  });
  test('late_certain and no_show', () => {
    expect(row(truck(), [load({ pickupRisk: { level: 'late_certain', detail: { minutesLateAtLeast: 20 } } })]).reasons[0]).toMatch(/at least 20 min/);
    expect(row(truck(), [load({ pickupRisk: { level: 'no_show' } })]).reasons[0]).toMatch(/Pickup missed/);
  });
  test('on_track pickup risk is not attention', () => {
    expect(row(truck(), [load({ pickupRisk: { level: 'on_track' } })]).state).toBe('booked');
  });
  test('unanswered check call; answered one is fine', () => {
    const ask = (answeredAt) => ({ checkCallState: { ask: { askedAt: ago(20), answeredAt } } });
    expect(row(truck(), [transit(ask(undefined))]).reasons).toContain('Driver has not answered a check call');
    expect(row(truck(), [transit(ask(ago(10)))]).state).toBe('in_transit');
  });
  test('in transit with no position for 3 h; fresh position is fine; none at all', () => {
    const old = transit({ carrierLocation: { latitude: 41.9, longitude: -87.7, updatedAt: ago(180) } });
    const r = row(truck(), [old]);
    expect(r.state).toBe('needs_attention');
    expect(r.reasons).toContain('No position for 3 h');
    expect(row(truck(), [transit({ carrierLocation: undefined })]).reasons).toContain('No position received');
    expect(row(truck(), [transit()]).state).toBe('in_transit');
  });
  test('predicted delivery delay from current position', () => {
    const r = row(truck(), [transit({ deliveryTimeWindow: { end: ahead(1) } })]);
    expect(r.state).toBe('needs_attention');
    expect(r.reasons[0]).toMatch(/^Running late: about \d+ min past the delivery window/);
  });
  test('expired vs valid driver documents', () => {
    const bad = row(truck(), [], { name: 'Dan', licenseExpiry: ago(60 * 24 * 30), medicalCardExpiry: new Date('2026-10-02') });
    expect(bad.state).toBe('needs_attention');
    expect(bad.reasons).toEqual(expect.arrayContaining(['Medical card expired 2026-10-02', expect.stringMatching(/^License expired /)]));
    expect(row(truck(), [], { name: 'Dan', licenseExpiry: ahead(60 * 24 * 90), medicalCardExpiry: ahead(60 * 24 * 90) }).state).toBe('idle');
    expect(row(truck(), [], { name: 'Dan', status: 'inactive', licenseExpiry: ago(1000) }).state).toBe('idle');
  });
  test('parked out-of-service truck is not flagged for documents; with a booked load it is flagged', () => {
    const d = { name: 'Dan', licenseExpiry: ago(1000) };
    expect(row(truck({ status: 'Maintenance' }), [], d).state).toBe('out_of_service');
    const r = row(truck({ status: 'Maintenance' }), [load()], d);
    expect(r.state).toBe('needs_attention');
    expect(r.reasons[0]).toBe('Truck is marked Maintenance but has a booked load');
  });
  test('attention beats in_transit', () => {
    expect(row(truck(), [transit({ checkCallState: { ask: { askedAt: ago(5) } } })]).state).toBe('needs_attention');
  });
});

describe('driver name + search', () => {
  test('driver name from roster, else truck', () => {
    expect(row(truck({ driverName: 'Truck Dan' }), [], { name: 'Roster Dan' }).driverName).toBe('Roster Dan');
    expect(row(truck({ driverName: 'Truck Dan' })).driverName).toBe('Truck Dan');
  });
  test('matchesSearch is a plain substring match (regex characters are literal)', () => {
    const r = row(truck({ truckId: 'ABC-1', driverName: 'Dan' }), [load()]);
    expect(matchesSearch(r, 'abc')).toBe(true);
    expect(matchesSearch(r, 'milwaukee')).toBe(true);
    expect(matchesSearch(r, 'chi-mke')).toBe(true);
    expect(matchesSearch(r, '.*(')).toBe(false);
    expect(matchesSearch(r, 'zzz')).toBe(false);
  });
});
