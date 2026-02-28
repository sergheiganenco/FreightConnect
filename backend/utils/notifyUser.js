/**
 * notifyUser — unified notification utility
 *
 * Creates a persisted Notification document AND emits a real-time
 * socket event to the user's personal room (user_${userId}).
 *
 * Usage:
 *   await notifyUser(userId, {
 *     type: 'bid:accepted',
 *     title: 'Your bid was accepted!',
 *     body: 'Load: Chicago → Dallas · $2,400',
 *     link: '/dashboard/carrier/my-loads',
 *     metadata: { loadId, bidId },
 *   });
 *
 * This is fire-and-forget safe — wrap the call in try/catch at the
 * call site, or use notifyUserSafe() which swallows errors silently.
 */

const Notification = require('../models/Notification');
const { getIO } = require('./socket');

async function notifyUser(userId, { type, title, body = '', link = null, metadata = {} }) {
  if (!userId) return null;

  const notification = await Notification.create({
    userId,
    type,
    title,
    body,
    link,
    metadata,
  });

  // Real-time push to the user's personal socket room
  try {
    getIO().to(`user_${userId}`).emit('notification:new', {
      _id: notification._id,
      type,
      title,
      body,
      link,
      metadata,
      read: false,
      createdAt: notification.createdAt,
    });
  } catch (_) { /* socket not available — notification still persisted */ }

  return notification;
}

/**
 * Silent variant — never throws. Use in non-critical paths (e.g. fire-and-forget inside routes).
 */
async function notifyUserSafe(userId, payload) {
  try {
    return await notifyUser(userId, payload);
  } catch (err) {
    console.error('[notifyUser] Failed:', err.message);
    return null;
  }
}

module.exports = { notifyUser, notifyUserSafe };
