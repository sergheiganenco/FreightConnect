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
  expect((await request(app).get(`/api/receive/${signDockToken(String(load._id), 'receive').token}`)).status).toBe(404); // not bound to the booking

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

test('a link dies when the load is rebooked; a later upload cannot replace the receiver’s signature or note', async () => {
  const { carrier, load } = await scene();
  const { path } = (await as('post', `/api/loads/${load._id}/delivery-pass`, carrier)).body;
  await request(app).post(`/api${path}/sign`).send({ signerName: 'Jo Dock', dataUrl: PNG, note: 'crushed corner' });

  // the driver uploads a proof-of-delivery with its own signature afterwards
  const docs = express();
  docs.use(express.json({ limit: '1mb' }));
  docs.use('/api/documents', require('../../routes/documentRoutes'));
  const up = await request(docs).post(`/api/documents/pod/${load._id}`).set('Authorization', `Bearer ${generateToken(carrier)}`)
    .field('signerName', 'Driver Typed').field('signatureData', PNG).attach('file', Buffer.from('%PDF-1.4 x'), 'pod.pdf');
  expect(up.status).toBe(200);
  const saved = await Load.findById(load._id);
  expect(saved.documents.pod).toBeTruthy();
  expect(saved.deliverySignature.signedByRole).toBe('receiver');
  expect(saved.deliverySignature.signerName).toBe('Jo Dock');
  expect(saved.deliverySignature.note).toBe('crushed corner');
  expect(saved.documents.podSignerName).toBe('Jo Dock');

  // rebooked to another carrier: the old link no longer opens anything
  const other = await createTestUser({ role: 'carrier' });
  await Load.updateOne({ _id: load._id }, { $set: { acceptedBy: other._id } });
  expect((await request(app).get(`/api${path}`)).status).toBe(404);
  expect((await request(app).get(`/api${path}/bol`)).status).toBe(404);
  await Load.updateOne({ _id: load._id }, { $set: { acceptedBy: null, status: 'open' } });
  expect((await request(app).get(`/api${path}`)).status).toBe(404);
});

test('receiver photos: real images only, in transit and before signing, capped; both parties see them, nobody can delete them', async () => {
  const fs = require('fs');
  const path = require('path');
  const evApp = express();
  evApp.use(express.json());
  evApp.use('/api', require('../../routes/evidenceRoutes'));
  const { PRIVATE_DIR } = require('../../routes/evidenceRoutes');
  const { shipper, carrier, load } = await scene('in-transit');
  const outsider = await createTestUser({ role: 'carrier' });
  const { token } = signDockToken(String(load._id), `receive:${carrier._id}`, 60000);
  const png = Buffer.from(PNG.split(',')[1], 'base64');
  const send = (t, buf = png, name = 'dent.png', type = 'image/png') => request(app).post(`/api/receive/${t}/photo`).attach('file', buf, { filename: name, contentType: type });

  expect((await send('bad.token.here')).status).toBe(404);                                   // no live link: the file is never read
  expect((await send(token, Buffer.from('<html><script>1</script></html>'), 'x.png')).status).toBe(400); // lies about its type
  expect((await send(token, Buffer.from('%PDF-1.4 ...........'), 'x.pdf', 'application/pdf')).status).toBe(400);

  const ok = await send(token);
  expect(ok.status).toBe(201);
  expect(ok.body.photoCount).toBe(1);
  expect((await request(app).get(`/api/receive/${token}`)).body.photoCount).toBe(1);

  const stored = (await Load.findById(load._id).select('+evidence')).evidence[0];
  expect(stored).toMatchObject({ stage: 'delivery', kind: 'damage', mimeType: 'image/png' });
  expect(String(stored.receiverFor)).toBe(String(carrier._id));
  expect(stored.file).toMatch(/^[a-f0-9]{32}\.png$/);                                         // our name, never the sender's
  expect(fs.existsSync(path.join(PRIVATE_DIR, stored.file))).toBe(true);

  // shipper and the booked carrier see it, marked as the receiver's; another carrier does not
  for (const u of [shipper, carrier]) {
    const list = await request(evApp).get(`/api/loads/${load._id}/evidence`).set('Authorization', `Bearer ${generateToken(u)}`);
    expect(list.body.data.items[0]).toMatchObject({ byReceiver: true, uploadedByName: 'the receiver', deletable: false });
    expect(list.body.data.items[0].file).toBeUndefined();
    expect((await request(evApp).get(`/api/loads/${load._id}/evidence/${stored._id}/file`).set('Authorization', `Bearer ${generateToken(u)}`)).status).toBe(200);
  }
  expect((await request(evApp).get(`/api/loads/${load._id}/evidence`).set('Authorization', `Bearer ${generateToken(outsider)}`)).status).toBe(403);
  expect((await request(evApp).delete(`/api/loads/${load._id}/evidence/${stored._id}`).set('Authorization', `Bearer ${generateToken(carrier)}`)).status).toBe(403);

  // capped at 6
  for (let i = 0; i < 5; i += 1) expect((await send(token)).status).toBe(201);
  expect((await send(token)).status).toBe(409);

  // signing tells both parties about the photos, then locks them
  const signed = await request(app).post(`/api/receive/${token}/sign`).send({ signerName: 'Dana Dock', dataUrl: PNG });
  expect(signed.status).toBe(200);
  expect((await send(token)).status).toBe(409);
  for (const f of (await Load.findById(load._id).select('+evidence')).evidence) fs.unlinkSync(path.join(PRIVATE_DIR, f.file));

  // not out for delivery: refused
  const early = await scene('accepted');
  const t2 = signDockToken(String(early.load._id), `receive:${early.carrier._id}`, 60000).token;
  expect((await send(t2)).status).toBe(409);
});
