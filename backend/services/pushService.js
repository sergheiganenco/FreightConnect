/**
 * pushService — send remote push notifications to a user's devices via the
 * Expo Push API (https://exp.host/--/api/v2/push/send).
 *
 * The Expo push endpoint needs no credentials for basic sends, so this works
 * without any extra secrets. All calls are fire-and-forget safe — they never
 * throw, so a push failure can't break the notification that triggered it.
 */

const axios = require('axios');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// Expo tokens look like ExponentPushToken[xxxxxxxx]. Filter out anything else
// (e.g. stray FCM tokens) so we never send a malformed request.
function isExpoToken(t) {
  return typeof t === 'string' && t.startsWith('ExponentPushToken');
}

/**
 * Send a push to every valid Expo token for a user. Never throws.
 * @param {string} userId
 * @param {{ title: string, body?: string, data?: object }} payload
 */
async function sendPushToUser(userId, { title, body = '', data = {} } = {}) {
  try {
    if (!userId || !title) return;
    const User = require('../models/User');
    const user = await User.findById(userId).select('pushTokens').lean();
    const tokens = (user?.pushTokens || []).filter(isExpoToken);
    if (tokens.length === 0) return;

    const messages = tokens.map((to) => ({
      to,
      title,
      body,
      data,
      sound: 'default',
      channelId: 'default',
    }));

    await axios.post(EXPO_PUSH_URL, messages, {
      timeout: 8000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
  } catch (err) {
    console.error('[pushService] send failed (non-fatal):', err.message);
  }
}

module.exports = { sendPushToUser, isExpoToken };
