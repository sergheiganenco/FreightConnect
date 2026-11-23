/**
 * Security hardening: counterparty allowlist on load/list responses, un-booking lifecycle (dwell events),
 * cancelled/stale dwell billing, unverified-detention hold + admin confirmation, conditional window writes with
 * null bounds, and window validation on the other load-creating routes.
 */
require('../setup');
jest.mock('node-fetch'); // load posting geocodes typed places through node-fetch
const express = require('express');
const request = require('supertest');

const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const Load = require('../../models/Load');
const DwellEvent = require('../../models/DwellEvent');
const Capacity = require('../../models/Capacity');
const PreferredCarrier = require('../../models/PreferredCarrier');
const Partnership = require('../../models/Partnership');
const EDIDocument = require('../../models/EDIDocument');
const { transitionLoadStatus } = require('../../services/loadStateMachine');
const { atomicAcceptLoad } = require('../../services/atomicOperations');
const { syncDetentionCharge } = require('../../services/detentionBillingService');
const { recalculateDwellEvent } = require('../../services/detentionService');
const { settleAccessorialCharge } = require('../../routes/paymentRoutes');

const io = { to: () => ({ emit: () => {} }), emit: () => {} };
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loads', require('../../routes/loadRoutes')(io));
  app.use('/api/detention', require('../../routes/detentionRoutes'));
  app.use('/api/capacity', require('../../routes/capacityRoutes'));
  app.use('/api/preferred-carriers', require('../../routes/preferredCarrierRoutes'));
  app.use('/api/partnerships', require('../../routes/partnershipRoutes'));
  app.use('/api/edi', require('../../routes/ediRoutes'));
  app.use('/api/enterprise', require('../../routes/enterpriseRoutes'));
  return app;
}
const bearer = (u) => ({ Authorization: `Bearer ${generateToken(u)}` });
const MIN = 60000;
const at = (min) => new Date(Date.now() + min * MIN);

// ── allowlist helper: FAILS on any key not explicitly allowed (deep) ──────────────────────────────
const PARTY = {
  _id: true, id: true, name: true, companyName: true, role: true,
  trustScore: { score: true, onTimeRate: true, cancellationRate: true, totalLoadsCompleted: true, lastCalculated: true },
  verification: { status: true, fmcsaData: { legalName: true, dotNumber: true, mcNumber: true } },
};
function unexpectedKeys(obj, allowed, path = '') {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return [];
  if (typeof obj.toHexString === 'function') return [];
  const bad = [];
  for (const [k, v] of Object.entries(obj)) {
    const rule = allowed[k];
    if (!rule) bad.push(path + k);
    else if (typeof rule === 'object') bad.push(...unexpectedKeys(v, rule, `${path}${k}.`));
  }
  return bad;
}
const expectOnlyPartyKeys = (obj, extra = {}) => expect(unexpectedKeys(JSON.parse(JSON.stringify(obj)), { ...PARTY, ...extra })).toEqual([]);

// A user stuffed with everything that must never reach a counterparty.
const richUser = (o) => createTestUser({
  phone: '555-0100',
  fleet: [{ truckId: 'T1', status: 'Available' }],
  drivers: [{ driverId: 'D1', name: 'Secret Driver', phone: '555-0199', licenseNumber: 'LIC123' }],
  stripe: { customerId: 'cus_secret', connectAccountId: 'acct_secret' },
  pushTokens: ['ExponentPushToken[secret]'],
  preferences: { minRate: 1234, equipmentTypes: ['Dry Van'] },
  shipperVerification: { status: 'verified', einMasked: '**-***1234' },
  tracking: { gpsConsent: { granted: true } },
  tosIpAddress: '10.9.8.7',
  trustScore: { score: 77, onTimeRate: 95, totalLoadsCompleted: 12, history: [{ score: 77, reason: 'x', change: 1 }] },
  verification: { status: 'verified', mcNumber: 'typed-mc', dotNumber: 'typed-dot', fmcsaData: { legalName: 'Legal Co', dotNumber: '111', mcNumber: '222', operatingStatus: 'ACTIVE', safetyRating: 'S' }, insurance: { status: 'valid' } },
  ...o,
});

describe('counterparty allowlist on load responses', () => {
  let shipper, carrier;
  beforeEach(async () => {
    shipper = await richUser({ role: 'shipper', companyName: 'Ship Co' });
    carrier = await richUser({ role: 'carrier', companyName: 'Carry Co' });
  });

  test('transitionLoadStatus and atomicAcceptLoad echo only allowlisted party keys (both sides)', async () => {
    const open = await createTestLoad(shipper._id);
    const acc = await atomicAcceptLoad(open._id, carrier._id);
    expect(acc.success).toBe(true);
    for (const side of [acc.load.postedBy, acc.load.acceptedBy]) expectOnlyPartyKeys(side);
    expect(acc.load.acceptedBy.companyName).toBe('Carry Co');
    expect(acc.load.postedBy.trustScore.score).toBe(77);

    const t = await transitionLoadStatus(open._id, 'accepted', 'in-transit');
    expect(t.success).toBe(true);
    for (const side of [t.load.postedBy, t.load.acceptedBy]) expectOnlyPartyKeys(side);
    expect(JSON.stringify(t.load)).not.toMatch(/Secret Driver|cus_secret|ExponentPushToken|10\.9\.8\.7|555-0|@example\.com/);
  });

  test('PUT /status (carrier) response carries only allowlisted party keys', async () => {
    const app = buildApp();
    const load = await createTestLoad(shipper._id);
    await Load.findOneAndUpdate({ _id: load._id, status: 'open' }, { $set: { status: 'accepted', acceptedBy: carrier._id } });
    const res = await request(app).put(`/api/loads/${load._id}/status`).set(bearer(carrier)).send({ status: 'in-transit' });
    expect(res.status).toBe(200);
    expectOnlyPartyKeys(res.body.load.postedBy);
    expectOnlyPartyKeys(res.body.load.acceptedBy);
  });

  test('capacity board, capacity detail, preferred carriers and directory expose only allowlisted carrier keys', async () => {
    const app = buildApp();
    const post = await Capacity.create({ carrierId: carrier._id, equipmentType: 'Dry Van', availableFrom: at(60), availableTo: at(600), originCity: 'A', originState: 'IL', bookedBy: shipper._id });
    const board = await request(app).get('/api/capacity').set(bearer(shipper)).expect(200);
    expectOnlyPartyKeys(board.body.posts[0].carrierId);
    const one = await request(app).get(`/api/capacity/${post._id}`).set(bearer(shipper)).expect(200);
    expectOnlyPartyKeys(one.body.carrierId);
    expect(unexpectedKeys(one.body.bookedBy, { _id: true, name: true, companyName: true })).toEqual([]);

    await PreferredCarrier.create({ shipper: shipper._id, carrier: carrier._id });
    const pref = await request(app).get('/api/preferred-carriers').set(bearer(shipper)).expect(200);
    expectOnlyPartyKeys(pref.body[0].carrier);

    const other = await richUser({ role: 'carrier' });
    const dir = await request(app).get('/api/partnerships/directory').set(bearer(other)).expect(200);
    const list = dir.body.carriers || dir.body.data || [];
    expect(list.length).toBeGreaterThan(0);
    for (const c of list) {
      expect(unexpectedKeys(JSON.parse(JSON.stringify(c)), { ...PARTY, createdAt: true, partnership: true, partnershipStatus: true, partnershipId: true, preferences: { equipmentTypes: true, preferredRegions: true, homeBase: true } })).toEqual([]);
    }

    await Partnership.create({ requestedBy: carrier._id, requestedTo: other._id, status: 'pending' });
    const mine = await request(app).get('/api/partnerships').set(bearer(other)).expect(200);
    expectOnlyPartyKeys(mine.body[0].requestedBy);
    expectOnlyPartyKeys(mine.body[0].requestedTo);
  });
});

// ── un-booking paths ──────────────────────────────────────────────────────────────────────────────
describe('every un-booking path closes open dwell events and resets booking state', () => {
  const bookedWithEvent = async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await createTestUser({ role: 'carrier' });
    const load = await createTestLoad(shipper._id, { pickupTimeWindow: { start: at(60), end: at(180) } });
    await Load.findOneAndUpdate({ _id: load._id, status: 'open' }, { $set: { status: 'accepted', acceptedBy: carrier._id } });
    const booked = await Load.findById(load._id).select('+pickupVerification.code +trackingNonce');
    expect(booked.pickupVerification.code).toBeTruthy();
    expect(booked.trackingNonce).toBeTruthy();
    expect(booked.bookedWindow.start).toBeTruthy();
    await Load.updateOne({ _id: load._id }, { $set: { pickupRisk: { level: 'at_risk' } } });
    const ev = await DwellEvent.create({ load: load._id, carrier: carrier._id, shipper: shipper._id, bookedAt: booked.bookedAt, stopType: 'pickup', arrivedAt: at(-30) });
    return { load, ev, carrier };
  };
  const expectReset = async ({ load, ev }) => {
    const fresh = await Load.findById(load._id).select('+pickupVerification.code +trackingNonce');
    expect(fresh.acceptedBy == null).toBe(true);
    expect(fresh.pickupVerification && fresh.pickupVerification.code).toBeFalsy();
    expect(fresh.trackingNonce).toBeFalsy();
    expect(fresh.bookedWindow && fresh.bookedWindow.start).toBeFalsy();
    expect(fresh.pickupRisk && fresh.pickupRisk.level).toBeFalsy();
    const e = await DwellEvent.findById(ev._id);
    expect(e.closedReason).toBe('cancelled');
    expect(e.departedAt).toBeTruthy();
    expect(e.detentionFeeCents).toBe(0);
  };
  const paths = {
    'findOneAndUpdate $set status open + acceptedBy null (bid revert / escrow expiry / reopen)': (l) => Load.findOneAndUpdate({ _id: l._id }, { $set: { status: 'open', acceptedBy: null } }),
    'findOneAndUpdate $unset acceptedBy': (l) => Load.findOneAndUpdate({ _id: l._id }, { $unset: { acceptedBy: 1 } }),
    'updateOne $set acceptedBy null': (l) => Load.updateOne({ _id: l._id }, { $set: { acceptedBy: null } }),
    'updateOne $unset acceptedBy': (l) => Load.updateOne({ _id: l._id }, { $unset: { acceptedBy: '' } }),
    'findByIdAndUpdate status cancelled': (l) => Load.findByIdAndUpdate(l._id, { $set: { status: 'cancelled' } }),
    'transitionLoadStatus accepted -> cancelled': (l) => transitionLoadStatus(l._id, 'accepted', 'cancelled'),
    'save() with acceptedBy = null (fleet unassign)': async (l) => { const d = await Load.findById(l._id); d.acceptedBy = null; await d.save(); },
  };
  for (const [name, run] of Object.entries(paths)) {
    test(name, async () => {
      const ctx = await bookedWithEvent();
      await run(ctx.load);
      if (name.startsWith('findByIdAndUpdate status cancelled') || name.startsWith('transition')) {
        // status-only paths keep acceptedBy; the booking is over all the same
        const fresh = await Load.findById(ctx.load._id).select('+pickupVerification.code +trackingNonce');
        expect(fresh.pickupVerification.code).toBeFalsy();
        expect(fresh.trackingNonce).toBeFalsy();
        const e = await DwellEvent.findById(ctx.ev._id);
        expect(e.closedReason).toBe('cancelled');
        return;
      }
      await expectReset(ctx);
    });
  }
});

// ── cancelled / stale dwell events are never billed ──────────────────────────────────────────────
describe('dwell billing sinks', () => {
  let shipper, carrier, load;
  const dwell = (o = {}) => DwellEvent.create({
    load: load._id, carrier: carrier._id, shipper: shipper._id, stopType: 'delivery', facilityName: 'DC',
    arrivedAt: new Date('2026-06-01T08:00:00Z'), departedAt: new Date('2026-06-01T12:00:00Z'), dwellMinutes: 240,
    arrivalAuthenticated: true, departureAuthenticated: true, ...o,
  });
  beforeEach(async () => {
    shipper = await createTestUser({ role: 'shipper' });
    carrier = await createTestUser({ role: 'carrier' });
    load = await createTestLoad(shipper._id, { status: 'delivered', acceptedBy: carrier._id });
  });

  test('a cancelled event is not recalculated and not billed', async () => {
    const ev = await dwell({ closedReason: 'cancelled', dwellMinutes: 0 });
    const r = await recalculateDwellEvent(ev._id);
    expect(r.dwellMinutes).toBe(0);
    expect(r.detentionFeeCents).toBe(0);
    expect((await syncDetentionCharge(ev)).action).toBe('none');
    expect((await Load.findById(load._id)).accessorialCharges).toHaveLength(0);
  });

  test('an event from an earlier booking or another carrier is not billed; a legacy (null/null) one is', async () => {
    const stale = await dwell({ bookedAt: new Date('2026-05-01T00:00:00Z') });
    expect((await syncDetentionCharge(stale)).action).toBe('none');
    const other = await createTestUser({ role: 'carrier' });
    const foreign = await dwell({ carrier: other._id, stopType: 'pickup' });
    expect((await syncDetentionCharge(foreign)).action).toBe('none');
    expect((await Load.findById(load._id)).accessorialCharges).toHaveLength(0);
    const legacy = await dwell({ stopType: 'delivery', stopIndex: 3 });
    expect((await syncDetentionCharge(legacy)).action).toBe('created');
    // and with a matching bookedAt on both sides
    const when = new Date('2026-06-01T07:00:00Z');
    await Load.updateOne({ _id: load._id }, { $set: { bookedAt: when } });
    const fresh = await dwell({ bookedAt: when, stopType: 'pickup', stopIndex: 4 });
    expect((await syncDetentionCharge(fresh)).action).toBe('created');
  });

  test('manual routes answer 409 for a cancelled or already departed event', async () => {
    const app = buildApp();
    const cancelled = await dwell({ closedReason: 'cancelled' });
    const departed = await dwell({ stopType: 'pickup' });
    for (const path of ['dock-in', 'dock-out', 'depart']) {
      expect((await request(app).patch(`/api/detention/${path}/${cancelled._id}`).set(bearer(carrier)).send({})).status).toBe(409);
    }
    for (const path of ['dock-in', 'dock-out', 'depart']) {
      expect((await request(app).patch(`/api/detention/${path}/${departed._id}`).set(bearer(carrier)).send({})).status).toBe(409);
    }
  });

  test('approving / settling a charge whose dwell event was cancelled afterwards is refused', async () => {
    const app = buildApp();
    const ev = await dwell();
    const { charge } = await syncDetentionCharge(ev);
    await DwellEvent.updateOne({ _id: ev._id }, { $set: { closedReason: 'cancelled' } });
    const res = await request(app).put(`/api/loads/${load._id}/accessorials/${charge._id}/approve`).set(bearer(shipper)).send({ evidenceHashShown: charge.evidenceHash });
    expect(res.status).toBe(409);
    await Load.updateOne({ _id: load._id, 'accessorialCharges._id': charge._id }, { $set: { 'accessorialCharges.$.status': 'approved' } });
    const s = await settleAccessorialCharge(load._id, charge._id);
    expect(s.ok).toBe(false);
    expect((await Load.findById(load._id)).accessorialCharges[0].status).toBe('approved');
  });
});

// ── unverified detention must not pay out ────────────────────────────────────────────────────────
describe('unverified detention is held for admin confirmation', () => {
  let app, shipper, carrier, admin, load;
  const mk = async (auth) => {
    const ev = await DwellEvent.create({
      load: load._id, carrier: carrier._id, shipper: shipper._id, stopType: 'delivery', facilityName: 'DC',
      arrivedAt: new Date('2026-06-01T08:00:00Z'), departedAt: new Date('2026-06-01T12:00:00Z'), dwellMinutes: 240,
      arrivalAuthenticated: auth.arr, departureAuthenticated: auth.dep,
    });
    const { charge } = await syncDetentionCharge(ev);
    return { ev, charge };
  };
  const approve = (c) => request(app).put(`/api/loads/${load._id}/accessorials/${c._id}/approve`).set(bearer(shipper)).send({ evidenceHashShown: c.evidenceHash });
  const chargeOf = async (id) => (await Load.findById(load._id)).accessorialCharges.id(id);
  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    carrier = await createTestUser({ role: 'carrier' });
    admin = await createTestUser({ role: 'admin' });
    load = await createTestLoad(shipper._id, { status: 'delivered', acceptedBy: carrier._id });
  });

  test('verified charge: approval settles as before', async () => {
    const { charge } = await mk({ arr: true, dep: true });
    expect(charge.locationVerified).toBe(true);
    const res = await approve(charge);
    expect(res.status).toBe(200);
    expect(res.body.awaitingReview).toBeUndefined();
    expect((await chargeOf(charge._id)).status).toBe('paid');
  });

  test('unverified charge: approval is recorded but nothing is settled until an admin confirms', async () => {
    const { charge } = await mk({ arr: true, dep: false });
    expect(charge.locationVerified).toBe(false);
    const res = await approve(charge);
    expect(res.status).toBe(200);
    expect(res.body.awaitingReview).toBe(true);
    expect(res.body.message).toMatch(/manual review.*location was not verified/i);
    let c = await chargeOf(charge._id);
    expect(c.status).toBe('approved');
    expect(c.paidAt).toBeNull();

    // the settle function itself refuses, whoever calls it
    const direct = await settleAccessorialCharge(load._id, charge._id);
    expect(direct.ok).toBe(false);
    expect((await chargeOf(charge._id)).status).toBe('approved');

    // only an admin can confirm
    expect((await request(app).put(`/api/loads/${load._id}/accessorials/${charge._id}/confirm-unverified`).set(bearer(shipper))).status).toBe(403);
    expect((await request(app).put(`/api/loads/${load._id}/accessorials/${charge._id}/confirm-unverified`).set(bearer(carrier))).status).toBe(403);
    const ok = await request(app).put(`/api/loads/${load._id}/accessorials/${charge._id}/confirm-unverified`).set(bearer(admin));
    expect(ok.status).toBe(200);
    c = await chargeOf(charge._id);
    expect(c.status).toBe('paid');
    expect(c.adminConfirmedAt).toBeTruthy();
    // a verified / already-confirmed charge cannot be "confirmed" again
    expect((await request(app).put(`/api/loads/${load._id}/accessorials/${charge._id}/confirm-unverified`).set(bearer(admin))).status).toBe(409);
  });

  test('a legacy charge with a null flag is not collected or settled', async () => {
    const { charge } = await mk({ arr: true, dep: true });
    await Load.updateOne({ _id: load._id, 'accessorialCharges._id': charge._id }, { $set: { 'accessorialCharges.$.locationVerified': null, 'accessorialCharges.$.status': 'approved' } });
    const s = await settleAccessorialCharge(load._id, charge._id);
    expect(s.ok).toBe(false);
    expect(s.held).toBe(true);
    expect((await chargeOf(charge._id)).status).toBe('approved');
    const collect = await require('../../services/escrowService').collectAccessorialFromShipper(load._id, charge._id, { paymentIntents: { create: () => { throw new Error('must not reach Stripe'); } } });
    expect(collect.ok).toBe(false);
    expect(collect.code).toBe('held_for_review');
  });

  test('the flag flips true -> false (and re-proposes) when the departure becomes unauthenticated, evidence otherwise identical', async () => {
    const { ev, charge } = await mk({ arr: true, dep: true });
    expect(charge.locationVerified).toBe(true);
    const hash = charge.evidenceHash;
    await DwellEvent.updateOne({ _id: ev._id }, { $set: { departureAuthenticated: false } });
    const r = await syncDetentionCharge(await DwellEvent.findById(ev._id));
    expect(r.action).toBe('reproposed');
    const c = await chargeOf(charge._id);
    expect(c.locationVerified).toBe(false);
    expect(c.evidenceHash).not.toBe(hash);
    expect(c.status).toBe('pending');
  });
});

// ── window writes ────────────────────────────────────────────────────────────────────────────────
describe('window endpoints: null bounds fail closed, writes are conditional', () => {
  let app, shipper, carrier;
  const book = async (over) => {
    const load = await createTestLoad(shipper._id, over);
    await Load.findOneAndUpdate({ _id: load._id, status: 'open' }, { $set: { status: 'accepted', acceptedBy: carrier._id } });
    return Load.findById(load._id);
  };
  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    carrier = await createTestUser({ role: 'carrier' });
  });

  test('delivery window with explicit null bounds on a booked load: 409, nothing written', async () => {
    const load = await book({ deliveryTimeWindow: { start: null, end: null } });
    const res = await request(app).put(`/api/loads/${load._id}/delivery-window`).set(bearer(shipper)).send({ start: at(60).toISOString(), end: at(120).toISOString() });
    expect(res.status).toBe(409);
    const fresh = await Load.findById(load._id);
    expect(fresh.deliveryTimeWindow.start).toBeNull();
  });

  test('pickup window with explicit null bounds on a booked load needs the carrier (proposal only)', async () => {
    const load = await book({ pickupTimeWindow: { start: null, end: null } });
    const res = await request(app).put(`/api/loads/${load._id}/pickup-window`).set(bearer(shipper)).send({ start: at(300).toISOString(), end: at(400).toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.windowChangeProposed).toBe(true);
    const fresh = await Load.findById(load._id);
    expect(fresh.pickupTimeWindow.start == null).toBe(true);
    expect(fresh.pickupWindowChange.status).toBe('pending');
  });

  test('pickup window edit loses the race to a pickup: 409 and the window is untouched', async () => {
    const load = await book({ pickupTimeWindow: { start: at(300), end: at(400) } });
    const orig = Load.updateOne.bind(Load);
    const spy = jest.spyOn(Load, 'updateOne').mockImplementationOnce(async (...a) => {
      await Load.collection.updateOne({ _id: load._id }, { $set: { status: 'in-transit' } }); // lands between read and write
      return orig(...a);
    });
    const res = await request(app).put(`/api/loads/${load._id}/pickup-window`).set(bearer(shipper)).send({ start: at(310).toISOString(), end: at(500).toISOString() });
    spy.mockRestore();
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/changed/i);
    const fresh = await Load.findById(load._id);
    expect(fresh.pickupTimeWindow.end.getTime()).toBe(load.pickupTimeWindow.end.getTime());
  });

  test('pickup proposal and delivery edits lose the race to a re-booking / cancellation', async () => {
    const load = await book({ pickupTimeWindow: { start: at(300), end: at(400) } });
    const orig = Load.updateOne.bind(Load);
    let spy = jest.spyOn(Load, 'updateOne').mockImplementationOnce(async (...a) => {
      await Load.collection.updateOne({ _id: load._id }, { $set: { bookedAt: new Date(0) } }); // re-booked in between
      return orig(...a);
    });
    const earlier = await request(app).put(`/api/loads/${load._id}/pickup-window`).set(bearer(shipper)).send({ start: at(290).toISOString(), end: at(400).toISOString() });
    spy.mockRestore();
    expect(earlier.status).toBe(409);
    expect((await Load.findById(load._id)).pickupWindowChange?.status).toBeUndefined();

    const l2 = await book({});
    spy = jest.spyOn(Load, 'updateOne').mockImplementationOnce(async (...a) => {
      await Load.collection.updateOne({ _id: l2._id }, { $set: { status: 'cancelled' } });
      return orig(...a);
    });
    const d = await request(app).put(`/api/loads/${l2._id}/delivery-window`).set(bearer(shipper)).send({ start: l2.deliveryTimeWindow.start.toISOString(), end: new Date(l2.deliveryTimeWindow.end.getTime() + 3600000).toISOString() });
    spy.mockRestore();
    expect(d.status).toBe(409);
    expect((await Load.findById(l2._id)).deliveryTimeWindow.end.getTime()).toBe(l2.deliveryTimeWindow.end.getTime());
  });

  test('a normal lenient edit still applies, resets nothing else, and does not look like (un)booking', async () => {
    const load = await book({ pickupTimeWindow: { start: at(300), end: at(400) } });
    const before = await Load.findById(load._id).select('+pickupVerification.code +trackingNonce');
    const res = await request(app).put(`/api/loads/${load._id}/pickup-window`).set(bearer(shipper)).send({ start: at(310).toISOString(), end: at(500).toISOString() });
    expect(res.status).toBe(200);
    const after = await Load.findById(load._id).select('+pickupVerification.code +trackingNonce');
    expect(after.pickupTimeWindow.end.getTime()).toBeGreaterThan(before.pickupTimeWindow.end.getTime());
    expect(after.pickupVerification.code).toBe(before.pickupVerification.code); // not re-issued
    expect(after.trackingNonce).toBe(before.trackingNonce);
    expect(String(after.acceptedBy)).toBe(String(carrier._id));
    expect(after.bookedAt.getTime()).toBe(before.bookedAt.getTime());
  });
});

// ── other routes that write windows ──────────────────────────────────────────────────────────────
describe('window validation on load-creating routes; no route but the dedicated ones edits a booked load window', () => {
  let app, shipper, carrier;
  beforeEach(async () => {
    app = buildApp();
    // Load-creating routes apply the shipper posting gate and geocode typed places (node-fetch is mocked: no network).
    shipper = await createTestUser({ role: 'shipper', shipperVerification: { status: 'verified', paymentMethodVerified: true } });
    carrier = await createTestUser({ role: 'carrier' });
  });
  const ediDoc = () => EDIDocument.create({
    direction: 'inbound', type: '204', rawContent: 'x', status: 'parsed', shipper: shipper._id,
    parsedData: { origin: { city: 'Chicago', state: 'IL' }, destination: { city: 'Dallas', state: 'TX' }, references: [], totalChargesCents: 250000 },
  });

  test('EDI create-load cannot override booking state and rejects bad windows', async () => {
    const bad = await request(app).post(`/api/edi/${(await ediDoc())._id}/create-load`).set(bearer(shipper))
      .send({ pickupTimeWindow: { start: 'tomorrow', end: 'later' } });
    expect(bad.status).toBe(400);
    const reversed = await request(app).post(`/api/edi/${(await ediDoc())._id}/create-load`).set(bearer(shipper))
      .send({ pickupTimeWindow: { start: '2026-06-02T10:00:00Z', end: '2026-06-01T10:00:00Z' } });
    expect(reversed.status).toBe(400);

    const ok = await request(app).post(`/api/edi/${(await ediDoc())._id}/create-load`).set(bearer(shipper))
      .send({ status: 'accepted', acceptedBy: String(carrier._id), pickupTimeWindow: { start: '2031-06-01T10:00:00Z', end: '2031-06-01T18:00:00Z' } });
    expect(ok.status).toBe(201);
    const load = await Load.findById(ok.body.load._id);
    expect(load.status).toBe('open');
    expect(load.acceptedBy == null).toBe(true);
  });

  test('EDI documents belong to the uploading shipper company: no cross-tenant read or create-load', async () => {
    const doc = await ediDoc();
    const otherShipper = await createTestUser({ role: 'shipper' });
    const admin = await createTestUser({ role: 'admin' });

    // another shipper cannot post a load in this shipper's name, nor read the document
    const stolen = await request(app).post(`/api/edi/${doc._id}/create-load`).set(bearer(otherShipper)).send({});
    expect(stolen.status).toBe(404);
    expect(await Load.countDocuments({ postedBy: shipper._id })).toBe(0);
    expect((await request(app).get(`/api/edi/${doc._id}`).set(bearer(otherShipper))).status).toBe(404);
    // an unrelated carrier cannot read it or see it in its list
    expect((await request(app).get(`/api/edi/${doc._id}`).set(bearer(carrier))).status).toBe(404);
    expect((await request(app).get('/api/edi').set(bearer(carrier))).body).toEqual([]);
    expect((await request(app).get('/api/edi').set(bearer(otherShipper))).body).toEqual([]);

    // a document with no shipper can never become a load, even for an admin
    const orphan = await EDIDocument.create({ direction: 'inbound', type: '204', rawContent: 'x', status: 'parsed', parsedData: doc.parsedData });
    expect((await request(app).post(`/api/edi/${orphan._id}/create-load`).set(bearer(admin)).send({})).status).toBe(404);

    // the owner still can, and the owner and admin can read it
    expect((await request(app).get(`/api/edi/${doc._id}`).set(bearer(shipper))).status).toBe(200);
    expect((await request(app).get(`/api/edi/${doc._id}`).set(bearer(admin))).status).toBe(200);
    const ok = await request(app).post(`/api/edi/${doc._id}/create-load`).set(bearer(shipper)).send({});
    expect(ok.status).toBe(201);
    expect(String(ok.body.load.postedBy)).toBe(String(shipper._id));
  });

  test('EDI create-load is claimed atomically: two concurrent requests create one load', async () => {
    const doc = await ediDoc();
    const fire = () => request(app).post(`/api/edi/${doc._id}/create-load`).set(bearer(shipper)).send({});
    const results = await Promise.all([fire(), fire()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await Load.countDocuments({ postedBy: shipper._id })).toBe(1);
    expect((await EDIDocument.findById(doc._id)).status).toBe('load_created');
  });

  test('enterprise bulk create rejects malformed / reversed / zone-less windows per load', async () => {
    const base = { title: 'T', origin: 'A, IL', destination: 'B, TX', rate: 1000, equipmentType: 'Dry Van' };
    const res = await request(app).post('/api/enterprise/loads/bulk').set(bearer(shipper)).send({ loads: [
      { ...base, pickupTimeWindow: { start: '2026-13-45', end: '2026-06-01T10:00:00Z' } },
      { ...base, pickupTimeWindow: { start: '2026-06-02T10:00:00Z', end: '2026-06-01T10:00:00Z' } },
      { ...base, deliveryTimeWindow: { start: '2026-06-01T10:00', end: '2026-06-02T10:00' } },
      { ...base, deliveryTimeWindow: { start: null, end: '2026-06-02T10:00:00Z' } },
      { ...base, pickupTimeWindow: { start: '2031-06-01T10:00:00Z', end: '2031-06-01T18:00:00Z' } },
    ] });
    expect(res.body.errors.map((e) => e.index)).toEqual([0, 1, 2, 3]);
    expect(res.body.created).toHaveLength(1);
  });

  test('shipper post-load form route rejects a bad or reversed window', async () => {
    await require('../../models/User').updateOne({ _id: shipper._id }, { $set: { 'shipperVerification.paymentMethodVerified': true } });
    const body = { title: 'T', origin: 'Chicago, IL', destination: 'Dallas, TX', rate: 1000, equipmentType: 'Dry Van' };
    const bad = await request(app).post('/api/loads').set(bearer(shipper)).send({ ...body, pickupWindowStart: 'whenever' });
    expect(bad.status).toBe(400);
    const rev = await request(app).post('/api/loads').set(bearer(shipper)).send({ ...body, pickupWindowStart: '2026-06-02T10:00', pickupWindowEnd: '2026-06-01T10:00' });
    expect(rev.status).toBe(400);
  });

  // PUT /api/loads/:id now exists (shipper edits an OPEN load, see loadEdit.test.js); on a booked load it refuses (409).
  test('PUT/PATCH /api/loads/:id cannot move a booked load window', async () => {
    const load = await createTestLoad(shipper._id, { pickupTimeWindow: { start: at(300), end: at(400) } });
    await Load.findOneAndUpdate({ _id: load._id, status: 'open' }, { $set: { status: 'accepted', acceptedBy: carrier._id } });
    for (const m of ['put', 'patch']) {
      const res = await request(app)[m](`/api/loads/${load._id}`).set(bearer(shipper)).send({ pickupTimeWindow: { start: at(1).toISOString(), end: at(2).toISOString() } });
      expect(m === 'put' ? [409] : [404, 405]).toContain(res.status);
    }
    const fresh = await Load.findById(load._id);
    expect(fresh.pickupTimeWindow.end.getTime()).toBe(load.pickupTimeWindow.end.getTime());
  });
});
