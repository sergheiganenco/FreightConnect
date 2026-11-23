/**
 * Integration: stored documents need a signed-in party; delivery needs proof; impossible dates are refused at posting.
 */
require('../setup');
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const Load = require('../../models/Load');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const { requireFileAccess, setFileCookie } = require('../../middlewares/fileAccess');
const { windowProblem } = require('../../utils/windowValidation');

jest.mock('axios');
jest.mock('node-fetch');
const fetch = require('node-fetch');

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {} };
const dir = path.join(__dirname, '..', '..', 'public', 'documents', 'uploads');
const app = express();
app.use(express.json());
app.use('/documents/uploads', requireFileAccess, express.static(dir));
app.get('/cookie/:id/:role', (req, res) => { setFileCookie(res, { userId: req.params.id, role: req.params.role, companyOwnerId: req.params.id }); res.end(); });
app.use('/api/loads', require('../../routes/loadRoutes')(mockIo));

const as = (m, url, user) => request(app)[m](url).set('Authorization', `Bearer ${generateToken(user)}`);
const cookieFor = async (user) => (await request(app).get(`/cookie/${user._id}/${user.role}`)).headers['set-cookie'][0].split(';')[0];

describe('stored documents', () => {
  const made = [];
  afterAll(() => made.forEach((f) => { try { fs.unlinkSync(f); } catch (_) { /* gone */ } }));
  const put = (name) => { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, name); fs.writeFileSync(f, 'x'); made.push(f); return `/documents/uploads/${name}`; };

  test('nobody anonymous; a load document only for its parties and admins; the cookie is not a session token', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await createTestUser({ role: 'carrier' });
    const stranger = await createTestUser({ role: 'carrier' });
    const admin = await createTestUser({ role: 'admin' });
    const load = await createTestLoad(shipper._id, { status: 'accepted', acceptedBy: carrier._id });
    const bol = put(`${load._id}-bol.pdf`);
    const other = put(`qa-${Date.now()}.pdf`);

    expect((await request(app).get(bol)).status).toBe(401);
    expect((await request(app).get(other)).status).toBe(401);
    expect((await request(app).get(bol).set('Cookie', 'fc_files=garbage')).status).toBe(401);

    for (const u of [shipper, carrier, admin]) expect((await request(app).get(bol).set('Cookie', await cookieFor(u))).status).toBe(200);
    expect((await request(app).get(bol).set('Cookie', await cookieFor(stranger))).status).toBe(404);
    expect((await request(app).get(other).set('Cookie', await cookieFor(stranger))).status).toBe(200);
    // the phone app sends its session token instead of a cookie
    expect((await as('get', bol, carrier)).status).toBe(200);
    expect((await as('get', bol, stranger)).status).toBe(404);

    // the file cookie's value must not work as an API token
    const value = (await cookieFor(shipper)).split('=')[1];
    expect((await request(app).get('/api/loads/posted').set('Authorization', `Bearer ${value}`)).status).toBe(401);
    // no spelling of the path gets a stranger past the per-load check
    const sneaky = await cookieFor(stranger);
    const id = String(load._id);
    for (const p of [`/documents/uploads/x/../${id}-bol.pdf`, `/documents/uploads/%2e/${id}-bol.pdf`, `/documents/uploads/.%2F${id}-bol.pdf`,
      `/documents/uploads/%${id.charCodeAt(0).toString(16)}${id.slice(1)}-bol.pdf`, `/documents/uploads//${id}-bol.pdf`, `/documents/uploads/${id.toUpperCase()}-bol.pdf`]) {
      expect((await request(app).get(p).set('Cookie', sneaky)).status).not.toBe(200);
    }
    // and a path that tries to climb out is not served
    expect((await request(app).get('/documents/uploads/..%2F..%2F..%2Fapp.js').set('Cookie', await cookieFor(admin))).status).not.toBe(200);
  });
});

describe('delivery needs proof', () => {
  test('status and deliver routes refuse without a POD or receiver signature, then accept', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const carrier = await createTestUser({ role: 'carrier' });
    const load = await createTestLoad(shipper._id, { status: 'in-transit', acceptedBy: carrier._id });
    const r = await as('put', `/api/loads/${load._id}/status`, carrier).send({ status: 'delivered' });
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe('pod_required');
    expect((await as('put', `/api/loads/${load._id}/deliver`, carrier).send({})).body.reason).toBe('pod_required');
    expect((await Load.findById(load._id)).status).toBe('in-transit');

    await Load.updateOne({ _id: load._id }, { $set: { 'documents.pod': '/documents/uploads/x-pod.jpg' } });
    expect((await as('put', `/api/loads/${load._id}/status`, carrier).send({ status: 'delivered' })).status).toBe(200);
  });
});

describe('dates that cannot be right', () => {
  const day = 86400000;
  const iso = (ms) => new Date(Date.now() + ms).toISOString();
  test('windowProblem', () => {
    const w = (s, e) => ({ start: new Date(Date.now() + s), end: new Date(Date.now() + e) });
    expect(windowProblem(w(day, 2 * day), w(3 * day, 4 * day), { checkPast: true })).toBeNull();
    expect(windowProblem(w(-2 * day, -day), undefined, { checkPast: true })).toMatch(/past/);
    expect(windowProblem(w(-2 * day, -day), undefined)).toBeNull();
    expect(windowProblem(w(-3600e3, 3600e3), undefined, { checkPast: true })).toBeNull(); // open right now
    expect(windowProblem(w(2 * day, 3 * day), w(0, day))).toMatch(/before pickup/);
    expect(windowProblem(undefined, w(0, day), { checkPast: true })).toBeNull();
  });

  test('posting and editing refuse them', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => [{ lat: '41.8', lon: '-87.6' }] });
    const shipper = await createTestUser({ role: 'shipper', shipperVerification: { status: 'verified', paymentMethodVerified: true } });
    const body = (o) => ({ title: 'T', origin: 'Chicago, IL', destination: 'Dallas, TX', rate: 1000, equipmentType: 'Dry Van', ...o });
    const past = await as('post', '/api/loads', shipper).send(body({ pickupWindowStart: iso(-3 * day), pickupWindowEnd: iso(-2 * day) }));
    expect(past.status).toBe(400);
    expect(past.body.error).toMatch(/past/);
    const backwards = await as('post', '/api/loads', shipper).send(body({
      pickupWindowStart: iso(3 * day), pickupWindowEnd: iso(4 * day), deliveryWindowStart: iso(day), deliveryWindowEnd: iso(2 * day),
    }));
    expect(backwards.status).toBe(400);
    expect(backwards.body.error).toMatch(/before pickup/);

    const ok = await as('post', '/api/loads', shipper).send(body({
      pickupWindowStart: iso(day), pickupWindowEnd: iso(2 * day), deliveryWindowStart: iso(3 * day), deliveryWindowEnd: iso(4 * day),
    }));
    expect(ok.status).toBe(201);
    const edit = await as('put', `/api/loads/${ok.body._id}`, shipper).send({ deliveryTimeWindow: { start: iso(0), end: iso(3600e3) } });
    expect(edit.status).toBe(400);
    expect((await as('put', `/api/loads/${ok.body._id}`, shipper).send({ notes: 'still editable' })).status).toBe(200);
  });
});
