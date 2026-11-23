/** Integration: public contact form delivers to admins, validates input, ignores bots. */
require('../setup');
const express = require('express');
const request = require('supertest');
const Notification = require('../../models/Notification');
const { createTestUser } = require('../helpers');

const app = express();
app.use(express.json());
app.use('/api/contact', require('../../routes/contactRoutes'));
const ok = { name: 'Dana', email: 'dana@example.com', message: 'I would like to try the platform.' };

test('contact form: delivered to admins as plain text; bad input and bots deliver nothing', async () => {
  const admin = await createTestUser({ role: 'admin' });
  await createTestUser({ role: 'carrier' });
  for (const bad of [{ ...ok, email: 'nope' }, { ...ok, name: { $gt: '' } }, { ...ok, message: 'x'.repeat(2001) }]) {
    expect((await request(app).post('/api/contact').send(bad)).status).toBe(400);
  }
  expect((await request(app).post('/api/contact').send({ ...ok, website: 'http://spam' })).body).toEqual({ success: true });
  expect(await Notification.countDocuments({})).toBe(0);

  const r = await request(app).post('/api/contact').send({ ...ok, message: 'Hello <script>alert(1)</script> there' });
  expect(r.body).toEqual({ success: true });
  const n = await Notification.find({}).lean();
  expect(n).toHaveLength(1);
  expect(String(n[0].userId)).toBe(String(admin._id));
  expect(n[0].body).toContain('dana@example.com');
  expect(n[0].body).not.toMatch(/[<>]/);

  // 5 an hour per address, every attempt counted: the 6th is refused
  expect((await request(app).post('/api/contact').send(ok)).status).toBe(429);
});
