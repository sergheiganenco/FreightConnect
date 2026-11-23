/** Integration: the admin system-status report is admin-only, never leaks a secret, and tells the truth about storage. */
require('../setup');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { createTestUser, generateToken } = require('../helpers');
const { getSystemStatus, storageStatus } = require('../../services/systemStatus');

const app = express();
app.use(express.json());
app.use('/api/admin', require('../../routes/adminRoutes'));
const as = (user) => request(app).get('/api/admin/system-status').set('Authorization', `Bearer ${generateToken(user)}`);

test('admins only; values of secrets never appear', async () => {
  const env = { ...process.env };
  process.env.FMCSA_API_KEY = 'super-secret-value-123';
  try {
    expect((await request(app).get('/api/admin/system-status')).status).toBe(401);
    expect((await as(await createTestUser({ role: 'carrier' }))).status).toBe(403);
    const r = await as(await createTestUser({ role: 'admin' }));
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain('super-secret-value-123');
    expect(r.body.connections.find((c) => c.key === 'carrierLookup').on).toBe(true);
  } finally { process.env = env; }
});

test('a critical connection that is off is reported as a problem', () => {
  const s = getSystemStatus({ FMCSA_API_KEY: 'x' });
  expect(s.ok).toBe(false);
  expect(s.problems.join(' ')).toMatch(/Email is off/);
  expect(s.problems.join(' ')).not.toMatch(/Payments/); // off by choice until Stripe is ready
  expect(s.connections.find((c) => c.key === 'payments').on).toBe(false);
});

test('storage: unknown on first start, proven after a restart, failing when the folder cannot be written', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-status-'));
  const marker = path.join(dir, '.storage-marker');
  const t0 = Date.now();
  expect(storageStatus({ dir, marker, now: t0, started: t0 })).toEqual({ writable: true, survivesRestart: null });
  expect(storageStatus({ dir, marker, now: t0 + 60000, started: t0 + 60000 })).toEqual({ writable: true, survivesRestart: true });
  const file = path.join(dir, 'not-a-folder'); fs.writeFileSync(file, 'x');
  expect(storageStatus({ dir: path.join(file, 'sub'), marker: path.join(file, 'sub', 'm') })).toEqual({ writable: false, survivesRestart: false });
});
