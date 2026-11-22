const { evaluatePickupRisk } = require('../../services/pickupRiskService');

const NOW = new Date('2026-06-10T12:00:00Z');
const at = (min) => new Date(NOW.getTime() + min * 60000);
const ORIGIN = { lat: 41.8781, lng: -87.6298 };
// 0.5 degrees of latitude ~ 34.5 straight-line mi -> 43.2 road mi -> 57.6 min at 45 mph, 43.2 min at 60 mph
const loc = (ageMin, dLat = 0.5, authenticated = true) => ({ lat: ORIGIN.lat - dLat, lng: ORIGIN.lng, updatedAt: at(-ageMin), authenticated });

const base = { now: NOW, origin: ORIGIN, pickupStart: at(60), pickupEnd: at(180), lastLocation: null, arrivedAtPickup: false, carrierConfirmation: null };

const cases = [
  ['no pickup start -> not_evaluated', { pickupStart: null }, 'not_evaluated'],
  ['no origin coords -> not_evaluated', { origin: { lat: null, lng: null } }, 'not_evaluated'],
  ['arrived -> on_track', { arrivedAtPickup: true, pickupEnd: at(-600), pickupStart: at(-700) }, 'on_track', 'arrived'],
  ['already in-transit -> on_track', { status: 'in-transit', pickupStart: at(-700), pickupEnd: at(-600) }, 'on_track', 'not_awaiting_pickup'],
  ['pickup 13h away -> on_track, no detail', { pickupStart: at(13 * 60), pickupEnd: at(14 * 60) }, 'on_track', 'outside_watch_window'],
  ['fresh GPS, comfortably early -> on_track', { lastLocation: loc(5) }, 'on_track', 'gps_on_track'],
  ['fresh GPS: remaining 88 min (58 > 57.6 + margin ok) -> on_track', { lastLocation: loc(5), pickupStart: at(60), pickupEnd: at(88) }, 'on_track'],
  ['fresh GPS: remaining 87 min, just over margin -> at_risk', { lastLocation: loc(5), pickupStart: at(60), pickupEnd: at(87) }, 'at_risk', 'drive_time_exceeds_time_remaining'],
  ['fresh GPS: remaining 44 min (fast 43.2 fits) -> at_risk not late_certain', { lastLocation: loc(5), pickupStart: at(30), pickupEnd: at(44) }, 'at_risk'],
  ['fresh GPS: remaining 40 min, cannot at 60 mph -> late_certain', { lastLocation: loc(5), pickupStart: at(30), pickupEnd: at(40) }, 'late_certain', 'cannot_arrive_in_time'],
  ['stale GPS (3h) with pickup in 1h -> at_risk no_gps', { lastLocation: loc(180) }, 'at_risk', 'no_gps'],
  ['stale GPS (3h) with pickup 5h away -> on_track', { lastLocation: loc(180), pickupStart: at(300), pickupEnd: at(420) }, 'on_track'],
  ['GPS 1h old (neither fresh nor stale), pickup in 1h -> on_track', { lastLocation: loc(60) }, 'on_track', 'location_not_current'],
  ['no GPS, pickup in 1h -> at_risk no_gps', {}, 'at_risk', 'no_gps'],
  ['no GPS, pickup in 2h exactly -> at_risk', { pickupStart: at(120), pickupEnd: at(240) }, 'at_risk', 'no_gps'],
  ['no GPS, pickup in 3h -> on_track (too early to worry)', { pickupStart: at(180), pickupEnd: at(300) }, 'on_track'],
  ['no GPS + on_my_way -> suppressed', { carrierConfirmation: 'on_my_way' }, 'on_track'],
  ['fresh GPS late + on_my_way -> still late_certain', { lastLocation: loc(5), pickupStart: at(30), pickupEnd: at(40), carrierConfirmation: 'on_my_way' }, 'late_certain'],
  ['fresh token-ingested (unauthenticated) GPS that cannot arrive -> at_risk, never late_certain', { lastLocation: loc(5, 0.5, false), pickupStart: at(30), pickupEnd: at(40) }, 'at_risk', 'drive_time_exceeds_time_remaining'],
  ['legacy fix with no authenticated flag -> at_risk, never late_certain', { lastLocation: { ...loc(5), authenticated: undefined }, pickupStart: at(30), pickupEnd: at(40) }, 'at_risk'],
  ['unauthenticated far-away fix past the window is still no_show (no GPS needed)', { lastLocation: loc(5, 0.5, false), pickupStart: at(-151), pickupEnd: at(-31) }, 'no_show'],
  ['no_show just before grace (30 min after latest) -> not no_show', { pickupStart: at(-150), pickupEnd: at(-30) }, 'at_risk', 'no_gps'],
  ['no_show 31 min after latest -> no_show', { pickupStart: at(-151), pickupEnd: at(-31) }, 'no_show', 'no_arrival_after_window'],
  ['no_show needs no GPS and ignores on_my_way', { pickupStart: at(-151), pickupEnd: at(-31), carrierConfirmation: 'on_my_way', lastLocation: loc(5) }, 'no_show'],
  ['no pickupEnd: latest = start + 2h (stated), fine when early', { lastLocation: loc(5), pickupEnd: null }, 'on_track'],
  ['no pickupEnd: no_show only 30 min after start + 2h', { pickupStart: at(-151), pickupEnd: null }, 'no_show'],
  ['no pickupEnd: start+2h not yet passed beyond grace', { pickupStart: at(-149), pickupEnd: null }, 'at_risk'],
  ['cannot_make_it forces at_risk, pickup 10h away', { carrierConfirmation: 'cannot_make_it', pickupStart: at(600), pickupEnd: at(700) }, 'at_risk', 'carrier_declined'],
  ['cannot_make_it forces at_risk, pickup 20h away', { carrierConfirmation: 'cannot_make_it', pickupStart: at(1200), pickupEnd: at(1300) }, 'at_risk', 'carrier_declined'],
  ['cannot_make_it with fresh early GPS still at_risk', { carrierConfirmation: 'cannot_make_it', lastLocation: loc(5) }, 'at_risk', 'carrier_declined'],
  ['within 1 mile of pickup, window just passed -> on_track (check-in imminent)', { lastLocation: loc(2, 0.001), pickupStart: at(-60), pickupEnd: at(-5) }, 'on_track', 'near_pickup'],
];

describe('evaluatePickupRisk', () => {
  test.each(cases)('%s', (...args) => {
    const [, over, level, reason] = args;
    const r = evaluatePickupRisk({ ...base, ...over });
    expect(r.level).toBe(level);
    if (reason) expect(r.reason).toBe(reason);
  });

  test('detail carries the numbers and honest basis', () => {
    const r = evaluatePickupRisk({ ...base, lastLocation: loc(5), pickupStart: at(30), pickupEnd: at(40) });
    expect(r.detail.distanceBasis).toMatch(/estimated from straight-line/);
    expect(r.detail).toMatchObject({ assumedMph: 45, fastestMph: 60, minutesRemaining: 40, marginMinutes: 30 });
    expect(r.detail.distanceMilesStraight).toBeCloseTo(34.5, 0);
    expect(r.detail.minutesLateAtLeast).toBeGreaterThan(0);
    expect(JSON.stringify(r.detail)).not.toMatch(/latitude|longitude|"lat"|"lng"/i);
  });

  test('missing window end is stated in the detail', () => {
    const r = evaluatePickupRisk({ ...base, lastLocation: loc(5), pickupEnd: null });
    expect(r.detail.latestArrivalBasis).toMatch(/no window end/);
    expect(r.detail.minutesRemaining).toBe(180);
  });

  test('outside the watch window has no detail', () => {
    expect(evaluatePickupRisk({ ...base, pickupStart: at(13 * 60), pickupEnd: at(14 * 60) }).detail).toBeNull();
  });
});
