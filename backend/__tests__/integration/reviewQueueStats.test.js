/** GET /review-queue/stats counts all types by default and one type with ?type=. */
require('../setup');
const express = require('express');
const request = require('supertest');
const ReviewQueue = require('../../models/ReviewQueue');
const { createTestUser, generateToken } = require('../helpers');

const app = express();
app.use(express.json());
app.use('/api/review-queue', require('../../routes/reviewQueueRoutes'));

test('stats can be limited to one review type', async () => {
  const admin = await createTestUser({ role: 'admin' });
  const carrier = await createTestUser({ role: 'carrier' });
  const base = { subjectUser: carrier._id, reason: 'r', recommendedAction: 'manual_review' };
  await ReviewQueue.create([{ ...base, type: 'pickup_no_show' }, { ...base, type: 'carrier_suspension' }, { ...base, type: 'carrier_suspension', status: 'dismissed' }]);
  const get = (q = '') => request(app).get(`/api/review-queue/stats${q}`).set('Authorization', `Bearer ${generateToken(admin)}`);
  expect((await get()).body.data).toEqual({ pending: 2, approved: 0, dismissed: 1 });
  expect((await get('?type=pickup_no_show')).body.data).toEqual({ pending: 1, approved: 0, dismissed: 0 });
});
