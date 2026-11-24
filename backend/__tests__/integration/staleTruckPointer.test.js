/** Integration: fleet deliver/unassign-load must not act on a stale truck.assignedLoadId; /loads/open is role-scoped. */
require('../setup');
const express = require('express');
const request = require('supertest');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const Load = require('../../models/Load');
const User = require('../../models/User');

const io = { to: () => ({ emit: () => {} }), emit: () => {} };
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/users', require('../../routes/userRoutes'));
  app.use('/api/loads', require('../../routes/loadRoutes')(io));
  app.use('/api', require('../../routes/pickupVerificationRoutes'));
  return app;
}
const carrier = (o = {}) => createTestUser({
  role: 'carrier',
  verification: { status: 'verified', identityVerified: true, insurance: { status: 'valid' } },
  fleet: [{ truckId: 'T1', status: 'Available', available: true }],
  ...o,
});
const bearer = (u) => ({ Authorization: `Bearer ${generateToken(u)}` });

describe('stale truck pointer', () => {
  let app, shipper, A, B, load;
  const call = (who, action) => request(app).put(`/api/users/fleet/T1/${action}`).set(bearer(who)).send({});
  const truckOf = async (u) => (await User.findById(u._id)).fleet.find((t) => t.truckId === 'T1');
  // A load is picked up (in transit) before it can be delivered.
  const pickUp = (who) => request(app).put(`/api/loads/${load._id}/status`).set(bearer(who)).send({ status: 'in-transit' });

  beforeEach(async () => {
    app = buildApp();
    shipper = await createTestUser({ role: 'shipper' });
    A = await carrier();
    B = await carrier();
    load = await createTestLoad(shipper._id, { documents: { pod: '/documents/uploads/x-pod.jpg' } }); // delivery needs proof
    await request(app).put('/api/users/fleet/T1/assign-load').set(bearer(A)).send({ loadId: String(load._id) }).expect(200);
  });
  // Simulates cancel + re-book by B without going through cancel (which also clears A's truck pointer):
  // A's truck keeps pointing at the load, but B now holds it.
  const rebookToB = (extra = {}) => Load.updateOne({ _id: load._id }, { $set: { acceptedBy: B._id, status: 'accepted', ...extra } });

  test('happy path: A delivers its own load', async () => {
    expect((await pickUp(A)).status).toBe(200);
    const r = await call(A, 'deliver');
    expect(r.status).toBe(200);
    const fresh = await Load.findById(load._id);
    expect(fresh.status).toBe('delivered');
    expect((await truckOf(A)).assignedLoadId).toBeFalsy();
  });

  test('deliver on a load now held by B -> 409, load untouched, truck freed', async () => {
    await rebookToB();
    const r = await call(A, 'deliver');
    expect(r.status).toBe(409);
    const fresh = await Load.findById(load._id);
    expect(fresh.status).toBe('accepted');
    expect(String(fresh.acceptedBy)).toBe(String(B._id));
    expect(fresh.deliveredAt).toBeFalsy();
    const t = await truckOf(A);
    expect(t.assignedLoadId).toBeFalsy();
    expect(t.status).toBe('Available');
  });

  test('deliver on a cancelled/reopened load that A no longer holds -> 409', async () => {
    await Load.updateOne({ _id: load._id }, { $set: { status: 'open', acceptedBy: null } });
    expect((await call(A, 'deliver')).status).toBe(409);
    expect((await Load.findById(load._id)).status).toBe('open');
  });

  test('unassign on a load now held by B -> 409, stays accepted by B, truck freed', async () => {
    await rebookToB();
    const r = await call(A, 'unassign-load');
    expect(r.status).toBe(409);
    const fresh = await Load.findById(load._id);
    expect(fresh.status).toBe('accepted');
    expect(String(fresh.acceptedBy)).toBe(String(B._id));
    expect((await truckOf(A)).assignedLoadId).toBeFalsy();
  });

  test('unassign of an in-transit load is refused and the load is not reopened', async () => {
    await Load.updateOne({ _id: load._id }, { $set: { status: 'in-transit' } });
    const r = await call(A, 'unassign-load');
    expect(r.status).toBe(409);
    const fresh = await Load.findById(load._id);
    expect(fresh.status).toBe('in-transit');
    expect(String(fresh.acceptedBy)).toBe(String(A._id));
  });

  test('deliver requires pickup verification when required; succeeds once verified', async () => {
    await Load.updateOne({ _id: load._id }, { $set: { 'pickupVerification.required': true } });
    const r = await call(A, 'deliver');
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe('pickup_verification_required');
    expect((await Load.findById(load._id)).status).toBe('accepted');

    const token = (await request(app).post(`/api/loads/${load._id}/dock-link`).set(bearer(shipper))).body.token;
    const code = (await Load.findById(load._id).select('+pickupVerification.code')).pickupVerification.code;
    await request(app).post(`/api/dock/${token}/verify`).send({ code }).expect(200);
    expect((await pickUp(A)).status).toBe(200);
    expect((await call(A, 'deliver')).status).toBe(200);
    expect((await Load.findById(load._id)).status).toBe('delivered');
  });
});

describe('GET /loads/open by role', () => {
  test('shipper sees only own open loads; admin sees all', async () => {
    const app = buildApp();
    const X = await createTestUser({ role: 'shipper' });
    const Y = await createTestUser({ role: 'shipper' });
    const admin = await createTestUser({ role: 'admin' });
    const lx = await createTestLoad(X._id, { title: 'X-load' });
    const ly = await createTestLoad(Y._id, { title: 'Y-load' });
    const ids = async (u) => (await request(app).get('/api/loads/open').set(bearer(u)).expect(200)).body.map((l) => String(l._id));
    expect(await ids(X)).toEqual([String(lx._id)]);
    expect(await ids(Y)).toEqual([String(ly._id)]);
    expect((await ids(admin)).sort()).toEqual([String(lx._id), String(ly._id)].sort());
  });

  test('/loads/recommended/:loadId scopes shipper to own postings', async () => {
    const app = buildApp();
    const X = await createTestUser({ role: 'shipper' });
    const Y = await createTestUser({ role: 'shipper' });
    const cur = await createTestLoad(X._id, { title: 'cur' });
    const lx = await createTestLoad(X._id, { title: 'X2', origin: 'Dallas, TX' });
    const ly = await createTestLoad(Y._id, { title: 'Y2', origin: 'Dallas, TX' });
    const r = await request(app).get(`/api/loads/recommended/${cur._id}`).set(bearer(X));
    expect(r.status).toBe(200);
    const ids = r.body.map((l) => String(l._id));
    expect(ids).toContain(String(lx._id));
    expect(ids).not.toContain(String(ly._id));
  });
});
