/**
 * Integration: photo evidence at pickup and delivery.
 * Real routes against in-memory Mongo; real files in the private evidence dir
 * (every file a test creates is removed afterwards).
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const Load = require('../../models/Load');
const User = require('../../models/User');
const Notification = require('../../models/Notification');
const StatusHistory = require('../../models/StatusHistory');
const { PRIVATE_DIR } = require('../../routes/evidenceRoutes');

const io = { to: () => ({ emit: () => {} }), emit: () => {} };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loads', require('../../routes/loadRoutes')(io));
  app.use('/api/users', require('../../routes/userRoutes'));
  app.use('/api/documents', require('../../routes/documentRoutes'));
  app.use('/api', require('../../routes/evidenceRoutes'));
  return app;
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(64)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBPVP8 '), crypto.randomBytes(16)]);
const SIG = 'data:image/png;base64,' + PNG.toString('base64');

const bearer = (u) => ({ Authorization: `Bearer ${generateToken(u)}` });
const subToken = (sub, owner, companyRole) => ({
  Authorization: `Bearer ${jwt.sign({ userId: sub._id, role: 'carrier', companyOwnerId: owner._id, companyRole }, process.env.JWT_SECRET)}`,
});
const filesNow = () => new Set(fs.readdirSync(PRIVATE_DIR));
let before;
beforeAll(() => { before = filesNow(); });
afterEach(() => {
  for (const f of filesNow()) if (!before.has(f)) fs.unlinkSync(path.join(PRIVATE_DIR, f));
});

describe('load photo evidence', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  async function setup(loadOver = {}) {
    const shipper = await createTestUser({ role: 'shipper', companyName: 'Ship Co' });
    const carrier = await createTestUser({ role: 'carrier', companyName: 'Acme', fleet: [{ truckId: 'T1', status: 'Assigned', available: false }] });
    const load = await createTestLoad(shipper._id, { status: 'accepted', acceptedBy: carrier._id, ...loadOver });
    await User.updateOne({ _id: carrier._id, 'fleet.truckId': 'T1' }, { $set: { 'fleet.$.assignedLoadId': load._id } });
    return { shipper, carrier, load };
  }
  const up = (load, who, { file = PNG, name = 'p.png', type = 'image/png', stage = 'pickup', fields = {} } = {}) => {
    let r = request(app).post(`/api/loads/${load._id}/evidence`).set(who).field('stage', stage);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, String(v));
    return file ? r.attach('file', file, { filename: name, contentType: type }) : r;
  };
  const evidenceOf = async (id) => (await Load.findById(id).select('+evidence')).evidence;

  describe('upload', () => {
    test('stores file privately with matching sha256, acting person, computed distance, audit + one notification per stage', async () => {
      const { shipper, carrier, load } = await setup();
      // ~1 degree of latitude north of the Chicago origin is ~69 miles
      const r = await up(load, bearer(carrier), { fields: { kind: 'seal', sealNumber: ' SEAL-77 ', note: 'ok\u0007x', latitude: 42.8781, longitude: -87.6298, accuracyMeters: 12 } });
      expect(r.status).toBe(201);
      expect(r.body.data.file).toBeUndefined();
      expect(r.body.data.facilityDistanceMiles).toBeGreaterThan(68.5);
      expect(r.body.data.facilityDistanceMiles).toBeLessThan(69.5);
      const [ev] = await evidenceOf(load._id);
      expect(ev.sha256).toBe(crypto.createHash('sha256').update(PNG).digest('hex'));
      expect(crypto.createHash('sha256').update(fs.readFileSync(path.join(PRIVATE_DIR, ev.file))).digest('hex')).toBe(ev.sha256);
      expect(ev.file).toMatch(/^[a-f0-9]{32}\.png$/);
      expect(String(ev.uploadedBy)).toBe(String(carrier._id));
      expect(ev.sealNumber).toBe('SEAL-77');
      expect(ev.note).toBe('ok x');
      expect(ev.kind).toBe('seal');
      // second pickup photo + a delivery stage photo
      await up(load, bearer(carrier)).expect(201);
      await Load.updateOne({ _id: load._id }, { $set: { status: 'in-transit' } });
      await up(load, bearer(carrier), { stage: 'delivery', file: JPG, name: 'a.jpg', type: 'image/jpeg' }).expect(201);
      await new Promise((r2) => setTimeout(r2, 100));
      const notes = await Notification.find({ userId: shipper._id, type: 'load:evidence_added' });
      expect(notes.map((n) => n.metadata.stage).sort()).toEqual(['delivery', 'pickup']);
      const hist = await StatusHistory.find({ entityId: load._id, toStatus: 'evidence_added' });
      expect(hist).toHaveLength(3);
    });

    test('facility distance is null without GPS or without facility coords; lone latitude is dropped', async () => {
      const { carrier, load } = await setup();
      const a = await up(load, bearer(carrier)).expect(201);
      expect(a.body.data.facilityDistanceMiles).toBeNull();
      const b = await up(load, bearer(carrier), { fields: { latitude: 41.9 } }).expect(201);
      expect(b.body.data.latitude).toBeNull();
      const { carrier: c2, load: l2 } = await setup({ originLat: undefined, originLng: undefined });
      const c = await up(l2, bearer(c2), { fields: { latitude: 41.9, longitude: -87.6 } }).expect(201);
      expect(c.body.data.facilityDistanceMiles).toBeNull();
    });

    test('webp accepted; driver and dispatcher sub-accounts can upload as the person', async () => {
      const { carrier, load } = await setup();
      await up(load, bearer(carrier), { file: WEBP, name: 'a.webp', type: 'image/webp' }).expect(201);
      const driver = await createTestUser({ role: 'carrier', parentAccountId: carrier._id });
      const disp = await createTestUser({ role: 'carrier', parentAccountId: carrier._id });
      await up(load, subToken(driver, carrier, 'driver')).expect(201);
      await up(load, subToken(disp, carrier, 'dispatcher')).expect(201);
      const evs = await evidenceOf(load._id);
      expect(evs.map((e) => String(e.uploadedBy))).toEqual([carrier, driver, disp].map((u) => String(u._id)));
    });

    test('another carrier and the shipper cannot upload', async () => {
      const { shipper, load } = await setup();
      const other = await createTestUser({ role: 'carrier' });
      expect((await up(load, bearer(other))).status).toBe(403);
      expect((await up(load, bearer(shipper))).status).toBe(403);
      expect(await evidenceOf(load._id)).toHaveLength(0);
    });

    test('stage must match status; delivery window closes 24h after deliveredAt', async () => {
      const { carrier, load } = await setup();
      expect((await up(load, bearer(carrier), { stage: 'delivery' })).status).toBe(409); // accepted
      await Load.updateOne({ _id: load._id }, { $set: { status: 'delivered', deliveredAt: new Date() } });
      expect((await up(load, bearer(carrier), { stage: 'pickup' })).status).toBe(409);
      expect((await up(load, bearer(carrier), { stage: 'delivery' })).status).toBe(201);
      await Load.updateOne({ _id: load._id }, { $set: { deliveredAt: new Date(Date.now() - 25 * 3600 * 1000) } });
      expect((await up(load, bearer(carrier), { stage: 'delivery' })).status).toBe(409);
      expect((await up(load, bearer(carrier), { stage: 'nope' })).status).toBe(400);
    });

    test('rejects non-image, svg, fake .jpg, oversize; nothing left on disk', async () => {
      const { carrier, load } = await setup();
      const bad = [
        { file: Buffer.from('%PDF-1.4 hello world!'), name: 'a.pdf', type: 'application/pdf' },
        { file: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), name: 'a.svg', type: 'image/svg+xml' },
        { file: Buffer.from('<html><script>alert(1)</script></html>'), name: 'a.jpg', type: 'image/jpeg' },
        { file: PNG, name: 'a.jpg', type: 'image/jpeg' }, // bytes are PNG, declared JPEG
        { file: PNG, name: 'a.html', type: 'image/png' },
        { file: Buffer.concat([JPG, Buffer.alloc(10 * 1024 * 1024)]), name: 'big.jpg', type: 'image/jpeg' },
      ];
      for (const b of bad) {
        const r = await up(load, bearer(carrier), b);
        expect([400, 413]).toContain(r.status);
      }
      expect((await up(load, bearer(carrier), { file: null })).status).toBe(400);
      expect(await evidenceOf(load._id)).toHaveLength(0);
      expect([...filesNow()].filter((f) => !before.has(f))).toEqual([]);
    });

    test('31st photo refused and nothing written', async () => {
      const { carrier, load } = await setup();
      const items = Array.from({ length: 30 }, (_, i) => ({ stage: 'pickup', kind: 'cargo', file: `x${i}.png`, companyId: carrier._id }));
      await Load.updateOne({ _id: load._id }, { $set: { evidence: items } });
      const r = await up(load, bearer(carrier));
      expect(r.status).toBe(409);
      expect(r.body.error).toMatch(/limit/i);
      expect([...filesNow()].filter((f) => !before.has(f))).toEqual([]);
    });

    test('future or stale capturedAt is dropped to null, recent one kept; bad fields rejected', async () => {
      const { carrier, load } = await setup();
      const future = await up(load, bearer(carrier), { fields: { capturedAt: new Date(Date.now() + 3600e3).toISOString() } }).expect(201);
      expect(future.body.data.capturedAt).toBeNull();
      const stale = await up(load, bearer(carrier), { fields: { capturedAt: new Date(Date.now() - 48 * 3600e3).toISOString() } }).expect(201);
      expect(stale.body.data.capturedAt).toBeNull();
      const ok = await up(load, bearer(carrier), { fields: { capturedAt: new Date(Date.now() - 60e3).toISOString() } }).expect(201);
      expect(ok.body.data.capturedAt).toBeTruthy();
      expect((await up(load, bearer(carrier), { fields: { latitude: 120, longitude: 0 } })).status).toBe(400);
      expect((await up(load, bearer(carrier), { fields: { sealNumber: 'x'.repeat(41) } })).status).toBe(400);
      expect((await up(load, bearer(carrier), { fields: { note: 'x'.repeat(301) } })).status).toBe(400);
      expect((await up(load, bearer(carrier), { fields: { kind: 'selfie' } })).status).toBe(400);
    });
  });

  describe('read', () => {
    test('parties get list and bytes with safe headers; others cannot; traversal rejected', async () => {
      const { shipper, carrier, load } = await setup();
      const admin = await createTestUser({ role: 'admin' });
      const stranger = await createTestUser({ role: 'shipper' });
      const otherCarrier = await createTestUser({ role: 'carrier' });
      const created = await up(load, bearer(carrier)).expect(201);
      const id = created.body.data._id;
      const url = `/api/loads/${load._id}/evidence/${id}/file`;

      for (const who of [shipper, carrier, admin]) {
        const f = await request(app).get(url).set(bearer(who)).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
        expect(f.status).toBe(200);
        expect(f.headers['content-type']).toMatch(/^image\/png/);
        expect(f.headers['x-content-type-options']).toBe('nosniff');
        expect(f.headers['content-disposition']).toMatch(/^inline; filename="evidence-[a-f0-9]{24}\.png"$/);
        expect(f.headers['cache-control']).toMatch(/private/);
        expect(Buffer.compare(f.body, PNG)).toBe(0);
        const l = await request(app).get(`/api/loads/${load._id}/evidence`).set(bearer(who)).expect(200);
        expect(l.body.data.items).toHaveLength(1);
        expect(l.body.data.items[0].file).toBeUndefined();
      }
      for (const who of [stranger, otherCarrier]) {
        expect((await request(app).get(url).set(bearer(who))).status).toBe(403);
        expect((await request(app).get(`/api/loads/${load._id}/evidence`).set(bearer(who))).status).toBe(403);
      }
      expect((await request(app).get(url)).status).toBe(401);
      const trav = await request(app).get(`/api/loads/${load._id}/evidence/..%2F..%2F..%2Fpackage.json/file`).set(bearer(shipper));
      expect(trav.status).toBe(400);
      expect((await request(app).get(`/api/loads/${load._id}/evidence/${'a'.repeat(24)}/file`).set(bearer(shipper))).status).toBe(404);
      // A stored path tampered to traverse still resolves only inside the evidence dir.
      await Load.updateOne({ _id: load._id, 'evidence._id': id }, { $set: { 'evidence.$.file': '../../../package.json' } });
      expect((await request(app).get(url).set(bearer(shipper))).status).toBe(404);
    });

    test('evidence dir is not under any express.static mount in app.js, and has an explicit 404', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8');
      const roots = [...src.matchAll(/express\.static\(([^,)]+)/g)].map((m) => m[1]);
      expect(roots.length).toBeGreaterThan(0);
      for (const r of roots) expect(r).not.toMatch(/load-evidence/);
      // no mount serves the whole documents/ or public/ tree
      for (const r of roots) expect(r).not.toMatch(/documents['"]\)?\s*$|public['"]\)?\s*$/);
      expect(src).toMatch(/app\.use\('\/documents\/load-evidence', \(req, res\) => res\.status\(404\)/);
      expect(PRIVATE_DIR.replace(/\\/g, '/')).toMatch(/public\/documents\/load-evidence$/);
    });
  });

  describe('delete (immutability)', () => {
    test('uploader company deletes within 10 minutes; file removed; audited', async () => {
      const { carrier, load } = await setup();
      const driver = await createTestUser({ role: 'carrier', parentAccountId: carrier._id });
      const c = await up(load, subToken(driver, carrier, 'driver')).expect(201);
      const [ev] = await evidenceOf(load._id);
      expect(fs.existsSync(path.join(PRIVATE_DIR, ev.file))).toBe(true);
      expect(c.body.data.deletable).toBe(true);
      await request(app).delete(`/api/loads/${load._id}/evidence/${ev._id}`).set(bearer(carrier)).expect(200);
      expect(fs.existsSync(path.join(PRIVATE_DIR, ev.file))).toBe(false);
      expect(await evidenceOf(load._id)).toHaveLength(0);
      expect(await StatusHistory.countDocuments({ entityId: load._id, toStatus: 'evidence_removed' })).toBe(1);
    });

    test('refused after 10 minutes, after stage change, by shipper, by admin, by another carrier', async () => {
      const { shipper, carrier, load } = await setup();
      const admin = await createTestUser({ role: 'admin' });
      const other = await createTestUser({ role: 'carrier' });
      await up(load, bearer(carrier)).expect(201);
      const [ev] = await evidenceOf(load._id);
      const del = (who) => request(app).delete(`/api/loads/${load._id}/evidence/${ev._id}`).set(who);
      expect((await del(bearer(shipper))).status).toBe(403);
      expect((await del(bearer(admin))).status).toBe(403);
      expect((await del(bearer(other))).status).toBe(403);
      await Load.updateOne({ _id: load._id }, { $set: { status: 'in-transit' } });
      expect((await del(bearer(carrier))).status).toBe(403); // pickup photo, load left pickup stage
      await Load.updateOne({ _id: load._id }, { $set: { status: 'accepted' } });
      await Load.updateOne({ _id: load._id, 'evidence._id': ev._id }, { $set: { 'evidence.$.uploadedAt': new Date(Date.now() - 11 * 60e3) } });
      expect((await del(bearer(carrier))).status).toBe(403);
      expect(await evidenceOf(load._id)).toHaveLength(1);
      expect(fs.existsSync(path.join(PRIVATE_DIR, ev.file))).toBe(true);
      // delivery photo: not deletable once delivered
      await Load.updateOne({ _id: load._id }, { $set: { status: 'in-transit' } });
      const d = await up(load, bearer(carrier), { stage: 'delivery' }).expect(201);
      await Load.updateOne({ _id: load._id }, { $set: { status: 'delivered', deliveredAt: new Date() } });
      expect((await request(app).delete(`/api/loads/${load._id}/evidence/${d.body.data._id}`).set(bearer(carrier))).status).toBe(403);
    });
  });

  describe('requirement gate', () => {
    const status = (load, who, s) => request(app).put(`/api/loads/${load._id}/status`).set(who).send({ status: s });

    test('required pickup photos block in-transit and pickup signature until a cargo/seal photo exists', async () => {
      const { carrier, load } = await setup({ evidenceRequired: { pickup: true, delivery: false } });
      const blocked = await status(load, bearer(carrier), 'in-transit');
      expect(blocked.status).toBe(409);
      expect(blocked.body.reason).toBe('pickup_photos_required');
      const sig = await request(app).post(`/api/documents/${load._id}/pickup-signature`).set(bearer(carrier)).send({ dataUrl: SIG });
      expect(sig.status).toBe(409);
      expect(sig.body.reason).toBe('pickup_photos_required');
      // paperwork photo alone does not satisfy it
      await up(load, bearer(carrier), { fields: { kind: 'paperwork' } }).expect(201);
      expect((await status(load, bearer(carrier), 'in-transit')).status).toBe(409);
      await up(load, bearer(carrier), { fields: { kind: 'cargo' } }).expect(201);
      expect((await status(load, bearer(carrier), 'in-transit')).status).toBe(200);
    });

    test('pickup signature allowed once photos exist', async () => {
      const { carrier, load } = await setup({ evidenceRequired: { pickup: true, delivery: false } });
      await up(load, bearer(carrier), { fields: { kind: 'seal' } }).expect(201);
      const sig = await request(app).post(`/api/documents/${load._id}/pickup-signature`).set(bearer(carrier)).send({ dataUrl: SIG });
      expect(sig.status).toBe(200);
    });

    test('fleet deliver is blocked by missing pickup then delivery photos', async () => {
      const { carrier, load } = await setup({ evidenceRequired: { pickup: true, delivery: true } });
      const deliver = () => request(app).put('/api/users/fleet/T1/deliver').set(bearer(carrier));
      expect((await deliver()).body.reason).toBe('pickup_photos_required');
      await up(load, bearer(carrier)).expect(201);
      expect((await deliver()).body.reason).toBe('delivery_photos_required');
      await Load.updateOne({ _id: load._id }, { $set: { status: 'in-transit' } });
      await up(load, bearer(carrier), { stage: 'delivery' }).expect(201);
      expect((await deliver()).status).toBe(200);
      expect((await Load.findById(load._id)).status).toBe('delivered');
    });

    test('required delivery photos block delivered via /status and /deliver', async () => {
      const { carrier, load } = await setup({ status: 'in-transit', evidenceRequired: { pickup: false, delivery: true } });
      const b1 = await status(load, bearer(carrier), 'delivered');
      expect(b1.status).toBe(409);
      expect(b1.body.reason).toBe('delivery_photos_required');
      const b2 = await request(app).put(`/api/loads/${load._id}/deliver`).set(bearer(carrier));
      expect(b2.body.reason).toBe('delivery_photos_required');
      await up(load, bearer(carrier), { stage: 'delivery' }).expect(201);
      expect((await status(load, bearer(carrier), 'delivered')).status).toBe(200);
    });

    test('shipper sets requirements at posting; can change while open; cannot switch off once booked; admin can', async () => {
      const shipper = await createTestUser({ role: 'shipper', companyName: 'S', shipperVerification: { paymentMethodVerified: true } });
      const admin = await createTestUser({ role: 'admin' });
      const carrier = await createTestUser({ role: 'carrier' });
      const base = { title: 't', origin: 'Chicago, IL', destination: 'Dallas, TX', rate: 1000, equipmentType: 'Dry Van', originLat: 1, originLng: 1, destinationLat: 2, destinationLng: 2 };
      const posted = await request(app).post('/api/loads').set(bearer(shipper)).send({ ...base, requirePickupPhotos: true, requireDeliveryPhotos: 'true' });
      expect(posted.status).toBe(201);
      expect(posted.body.evidenceRequired).toEqual({ pickup: true, delivery: true });
      expect((await request(app).post('/api/loads').set(bearer(shipper)).send({ ...base, requirePickupPhotos: 'maybe' })).status).toBe(400);

      const id = posted.body._id;
      const put = (who, b) => request(app).put(`/api/loads/${id}/evidence-required`).set(who).send(b);
      expect((await put(bearer(shipper), { pickup: false })).body.data).toEqual({ pickup: false, delivery: true });
      expect((await put(bearer(shipper), { pickup: true })).body.data.pickup).toBe(true);
      expect((await put(bearer(carrier), { pickup: false })).status).toBe(403);
      await Load.updateOne({ _id: id }, { $set: { status: 'accepted', acceptedBy: carrier._id } });
      const off = await put(bearer(shipper), { delivery: false });
      expect(off.status).toBe(403);
      expect((await put(bearer(shipper), { delivery: true })).status).toBe(200);
      expect((await put(bearer(admin), { delivery: false })).body.data.delivery).toBe(false);
      expect((await put(bearer(admin), { delivery: 'no' })).status).toBe(400);
    });
  });
});
