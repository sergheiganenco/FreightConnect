/**
 * loadThread.js — the chat thread of a load belongs to ONE booking (one shipper company + one carrier company).
 *
 * Every booking path opens the thread through openLoadThread(); when a load goes back on the board the Load model
 * calls archiveLoadThread(). A thread that is not the current carrier's is never reused, never read by the next
 * carrier, and never deleted: it is re-filed under its own id, where the two parties of that booking keep it.
 */
const Channel = require('../models/Channel');
const Message = require('../models/Message');
const { getIO } = require('../utils/socket');

const threadId = (loadId) => `load_${loadId}`;
const same = (a, b) => a != null && b != null && String(a) === String(b);

/** May this caller read/join the channel? Participants; for a load thread also the sub-accounts of a participant company. */
function canAccessChannel(channel, { userId, companyOwnerId } = {}) {
  if (!channel) return false;
  return (channel.participants || []).some((p) => same(p.user, userId)
    || (channel.channelType === 'load_thread' && same(p.user, companyOwnerId)));
}

/** Set the live thread of a load aside (messages first, so nothing stays readable under the live id if a step fails). */
async function archiveLoadThread(loadId) {
  const from = threadId(loadId);
  const to = `${from}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await Message.updateMany({ channelId: from }, { $set: { channelId: to } });
  await Channel.updateOne({ channelId: from }, { $set: { channelId: to } });
  // Anyone still sitting in the live socket room belonged to the old booking.
  try { const io = getIO(); if (io) io.in(from).socketsLeave(from); } catch (_) { /* no socket server (jobs/tests) */ }
}

/**
 * Open (or reuse) the thread for the CURRENT booking. Reused only when its carrier participant is this carrier;
 * anything else under the live id (another booking's thread, or leftover messages) is archived first.
 * Returns { channel, created }.
 */
async function openLoadThread({ loadId, carrierId, shipperId, welcome, preview }) {
  const channelId = threadId(loadId);
  const existing = await Channel.findOne({ channelId });
  if (existing && existing.participants.some((p) => p.role === 'carrier' && same(p.user, carrierId))) {
    return { channel: existing, created: false };
  }
  await archiveLoadThread(loadId);
  const channel = await Channel.create({
    channelType: 'load_thread', channelId, loadId,
    participants: [{ user: carrierId, role: 'carrier' }, { user: shipperId, role: 'shipper' }],
    lastMessageAt: new Date(),
    lastMessagePreview: preview || 'Load booked',
  });
  if (welcome) {
    await Message.create({ channelType: 'load_thread', channelId, sender: null, content: welcome, messageType: 'system', readBy: [] });
  }
  try {
    const io = getIO();
    if (io) for (const u of [shipperId, carrierId]) io.to(`user_${u}`).emit('chat:channelCreated', {});
  } catch (_) { /* non-fatal */ }
  return { channel, created: true };
}

module.exports = { openLoadThread, archiveLoadThread, canAccessChannel, threadId };
