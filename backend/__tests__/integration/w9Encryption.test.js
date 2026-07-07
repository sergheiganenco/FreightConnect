/**
 * Integration: W-9 EIN is encrypted at rest and never returned in full.
 */

require('../setup');
const express = require('express');
const request = require('supertest');
const TaxRecord = require('../../models/TaxRecord');
const { createTestUser, generateToken } = require('../helpers');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tax', require('../../routes/taxRoutes'));
  return app;
}

describe('W-9 EIN encryption', () => {
  let app, carrier, token;

  beforeEach(async () => {
    app = buildApp();
    carrier = await createTestUser({ role: 'carrier' });
    token = generateToken(carrier);
  });

  test('submitting a W-9 stores the EIN encrypted, and reads back masked', async () => {
    const res = await request(app)
      .post('/api/tax/w9')
      .set('Authorization', `Bearer ${token}`)
      .send({ legalName: 'Acme LLC', taxClassification: 'llc_single', ein: '12-3456789' });
    expect(res.status).toBe(200);

    // At rest: the stored EIN is ciphertext, not the plaintext TIN.
    const year = new Date().getFullYear();
    const record = await TaxRecord.findOne({ user: carrier._id, taxYear: year });
    expect(record.w9.ein.startsWith('enc:v1:')).toBe(true);
    expect(record.w9.ein).not.toContain('3456789');

    // Over the API: masked to the last 4 — never the full TIN, never the ciphertext.
    const read = await request(app).get('/api/tax/w9').set('Authorization', `Bearer ${token}`);
    expect(read.status).toBe(200);
    expect(read.body.w9.ein).toBe('**-***6789');
    expect(read.body.w9.ein).not.toContain('enc:v1:');
  });
});
