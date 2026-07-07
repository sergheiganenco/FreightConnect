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

  // Real-time push to the user's personal socket room (app open / web)
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

  // Remote push to the user's mobile devices (app closed). Detached + never
  // throws, so it can't affect the persisted notification or the caller.
  try {
    const { sendPushToUser } = require('../services/pushService');
    sendPushToUser(userId, { title, body, data: { link, type, ...metadata } });
  } catch (_) { /* pushService unavailable — socket + DB notification still delivered */ }

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

/**
 * Notify ALL admin users. Resolves real admin accounts (the literal string
 * 'admin' is NOT a valid userId). Fire-and-forget safe — never throws.
 */
async function notifyAdmins(payload) {
  try {
    const User = require('../models/User');
    const admins = await User.find({ role: 'admin' }).select('_id').lean();
    await Promise.all(admins.map((a) => notifyUserSafe(a._id, payload)));
    return admins.length;
  } catch (err) {
    console.error('[notifyAdmins] Failed:', err.message);
    return 0;
  }
}

module.exports = { notifyUser, notifyUserSafe, notifyAdmins };
