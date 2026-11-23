/**
 * Unit: checkCallService -- pure evaluator for automatic check calls.
 * Geometry: one meridian; 1 degree of latitude = ~69.1 miles straight. Origin lat 35, destination lat 38 (~207 mi).
 */
const { evaluateCheckCall, CONSTANTS } = require('../../services/checkCallService');

const NOW = new Date('2026-03-10T12:00:00Z');
const MIN = 60000;
const H = 60 * MIN;
const ago = (min) => new Date(NOW.getTime() - min * MIN);
const BOOKED = ago(600);
const fix = (lat, ageMin, over = {}) => ({ latitude: lat, longitude: -90, updatedAt: ago(ageMin), speed: 0, ...over });
// A carrierLocation as trackingService writes an authenticated ping.
const authLoc = (lat, ageMin) => { const f = fix(lat, ageMin); return { ...f, authenticated: true, source: 'mobile_app', lastAuthenticated: f }; };
// A bearer-link-token (unauthenticated) ping: carrierLocation only.
const linkLoc = (lat, ageMin) => ({ ...fix(lat, ageMin), authenticated: false, source: 'owntracks' });

const load = (over = {}) => ({
  status: 'in-transit', acceptedBy: 'C1', bookedAt: BOOKED, destination: 'Dallas, TX',
  originLat: 35, originLng: -90, destinationLat: 38, destinationLng: -90,
  bookedWindow: { start: ago(240), end: ago(180) }, carrierLocation: authLoc(36, 5), checkCallState: {}, ...over,
});
const dwell = (over) => ({ carrier: 'C1', bookedAt: BOOKED, closedReason: null, ...over });
const typeOf = (r) => (r ? r.type : null);
const ev = (l, dw = []) => evaluateCheckCall({ load: l, now: NOW, dwellEvents: dw });
// Apply a result's idempotency state the way the job does.
const applied = (l, r) => ({
  ...l,
  checkCallState: {
    ...l.checkCallState,
    milestones: [...(l.checkCallState.milestones || []), ...r.state.addMilestones],
    ...(r.state.touchPeriodic ? { lastPeriodicAt: NOW } : {}),
    ...(r.state.ask === 'new' ? { ask: { askedAt: NOW } } : {}),
    ...(r.state.ask === 'noResponse' ? { ask: { ...l.checkCallState.ask, noResponseSentAt: NOW } } : {}),
  },
});

describe('checkCallService.evaluateCheckCall', () => {
  test('open / delivered / unbooked loads produce nothing', () => {
    expect(ev(load({ status: 'open' }))).toBeNull();
    expect(ev(load({ status: 'delivered' }))).toBeNull();
    expect(ev(load({ acceptedBy: null }))).toBeNull();
    expect(evaluateCheckCall({ load: load(), now: 'garbage' })).toBeNull();
    expect(evaluateCheckCall({})).toBeNull();
  });

  describe('milestones', () => {
    test('en_route_to_pickup: first fresh authenticated fix after booking, once', () => {
      const l = load({ status: 'accepted', bookedWindow: { start: ago(-60), end: ago(-180) }, carrierLocation: authLoc(34.9, 5) });
      const r = ev(l);
      expect(r.type).toBe('en_route_to_pickup');
      expect(r.positionConfirmed).toBe(true);
      expect(r.etaAt).toBeNull();
      expect(r.distanceRemainingMiles).toBe(7);
      expect(ev(applied(l, r))).toBeNull();
    });

    test('en_route_to_pickup is not claimed from a fix older than the booking, nor from an unauthenticated one', () => {
      const stale = load({ status: 'accepted', bookedAt: ago(1), bookedWindow: { start: ago(-600) }, carrierLocation: authLoc(34.9, 5) });
      expect(ev(stale)).toBeNull();
      expect(typeOf(ev(load({ status: 'accepted', bookedWindow: { start: ago(-600) }, carrierLocation: linkLoc(34.9, 5) })))).toBe('ask_driver'); // unconfirmed: never en_route
    });

    test('en_route_to_pickup from the driver confirming on-my-way is driver-reported, not confirmed', () => {
      const l = load({ status: 'accepted', bookedWindow: { start: ago(-600) }, carrierLocation: undefined, pickupRisk: { carrierConfirmation: { status: 'on_my_way', at: ago(3) } } });
      const r = ev(l);
      expect(r.type).toBe('en_route_to_pickup');
      expect(r.positionConfirmed).toBe(false);
      expect(r.message).toMatch(/driver reports/i);
      expect(r.etaAt).toBeNull();
    });

    test('at_pickup / departed_pickup / at_delivery come from this booking\'s geofence events, once each', () => {
      const l = load({ status: 'accepted', bookedWindow: { start: ago(-600) }, carrierLocation: undefined });
      const arrived = dwell({ stopType: 'pickup', arrivedAt: ago(10), arrivalAuthenticated: true });
      const r = ev(l, [arrived]);
      expect(r.type).toBe('at_pickup');
      expect(r.positionConfirmed).toBe(true);
      expect(ev(applied(l, r), [arrived])).toBeNull();

      const t = load({ carrierLocation: undefined });
      const left = dwell({ stopType: 'pickup', arrivedAt: ago(100), departedAt: ago(5), arrivalAuthenticated: true, departureAuthenticated: true });
      const d = ev(t, [left]);
      expect(d.type).toBe('departed_pickup');
      expect(d.state.addMilestones).toEqual(expect.arrayContaining(['departed_pickup', 'at_pickup', 'en_route_to_pickup']));
      expect(typeOf(ev(applied(t, d), [left]))).not.toBe('departed_pickup');

      const at = dwell({ stopType: 'delivery', arrivedAt: ago(2), arrivalAuthenticated: true });
      const a = ev(t, [left, at]);
      expect(a.type).toBe('at_delivery');
      expect(typeOf(ev(applied(t, a), [left, at]))).not.toBe('at_delivery');
    });

    test('a manual or link-token check-in is reported but NOT as confirmed; other bookings/carriers\' events are ignored', () => {
      const l = load({ status: 'accepted', bookedWindow: { start: ago(-600) }, carrierLocation: undefined });
      const manual = ev(l, [dwell({ stopType: 'pickup', arrivedAt: ago(10), arrivalAuthenticated: true, arrivalManualBy: 'U1' })]);
      expect(manual.type).toBe('at_pickup');
      expect(manual.positionConfirmed).toBe(false);
      expect(typeOf(ev(l, [dwell({ stopType: 'pickup', arrivedAt: ago(10), arrivalAuthenticated: true, bookedAt: ago(9000) })]))).not.toBe('at_pickup');
      expect(typeOf(ev(l, [dwell({ stopType: 'pickup', arrivedAt: ago(10), arrivalAuthenticated: true, carrier: 'OTHER' })]))).not.toBe('at_pickup');
      expect(typeOf(ev(l, [dwell({ stopType: 'pickup', arrivedAt: ago(10), arrivalAuthenticated: true, closedReason: 'cancelled' })]))).not.toBe('at_pickup');
    });

    test('halfway fires only from a fresh authenticated fix, once, with an ETA', () => {
      const l = load({ carrierLocation: authLoc(36.6, 5) }); // ~97 mi left of ~207
      const r = ev(l);
      expect(r.type).toBe('halfway');
      expect(r.positionConfirmed).toBe(true);
      expect(r.etaAt).toBeInstanceOf(Date);
      expect(r.distanceRemainingMiles).toBeLessThanOrEqual(104);
      expect(ev(applied(l, r))).toBeNull();
      // same position but old or unauthenticated: never halfway
      expect(ev(load({ carrierLocation: authLoc(36.6, 45) }))).toBeNull(); // 45 min: not fresh, not yet stale
      expect(typeOf(ev(load({ carrierLocation: linkLoc(36.6, 5) })))).toBe('ask_driver'); // never halfway
    });

    test('one_hour_out fires only from a fresh authenticated fix, once, and supersedes halfway', () => {
      const l = load({ carrierLocation: authLoc(37.5, 5) }); // ~35 mi at 50 mph = ~41 min
      const r = ev(l);
      expect(r.type).toBe('one_hour_out');
      expect(r.etaAt.getTime() - NOW.getTime()).toBeLessThanOrEqual(60 * MIN);
      expect(ev(applied(l, r))).toBeNull();
      expect(typeOf(ev(load({ carrierLocation: linkLoc(37.5, 5) })))).toBe('ask_driver'); // never one_hour_out
    });

    test('halfway is not reported for multi-stop loads (distance to the final stop says nothing about the route)', () => {
      expect(ev(load({ carrierLocation: authLoc(36.6, 5), stops: [{ type: 'pickup' }, { type: 'delivery' }] })).type).toBe('position_update');
    });
  });

  describe('periodic position_update', () => {
    test('fires with a fresh authenticated position, then not again until 4 hours later', () => {
      const l = load({ carrierLocation: authLoc(36, 5) }); // 2 deg out: no milestone
      const r = ev(l);
      expect(r.type).toBe('position_update');
      expect(r.positionConfirmed).toBe(true);
      expect(r.message).toMatch(/miles from Dallas, TX/);
      const next = applied(l, r);
      expect(ev(next)).toBeNull();
      expect(ev({ ...next, checkCallState: { ...next.checkCallState, lastPeriodicAt: ago(CONSTANTS.PERIODIC_MS / MIN - 1) } })).toBeNull();
      expect(ev({ ...next, checkCallState: { ...next.checkCallState, lastPeriodicAt: ago(CONSTANTS.PERIODIC_MS / MIN + 1) } }).type).toBe('position_update');
    });

    test('never for accepted loads, and never from an unconfirmed fix', () => {
      expect(ev(load({ status: 'accepted', bookedWindow: { start: ago(-9000) }, carrierLocation: authLoc(36, 5), checkCallState: { milestones: ['en_route_to_pickup'] } }))).toBeNull();
      expect(ev(load({ carrierLocation: linkLoc(36, 5), checkCallState: { lastPeriodicAt: ago(500) } })).type).not.toBe('position_update');
    });
  });

  describe('unknown position', () => {
    test('stale position: ask_driver once per 4h window, no ETA, plain age', () => {
      const l = load({ carrierLocation: authLoc(36, 200) });
      const r = ev(l);
      expect(r.type).toBe('ask_driver');
      expect(r.etaAt).toBeNull();
      expect(r.positionConfirmed).toBe(false);
      expect(r.positionAgeMinutes).toBe(200);
      expect(r.driverPrompt).toBeTruthy();
      expect(r.message).toMatch(/3\.3 h/);
      const asked = applied(l, r);
      expect(ev(asked)).toBeNull();
      const later = { ...asked, checkCallState: { ask: { askedAt: ago(CONSTANTS.ASK_WINDOW_MS / MIN + 1), answeredAt: ago(CONSTANTS.ASK_WINDOW_MS / MIN) } } };
      expect(ev(later).type).toBe('ask_driver');
    });

    test('no position at all: ask, and never invent an ETA', () => {
      const r = ev(load({ carrierLocation: undefined }));
      expect(r.type).toBe('ask_driver');
      expect(r.etaAt).toBeNull();
      expect(r.distanceRemainingMiles).toBeNull();
      expect(r.positionAgeMinutes).toBeNull();
      expect(r.message).toMatch(/No position has been received/);
    });

    test('unanswered for 30 minutes becomes no_response, once; answered asks stay quiet', () => {
      const askedAt = (min) => ({ ask: { askedAt: ago(min) } });
      const l = (state) => load({ carrierLocation: authLoc(36, 200 + 30), checkCallState: state });
      expect(ev(l(askedAt(29)))).toBeNull();
      const r = ev(l(askedAt(31)));
      expect(r.type).toBe('no_response');
      expect(r.message).toMatch(/No position update for 3\.8 h and the driver has not responded yet/);
      expect(r.etaAt).toBeNull();
      expect(ev(l({ ask: { askedAt: ago(31), noResponseSentAt: ago(1) } }))).toBeNull();
      expect(ev(l({ ask: { askedAt: ago(31), answeredAt: ago(20) } }))).toBeNull();
    });

    test('a fresh confirmed position cancels the pending no_response', () => {
      const r = ev(load({ carrierLocation: authLoc(36, 5), checkCallState: { lastPeriodicAt: ago(1), ask: { askedAt: ago(40) } } }));
      expect(r).toBeNull();
    });

    test('an unauthenticated position is reported as unconfirmed and does not suppress the ask', () => {
      const l = load({ carrierLocation: { ...linkLoc(36, 5), lastAuthenticated: fix(35.5, 300) } });
      const r = ev(l);
      expect(r.type).toBe('ask_driver');
      expect(r.positionConfirmed).toBe(false);
      expect(r.positionAgeMinutes).toBe(5);
      expect(r.etaAt).toBeNull();
      expect(r.message).toMatch(/unconfirmed/);
      const only = ev(load({ carrierLocation: linkLoc(36, 5) }));
      expect(only.type).toBe('ask_driver');
      expect(only.message).toMatch(/unconfirmed/);
    });

    test('between fresh and stale (30 min to 2 h) nothing is claimed and nobody is bothered', () => {
      expect(ev(load({ carrierLocation: authLoc(36, 90) }))).toBeNull();
    });

    test('accepted loads are asked only inside the pickup watch window and not once on site', () => {
      const accepted = (over) => load({ status: 'accepted', carrierLocation: undefined, checkCallState: { milestones: ['en_route_to_pickup'] }, ...over });
      expect(ev(accepted({ bookedWindow: { start: ago(-60), end: ago(-120) } })).type).toBe('ask_driver');
      expect(ev(accepted({ bookedWindow: { start: ago(-13 * 60) } }))).toBeNull(); // pickup > 12 h away
      expect(ev(accepted({ bookedWindow: { start: ago(25 * 60) } }))).toBeNull();   // > 24 h overdue: not our job
      const onSite = dwell({ stopType: 'pickup', arrivedAt: ago(20), arrivalAuthenticated: true });
      expect(ev(accepted({ bookedWindow: { start: ago(-60) }, checkCallState: { milestones: ['at_pickup', 'en_route_to_pickup'] } }), [onSite])).toBeNull();
    });
  });
});
