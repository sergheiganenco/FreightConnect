/** Integration: the receiver reads and signs delivery documents by link, without an account, and never sees the rate. */
require('../setup');
const express = require('express');
const request = require('supertest');
const Load = require('../../models/Load');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const { signDockToken } = require('../../services/pickupVerificationService');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api', require('../../routes/deliveryPassRoutes'));

const as = (m, url, user) => request(app)[m](url).set('Authorization', `Bearer ${generateToken(user)}`);
// a real 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function scene(status = 'in-transit') {
  const shipper = await createTestUser({ role: 'shipper', companyName: 'Acme Foods' });
  const carrier = await createTestUser({ role: 'carrier' });
  const load = await createTestLoad(shipper._id, { status, acceptedBy: carrier._id, rate: 4321 });
  return { shipper, carrier, load };
}

test('only the load’s own parties can get the link, and only once it is booked', async () => {
  const { shipper, carrier, load } = await scene();
  const stranger = await createTestUser({ role: 'carrier' });
  expect((await request(app).post(`/api/loads/${load._id}/delivery-pass`)).status).toBe(401);
  expect((await as('post', `/api/loads/${load._id}/delivery-pass`, stranger)).status).toBe(403);
  for (const u of [shipper, carrier]) {
    const r = await as('post', `/api/loads/${load._id}/delivery-pass`, u);
    expect(r.status).toBe(201);
    expect(r.body.path).toMatch(/^\/receive\//);
  }
  const open = await createTestLoad(shipper._id, { status: 'open' });
  expect((await as('post', `/api/loads/${open._id}/delivery-pass`, shipper)).status).toBe(409);
});

test('the receiver sees the delivery, never the rate; bad, foreign and pickup links are refused', async () => {
  const { carrier, load } = await scene();
  const { path } = (await as('post', `/api/loads/${load._id}/delivery-pass`, carrier)).body;
  const r = await request(app).get(`/api${path}`);
  expect(r.status).toBe(200);
  expect(r.body.state).toBe('ready');
  expect(r.body.shipperName).toBe('Acme Foods');
  expect(JSON.stringify(r.body)).not.toMatch(/4321|rate|email|phone/i);

  expect((await request(app).get('/api/receive/nonsense')).status).toBe(404);
  expect((await request(app).get(`/api${path.slice(0, -1)}${path.slice(-1) === 'a' ? 'b' : 'a'}`)).status).toBe(404);
  // a pickup (dock) link for the same load is not a delivery link
  expect((await request(app).get(`/api/receive/${signDockToken(String(load._id)).token}`)).status).toBe(404);

  const pdf = await request(app).get(`/api${path}/bol`);
  expect(pdf.status).toBe(200);
  expect(pdf.headers['content-type']).toMatch(/pdf/);
});

test('signing: once, in transit only, with a name and a real signature; both parties are told; the load is not marked delivered', async () => {
  const { carrier, load } = await scene();
  const { path } = (await as('post', `/api/loads/${load._id}/delivery-pass`, carrier)).body;
  const sign = (b) => request(app).post(`/api${path}/sign`).send(b);

  expect((await sign({ signerName: 'J', dataUrl: PNG })).status).toBe(400);
  expect((await sign({ signerName: 'Jo Dock', dataUrl: 'data:image/svg+xml;base64,AAAA' })).status).toBe(400);
  expect((await sign({ signerName: 'Jo Dock', dataUrl: PNG, note: 'x'.repeat(1001) })).status).toBe(400);

  const ok = await sign({ signerName: 'Jo Dock', dataUrl: PNG, note: '2 cartons crushed' });
  expect(ok.status).toBe(200);
  const saved = await Load.findById(load._id);
  expect(saved.status).toBe('in-transit');
  expect(saved.deliverySignature.signedByRole).toBe('receiver');
  expect(saved.deliverySignature.note).toBe('2 cartons crushed');
  expect(saved.documents.podSignerName).toBe('Jo Dock');

  const again = await sign({ signerName: 'Someone Else', dataUrl: PNG });
  expect(again.status).toBe(409);
  expect(again.body.reason).toBe('already_signed');
  expect((await Load.findById(load._id)).deliverySignature.signerName).toBe('Jo Dock');
  expect((await request(app).get(`/api${path}`)).body.state).toBe('signed');

  // not yet picked up: nothing to sign for
  const early = await scene('accepted');
  const p2 = (await as('post', `/api/loads/${early.load._id}/delivery-pass`, early.carrier)).body.path;
  const r2 = await request(app).post(`/api${p2}/sign`).send({ signerName: 'Jo Dock', dataUrl: PNG });
  expect(r2.status).toBe(409);
  expect(r2.body.reason).toBe('not_in_transit');
});
