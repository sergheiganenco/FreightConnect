/**
 * Integration: pickup handshake (anti impersonation / double-brokering).
 *
 * Real routes (loadRoutes, bidRoutes, userRoutes, documentRoutes and the new
 * pickupVerificationRoutes mounted at /api like app.js does) against in-memory Mongo.
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const Load = require('../../models/Load');
const Bid = require('../../models/Bid');
const Notification = require('../../models/Notification');
const { atomicBookLoad } = require('../../services/bookingGuard');
const svc = require('../../services/pickupVerificationService');

const io = { to: () => ({ emit: () => {} }), emit: () => {} };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loads', require('../../routes/loadRoutes')(io));
  app.use('/api/bids', require('../../routes/bidRoutes'));
  app.use('/api/users', require('../../routes/userRoutes'));
  app.use('/api/documents', require('../../routes/documentRoutes'));
  app.use('/api', require('../../routes/pickupVerificationRoutes'));
  return app;
}

const verifiedCarrier = (o = {}) => createTestUser({
  role: 'carrier',
  companyName: 'Acme Trucking',
  mcNumber: '123456',
  dotNumber: '7654321',
  verification: { status: 'verified', identityVerified: true, insurance: { status: 'valid' } },
  fleet: [{ truckId: 'TRUCK-1', status: 'Available', available: true }],
  ...o,
});
const bearer = (u) => ({ Authorization: `Bearer ${generateToken(u)}` });
const subToken = (sub, owner, companyRole) => ({
  Authorization: `Bearer ${jwt.sign({ userId: sub._id, role: 'carrier', companyOwnerId: owner._id, companyRole }, process.env.JWT_SECRET)}`,
});
const codeOf = async (loadId) => (await Load.findById(loadId).select('+pickupVerification.code')).pickupVerification.code;

describe('pickup handshake', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  async function bookedLoad({ required = false } = {}) {
    const shipper = await createTestUser({ role: 'shipper', companyName: 'Ship Co' });
    const carrier = await verifiedCarrier();
    const load = await createTestLoad(shipper._id, { pickupFacilityName: 'Dock 4', pickupVerification: { required } });
    const r = await request(app).put(`/api/loads/${load._id}/accept`).set(bearer(carrier)).send({});
    expect(r.status).toBe(200);
    return { shipper, carrier, load };
  }
  const dockLink = async (shipper, load) => {
    const r = await request(app).post(`/api/loads/${load._id}/dock-link`).set(bearer(shipper));
    expect(r.status).toBe(201);
    return r.body.token;
  };

  describe('code issuance on every booking path, absent from every load response', () => {
    test('direct accept issues a 6-digit code; accept response itself does not contain it', async () => {
      const shipper = await createTestUser({ role: 'shipper' });
      const carrier = await verifiedCarrier();
      const load = await createTestLoad(shipper._id);
      const res = await request(app).put(`/api/loads/${load._id}/accept`).set(bearer(carrier)).send({});
      const code = await codeOf(load._id);
      expect(code).toMatch(/^\d{6}$/);
      expect(JSON.stringify(res.body)).not.toContain(`"${code}"`);
      expect(res.body.load.pickupVerification.code).toBeUndefined();
    });

    test('bid acceptance (atomicBookLoad) issues a code', async () => {
      const shipper = await createTestUser({ role: 'shipper' });
      const carrier = await verifiedCarrier();
      const load = await createTestLoad(shipper._id);
      const bid = await Bid.create({ loadId: load._id, carrierId: carrier._id, amount: 2000, status: 'pending', history: [{ actor: 'carrier', action: 'placed', amount: 2000 }] });
      const res = await request(app).put(`/api/bids/${bid._id}/accept`).set(bearer(shipper));
      expect(res.status).toBe(200);
      expect(await codeOf(load._id)).toMatch(/^\d{6}$/);
    });

    test('fleet assign-load issues a code; unassign clears it', async () => {
      const shipper = await createTestUser({ role: 'shipper' });
      const carrier = await verifiedCarrier();
      const load = await createTestLoad(shipper._id);
      const res = await request(app).put('/api/users/fleet/TRUCK-1/assign-load').set(bearer(carrier)).send({ loadId: String(load._id) });
      expect(res.status).toBe(200);
      expect(await codeOf(load._id)).toMatch(/^\d{6}$/);
      const un = await request(app).put('/api/users/fleet/TRUCK-1/unassign-load').set(bearer(carrier)).send({});
      expect(un.status).toBe(200);
      const fresh = await Load.findById(load._id).select('+pickupVerification.code');
      expect(fresh.status).toBe('open');
      expect(fresh.pickupVerification.code).toBeUndefined();
    });

    test('auto-dispatch / contract path (atomicBookLoad directly) issues a code', async () => {
      const shipper = await createTestUser({ role: 'shipper' });
      const carrier = await verifiedCarrier();
      const load = await createTestLoad(shipper._id);
      const booked = await atomicBookLoad({ loadId: load._id, carrierId: carrier._id, gate: { fingerprint: null, riskFlags: [] } });
      expect(booked.status).toBe('accepted');
      expect(booked.pickupVerification.code).toBeUndefined();
      expect(await codeOf(load._id)).toMatch(/^\d{6}$/);
    });

    test('code never appears in list/detail/my-loads/accepted/posted/open for anyone', async () => {
      const { shipper, carrier, load } = await bookedLoad();
      const other = await verifiedCarrier({ companyName: 'Other Co' });
      const code = await codeOf(load._id);
      const calls = [
        [shipper, '/api/loads'], [shipper, `/api/loads/${load._id}`], [shipper, '/api/loads/posted'], [shipper, '/api/loads/shipper-my-loads'],
        [carrier, '/api/loads'], [carrier, `/api/loads/${load._id}`], [carrier, '/api/loads/my-loads'], [carrier, '/api/loads/accepted'], [carrier, '/api/loads/open'],
        [other, '/api/loads'], [other, '/api/loads/open'],
      ];
      for (const [who, url] of calls) {
        const r = await request(app).get(url).set(bearer(who));
        expect(r.status).toBe(200);
        expect(JSON.stringify(r.body)).not.toContain(`"${code}"`);
        expect(JSON.stringify(r.body)).not.toMatch(/"code"/);
      }
      // other carrier is not even allowed to read the booked load
      expect((await request(app).get(`/api/loads/${load._id}`).set(bearer(other))).status).toBe(403);
    });
  });

  describe('who can read the code', () => {
    test('owner, dispatcher and driver sub-accounts of the booked carrier can; shipper / other carrier / admin cannot', async () => {
      const { shipper, carrier, load } = await bookedLoad();
      const code = await codeOf(load._id);
      const dispatcher = await createTestUser({ role: 'carrier' });
      const driver = await createTestUser({ role: 'carrier' });

      const o = await request(app).get(`/api/loads/${load._id}/pickup-code`).set(bearer(carrier));
      expect(o.status).toBe(200);
      expect(o.body.code).toBe(code);
      expect(o.headers['cache-control']).toMatch(/no-store/);
      for (const [sub, role] of [[dispatcher, 'dispatcher'], [driver, 'driver']]) {
        const r = await request(app).get(`/api/loads/${load._id}/pickup-code`).set(subToken(sub, carrier, role));
        expect(r.status).toBe(200);
        expect(r.body.code).toBe(code);
      }

      const other = await verifiedCarrier();
      expect((await request(app).get(`/api/loads/${load._id}/pickup-code`).set(bearer(other))).status).toBe(404);
      expect((await request(app).get(`/api/loads/${load._id}/pickup-code`).set(bearer(shipper))).status).toBe(403);
      const admin = await createTestUser({ role: 'admin' });
      expect((await request(app).get(`/api/loads/${load._id}/pickup-code`).set(bearer(admin))).status).toBe(403);
      expect((await request(app).get(`/api/loads/${load._id}/pickup-code`)).status).toBe(401);
    });
  });

  describe('dock link', () => {
    test('only the load shipper company can mint the link; dock info exposes nothing financial or secret', async () => {
      const { shipper, carrier, load } = await bookedLoad();
      const otherShipper = await createTestUser({ role: 'shipper' });
      expect((await request(app).post(`/api/loads/${load._id}/dock-link`).set(bearer(otherShipper))).status).toBe(403);
      expect((await request(app).post(`/api/loads/${load._id}/dock-link`).set(bearer(carrier))).status).toBe(403);

      const token = await dockLink(shipper, load);
      const info = await request(app).get(`/api/dock/${token}`);
      expect(info.status).toBe(200);
      expect(info.body.state).toBe('pending');
      // test carrier is not FMCSA-verified, so the dock sees the self-reported profile, flagged as such
      expect(info.body.carrier).toEqual({ companyName: 'Acme Trucking', mcNumber: '123456', dotNumber: '7654321', identityVerified: false });
      expect(info.body.facility).toBe('Dock 4');
      const s = JSON.stringify(info.body);
      expect(s).not.toContain(await codeOf(load._id));
      expect(s).not.toMatch(/rate|postedBy|acceptedBy|"code"/i);
    });

    test('FMCSA-verified carrier: dock shows legal name + verified numbers, never the editable profile values', async () => {
      const shipper = await createTestUser({ role: 'shipper' });
      const carrier = await verifiedCarrier({
        companyName: 'Profile Edited Name', mcNumber: '999999', dotNumber: '1111111',
        verification: {
          status: 'verified', identityVerified: true, insurance: { status: 'valid' },
          mcNumber: '555555', dotNumber: '4444444', fmcsaData: { legalName: 'Real Legal Name LLC' },
        },
      });
      const load = await createTestLoad(shipper._id, { pickupVerification: { required: true } });
      await request(app).put(`/api/loads/${load._id}/accept`).set(bearer(carrier)).send({}).expect(200);
      const token = await dockLink(shipper, load);
      const expected = { companyName: 'Real Legal Name LLC', mcNumber: '555555', dotNumber: '4444444', identityVerified: true };

      const info = await request(app).get(`/api/dock/${token}`);
      expect(info.body.carrier).toMatchObject(expected);
      const ok = await request(app).post(`/api/dock/${token}/verify`).send({ code: await codeOf(load._id) });
      expect(ok.status).toBe(200);
      expect(ok.body.carrier).toMatchObject(expected);
      for (const body of [info.body, ok.body]) {
        expect(JSON.stringify(body)).not.toMatch(/Profile Edited Name|999999|1111111/);
      }
    });

    test('unverified carrier: dock shows profile values with identityVerified false', async () => {
      const shipper = await createTestUser({ role: 'shipper' });
      const carrier = await verifiedCarrier({
        verification: { status: 'pending', insurance: { status: 'valid' }, fmcsaData: { legalName: 'Should Not Show LLC' } },
      });
      const load = await createTestLoad(shipper._id, { pickupVerification: { required: true } });
      // the booking gate needs a verified carrier, so book with one and hand the load to the unverified one directly
      await request(app).put(`/api/loads/${load._id}/accept`).set(bearer(await verifiedCarrier())).send({}).expect(200);
      await Load.updateOne({ _id: load._id }, { $set: { acceptedBy: carrier._id } });
      const token = await dockLink(shipper, load);
      const info = await request(app).get(`/api/dock/${token}`);
      expect(info.body.carrier).toEqual({ companyName: 'Acme Trucking', mcNumber: '123456', dotNumber: '7654321', identityVerified: false });
      expect(JSON.stringify(info.body)).not.toContain('Should Not Show');
    });

    test('verify with the right code: success, audit, notifications, idempotent', async () => {
      const { shipper, carrier, load } = await bookedLoad();
      const token = await dockLink(shipper, load);
      const code = await codeOf(load._id);
      const ok = await request(app).post(`/api/dock/${token}/verify`).send({ code });
      expect(ok.status).toBe(200);
      expect(ok.body.verified).toBe(true);
      expect(ok.body.carrier.mcNumber).toBe('123456');
      const fresh = await Load.findById(load._id);
      expect(fresh.pickupVerification.verifiedAt).toBeTruthy();
      expect(fresh.pickupVerification.verifiedBy).toBe('dock_link');
      const StatusHistory = require('../../models/StatusHistory');
      expect(await StatusHistory.countDocuments({ entityType: 'load', entityId: load._id, toStatus: 'pickup_verified' })).toBe(1);
      expect(await Notification.countDocuments({ userId: shipper._id, type: 'load:pickup_verified' })).toBe(1);
      expect(await Notification.countDocuments({ userId: carrier._id, type: 'load:pickup_verified' })).toBe(1);
      const notes = await Notification.find({});
      expect(JSON.stringify(notes)).not.toContain(`"${code}"`);

      // idempotent: same call again (even with a wrong code) stays verified, no duplicate audit/notification
      const again = await request(app).post(`/api/dock/${token}/verify`).send({ code: '000000' });
      expect(again.status).toBe(200);
      expect(again.body.alreadyVerified).toBe(true);
      expect(await StatusHistory.countDocuments({ entityType: 'load', entityId: load._id, toStatus: 'pickup_verified' })).toBe(1);

      // code no longer served to the carrier once verified
      const c = await request(app).get(`/api/loads/${load._id}/pickup-code`).set(bearer(carrier));
      expect(c.body).toEqual({ verified: true, verifiedAt: expect.any(String) });
    });

    test('wrong code increments attempts; 5th wrong locks and alerts the shipper; locked refuses the RIGHT code until the shipper unlocks', async () => {
      const { shipper, carrier, load } = await bookedLoad();
      const token = await dockLink(shipper, load);
      const code = await codeOf(load._id);
      const wrong = code === '111111' ? '222222' : '111111';

      const w1 = await request(app).post(`/api/dock/${token}/verify`).send({ code: wrong });
      expect(w1.status).toBe(400);
      expect(w1.body.attemptsRemaining).toBe(4);
      expect((await Load.findById(load._id)).pickupVerification.failedAttempts).toBe(1);
      for (let i = 0; i < 3; i++) await request(app).post(`/api/dock/${token}/verify`).send({ code: wrong });
      const w5 = await request(app).post(`/api/dock/${token}/verify`).send({ code: wrong });
      expect(w5.status).toBe(423);
      expect(w5.body.locked).toBe(true);
      expect((await Load.findById(load._id)).pickupVerification.lockedAt).toBeTruthy();
      const alerts = await Notification.find({ userId: shipper._id, type: 'load:pickup_verification_failed' });
      expect(alerts).toHaveLength(1);
      expect(alerts[0].metadata.priority).toBe('high');
      expect(alerts[0].body).toMatch(/5 times.*impersonation/);

      // right code now refused, counter does not move, no second alert
      const locked = await request(app).post(`/api/dock/${token}/verify`).send({ code });
      expect(locked.status).toBe(423);
      expect((await request(app).get(`/api/dock/${token}`)).body.state).toBe('locked');
      expect(await Notification.countDocuments({ type: 'load:pickup_verification_failed' })).toBe(1);
      // shipper's in-app verify is refused while locked too
      expect((await request(app).post(`/api/loads/${load._id}/pickup-verify`).set(bearer(shipper)).send({ code })).status).toBe(423);

      // only the shipper (not the carrier) unlocks
      expect((await request(app).post(`/api/loads/${load._id}/pickup-unlock`).set(bearer(carrier))).status).toBe(403);
      expect((await request(app).post(`/api/loads/${load._id}/pickup-unlock`).set(bearer(shipper))).status).toBe(200);
      const ok = await request(app).post(`/api/dock/${token}/verify`).send({ code });
      expect(ok.status).toBe(200);
      expect(ok.body.verified).toBe(true);
    });

    test('parallel guessing cannot exceed 5 attempts', async () => {
      const { load } = await bookedLoad();
      const code = await codeOf(load._id);
      const guesses = Array.from({ length: 12 }, (_, i) => String(100000 + i)).filter((g) => g !== code);
      const results = await Promise.all(guesses.map((g) => svc.attemptVerify({ loadId: load._id, code: g, verifiedBy: 'dock_link' })));
      expect(results.filter((r) => r.http === 400 || (r.http === 423 && r.body.attemptsRemaining === 0)).length).toBeLessThanOrEqual(12);
      expect((await Load.findById(load._id)).pickupVerification.failedAttempts).toBe(5);
    });

    test('shipper in-app verify works, malformed code is rejected without counting', async () => {
      const { shipper, load } = await bookedLoad();
      const bad = await request(app).post(`/api/loads/${load._id}/pickup-verify`).set(bearer(shipper)).send({ code: 'abc' });
      expect(bad.status).toBe(400);
      expect((await Load.findById(load._id)).pickupVerification.failedAttempts).toBe(0);
      const ok = await request(app).post(`/api/loads/${load._id}/pickup-verify`).set(bearer(shipper)).send({ code: await codeOf(load._id) });
      expect(ok.status).toBe(200);
      expect((await Load.findById(load._id)).pickupVerification.verifiedBy).toBe('shipper');
    });

    test('bad / forged / tampered / expired tokens are rejected', async () => {
      const { shipper, load } = await bookedLoad();
      const token = await dockLink(shipper, load);
      const [id, exp, sig] = token.split('.');
      expect((await request(app).get('/api/dock/garbage')).status).toBe(404);
      expect((await request(app).get(`/api/dock/${id}.${exp}.${'0'.repeat(32)}`)).status).toBe(404);
      // extending the expiry invalidates the signature
      expect((await request(app).get(`/api/dock/${id}.${(parseInt(exp, 36) + 99999).toString(36)}.${sig}`)).status).toBe(404);
      // a different load id with this signature
      expect((await request(app).get(`/api/dock/${'a'.repeat(24)}.${exp}.${sig}`)).status).toBe(404);
      // a tracking-style / other-purpose signature is not accepted (domain separation)
      const crypto = require('crypto');
      const trackingStyle = crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${id}.${exp}`).digest('hex').slice(0, 32);
      expect((await request(app).get(`/api/dock/${id}.${exp}.${trackingStyle}`)).status).toBe(404);
      // genuinely expired (correctly signed, past expiry)
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() - 30 * 24 * 3600 * 1000);
      const old = svc.signDockToken(load._id).token;
      Date.now.mockRestore();
      expect((await request(app).get(`/api/dock/${old}`)).status).toBe(410);
      expect((await request(app).post(`/api/dock/${old}/verify`).send({ code: '123456' })).status).toBe(410);
    });

    test('missing TRACKING_TOKEN_SECRET and JWT_SECRET fails closed', async () => {
      const { shipper, load } = await bookedLoad();
      const token = await dockLink(shipper, load);
      const saved = { t: process.env.TRACKING_TOKEN_SECRET, j: process.env.JWT_SECRET };
      delete process.env.TRACKING_TOKEN_SECRET;
      delete process.env.JWT_SECRET;
      try {
        expect((await request(app).get(`/api/dock/${token}`)).status).toBe(404);
        expect((await request(app).post(`/api/dock/${token}/verify`).send({ code: await codeOf(load._id) })).status).toBe(404);
        expect(() => svc.signDockToken(load._id)).toThrow(/must be configured/);
      } finally {
        process.env.JWT_SECRET = saved.j;
        if (saved.t !== undefined) process.env.TRACKING_TOKEN_SECRET = saved.t;
      }
      expect((await Load.findById(load._id)).pickupVerification.verifiedAt).toBeUndefined();
    });
  });

  describe('enforcement', () => {
    test('required=true blocks in-transit and the pickup signature until verified, then allows both', async () => {
      const { shipper, carrier, load } = await bookedLoad({ required: true });
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

      const blocked = await request(app).put(`/api/loads/${load._id}/status`).set(bearer(carrier)).send({ status: 'in-transit' });
      expect(blocked.status).toBe(409);
      expect(blocked.body.reason).toBe('pickup_verification_required');
      expect((await Load.findById(load._id)).status).toBe('accepted');
      const sigBlocked = await request(app).post(`/api/documents/${load._id}/pickup-signature`).set(bearer(carrier)).send({ dataUrl: png });
      expect(sigBlocked.status).toBe(409);

      const token = await dockLink(shipper, load);
      await request(app).post(`/api/dock/${token}/verify`).send({ code: await codeOf(load._id) }).expect(200);

      const sig = await request(app).post(`/api/documents/${load._id}/pickup-signature`).set(bearer(carrier)).send({ dataUrl: png });
      expect(sig.status).toBe(200);
      const go = await request(app).put(`/api/loads/${load._id}/status`).set(bearer(carrier)).send({ status: 'in-transit' });
      expect(go.status).toBe(200);
      expect(go.body.load.status).toBe('in-transit');
    });

    test('required=false does not block', async () => {
      const { carrier, load } = await bookedLoad({ required: false });
      const go = await request(app).put(`/api/loads/${load._id}/status`).set(bearer(carrier)).send({ status: 'in-transit' });
      expect(go.status).toBe(200);
    });

    test('POST /loads accepts the optional flag (default off) and validates it', async () => {
      const shipper = await createTestUser({ role: 'shipper', shipperVerification: { paymentMethodVerified: true } });
      const base = { title: 't', origin: 'Chicago, IL', destination: 'Dallas, TX', rate: 1000, equipmentType: 'Dry Van', originLat: 1, originLng: 1, destinationLat: 2, destinationLng: 2 };
      const on = await request(app).post('/api/loads').set(bearer(shipper)).send({ ...base, requirePickupVerification: true });
      expect(on.status).toBe(201);
      expect(on.body.pickupVerification.required).toBe(true);
      const off = await request(app).post('/api/loads').set(bearer(shipper)).send(base);
      expect(off.body.pickupVerification.required).toBe(false);
      const bad = await request(app).post('/api/loads').set(bearer(shipper)).send({ ...base, requirePickupVerification: 'maybe' });
      expect(bad.status).toBe(400);
    });

    test('shipper can switch required ON while open/accepted but not OFF once accepted; admin can; others cannot', async () => {
      const { shipper, carrier, load } = await bookedLoad({ required: false });
      const put = (u, required) => request(app).put(`/api/loads/${load._id}/pickup-required`).set(bearer(u)).send({ required });
      expect((await put(carrier, true)).status).toBe(403);
      expect((await put(shipper, true)).status).toBe(200);
      expect((await Load.findById(load._id)).pickupVerification.required).toBe(true);
      const off = await put(shipper, false);
      expect(off.status).toBe(403);
      expect((await Load.findById(load._id)).pickupVerification.required).toBe(true);
      const admin = await createTestUser({ role: 'admin' });
      expect((await put(admin, false)).status).toBe(200);
      expect((await Load.findById(load._id)).pickupVerification.required).toBe(false);

      // while still open the shipper may toggle freely
      const open = await createTestLoad(shipper._id);
      const r = (v) => request(app).put(`/api/loads/${open._id}/pickup-required`).set(bearer(shipper)).send({ required: v });
      expect((await r(true)).status).toBe(200);
      expect((await r(false)).status).toBe(200);
    });

    test('turning required on for a legacy booked load without a code issues one', async () => {
      const { shipper, load } = await bookedLoad();
      await Load.collection.updateOne({ _id: load._id }, { $unset: { 'pickupVerification.code': 1 } });
      await request(app).put(`/api/loads/${load._id}/pickup-required`).set(bearer(shipper)).send({ required: true }).expect(200);
      expect(await codeOf(load._id)).toMatch(/^\d{6}$/);
    });
  });

  describe('lifecycle', () => {
    test('code cleared on cancel; regenerated for a new carrier after carrier drops the load', async () => {
      const { shipper, carrier, load } = await bookedLoad();
      const first = await codeOf(load._id);
      await request(app).put(`/api/loads/${load._id}/cancel`).set(bearer(shipper)).send({ reason: 'x' }).expect(200);
      let fresh = await Load.findById(load._id).select('+pickupVerification.code');
      expect(fresh.status).toBe('cancelled');
      expect(fresh.pickupVerification.code).toBeUndefined();

      // carrier-drop reopen path + rebook by a different carrier
      const shipper2 = await createTestUser({ role: 'shipper' });
      const l2 = await createTestLoad(shipper2._id, { pickupVerification: { required: true } });
      await request(app).put(`/api/loads/${l2._id}/accept`).set(bearer(carrier)).send({}).expect(200);
      const c1 = await codeOf(l2._id);
      await request(app).put(`/api/loads/${l2._id}/cancel`).set(bearer(carrier)).send({ reason: 'breakdown' }).expect(200);
      fresh = await Load.findById(l2._id).select('+pickupVerification.code');
      expect(fresh.status).toBe('open');
      expect(fresh.pickupVerification.code).toBeUndefined();
      expect(fresh.pickupVerification.required).toBe(true); // shipper's setting survives re-listing
      const carrier2 = await verifiedCarrier({ companyName: 'Second Co' });
      await request(app).put(`/api/loads/${l2._id}/accept`).set(bearer(carrier2)).send({}).expect(200);
      const c2 = await codeOf(l2._id);
      expect(c2).toMatch(/^\d{6}$/);
      expect(c2).not.toBe(c1);
      // the first carrier can no longer read it
      expect((await request(app).get(`/api/loads/${l2._id}/pickup-code`).set(bearer(carrier))).status).toBe(404);
      expect((await request(app).get(`/api/loads/${l2._id}/pickup-code`).set(bearer(carrier2))).body.code).toBe(c2);
      expect(first).toMatch(/^\d{6}$/);
    });

    test('re-booking resets a prior verification / lock', async () => {
      const { shipper, carrier, load } = await bookedLoad();
      await request(app).post(`/api/loads/${load._id}/pickup-verify`).set(bearer(shipper)).send({ code: await codeOf(load._id) }).expect(200);
      await request(app).put(`/api/loads/${load._id}/cancel`).set(bearer(carrier)).send({ reason: 'x' }).expect(200);
      const fresh = await Load.findById(load._id);
      expect(fresh.pickupVerification.verifiedAt).toBeUndefined();
      expect(fresh.pickupVerification.failedAttempts).toBe(0);
    });
  });
});
