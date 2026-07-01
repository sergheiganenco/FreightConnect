/**
 * Dispute evidence — evidenceUrls threaded through the dispute filing, plus a
 * file-upload endpoint that appends evidence (party/admin only).
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const { createTestUser, createTestLoad, generateToken } = require('../helpers');
const Exception = require('../../models/Exception');

const io = { to: () => ({ emit: () => {} }) };
const loadRoutes = require('../../routes/loadRoutes')(io);
const exceptionRoutes = require('../../routes/exceptionRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loads', loadRoutes);
  app.use('/api/exceptions', exceptionRoutes);
  return app;
}

async function inTransitLoad() {
  const shipper = await createTestUser({ role: 'shipper' });
  const carrier = await createTestUser({ role: 'carrier' });
  const load = await createTestLoad(shipper._id, { status: 'in-transit', acceptedBy: carrier._id });
  return { shipper, carrier, load };
}

describe('Dispute evidence', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('filing a dispute with evidenceUrls stores them on the Exception', async () => {
    const { shipper, load } = await inTransitLoad();
    const res = await request(app)
      .put(`/api/loads/${load._id}/dispute`)
      .set('Authorization', `Bearer ${generateToken(shipper)}`)
      .send({ reason: 'damaged', type: 'cargo_damage', evidenceUrls: ['/documents/evidence/a.jpg', '/documents/evidence/b.pdf'] });
    expect(res.status).toBe(200);
    const ex = await Exception.findOne({ loadId: load._id });
    expect(ex.evidenceUrls).toEqual(['/documents/evidence/a.jpg', '/documents/evidence/b.pdf']);
  });

  test('a party can upload evidence files → URLs appended', async () => {
    const { shipper, load } = await inTransitLoad();
    const ex = await Exception.create({ loadId: load._id, filedBy: shipper._id, filedByRole: 'shipper', type: 'dispute', title: 'x', description: 'y', status: 'open' });
    const res = await request(app)
      .post(`/api/exceptions/${ex._id}/evidence`)
      .set('Authorization', `Bearer ${generateToken(shipper)}`)
      .attach('files', Buffer.from('fake image bytes'), { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(res.body.evidenceUrls).toHaveLength(1);
    expect(res.body.evidenceUrls[0]).toMatch(/\/documents\/evidence\/ev-/);
  });

  test('a non-party cannot upload evidence (403)', async () => {
    const { shipper, load } = await inTransitLoad();
    const ex = await Exception.create({ loadId: load._id, filedBy: shipper._id, filedByRole: 'shipper', type: 'dispute', title: 'x', description: 'y', status: 'open' });
    const stranger = await createTestUser({ role: 'carrier' });
    const res = await request(app)
      .post(`/api/exceptions/${ex._id}/evidence`)
      .set('Authorization', `Bearer ${generateToken(stranger)}`)
      .attach('files', Buffer.from('x'), { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(403);
  });
});
