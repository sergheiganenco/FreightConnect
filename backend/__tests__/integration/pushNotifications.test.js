/**
 * Integration: remote push registration + delivery wiring.
 *
 * The audit found the mobile push token was fetched but never stored or used.
 * These cover the backend half: registering/unregistering a device token and
 * that notifyUser fans out a push to a user's stored Expo tokens (Expo API mocked).
 */

require('../setup');
const express = require('express');
const request = require('supertest');
const axios = require('axios');
const User = require('../../models/User');
const { createTestUser, generateToken } = require('../helpers');

jest.mock('axios');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/users', require('../../routes/userRoutes'));
  return app;
}

const EXPO_TOKEN = 'ExponentPushToken[abc123]';

describe('push notifications', () => {
  let app, user, token;

  beforeEach(async () => {
    jest.clearAllMocks();
    app = buildApp();
    user = await createTestUser({ role: 'carrier' });
    token = generateToken(user);
  });

  test('registering a device token stores it (deduped)', async () => {
    await request(app).post('/api/users/push-token').set('Authorization', `Bearer ${token}`).send({ token: EXPO_TOKEN });
    // Registering the same token twice must not duplicate it.
    await request(app).post('/api/users/push-token').set('Authorization', `Bearer ${token}`).send({ token: EXPO_TOKEN });

    const fresh = await User.findById(user._id);
    expect(fresh.pushTokens).toEqual([EXPO_TOKEN]);
  });

  test('unregistering removes the token', async () => {
    await request(app).post('/api/users/push-token').set('Authorization', `Bearer ${token}`).send({ token: EXPO_TOKEN });
    await request(app).delete('/api/users/push-token').set('Authorization', `Bearer ${token}`).send({ token: EXPO_TOKEN });

    const fresh = await User.findById(user._id);
    expect(fresh.pushTokens).toEqual([]);
  });

  test('registering requires a token', async () => {
    const res = await request(app).post('/api/users/push-token').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });

  test('notifyUser sends an Expo push to the user\'s stored tokens', async () => {
    axios.post.mockResolvedValue({ data: { data: [{ status: 'ok' }] } });
    await User.updateOne({ _id: user._id }, { $set: { pushTokens: [EXPO_TOKEN] } });

    const { sendPushToUser } = require('../../services/pushService');
    await sendPushToUser(user._id, { title: 'Load booked', body: 'Chicago → Dallas' });

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, messages] = axios.post.mock.calls[0];
    expect(url).toContain('exp.host');
    expect(messages[0].to).toBe(EXPO_TOKEN);
    expect(messages[0].title).toBe('Load booked');
  });

  test('a user with no tokens triggers no push (and never throws)', async () => {
    const { sendPushToUser } = require('../../services/pushService');
    await expect(sendPushToUser(user._id, { title: 'x' })).resolves.toBeUndefined();
    expect(axios.post).not.toHaveBeenCalled();
  });
});
