const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../middlewares/authMiddleware');
const Channel = require('../models/Channel');
const Message = require('../models/Message');
const { getIO } = require('../utils/socket');

// Helper — verify caller is a participant
function isParticipant(channel, userId) {
  return channel.participants.some(
    (p) => p.user.toString() === userId.toString()
  );
}

// ----------------------------------------
// POST /api/chat/channels
// Create a direct or community channel manually
// (load_thread channels are created automatically on load acceptance)
// ----------------------------------------
router.post('/channels', auth, async (req, res) => {
  try {
    const { channelType, participantIds, communityInfo } = req.body;

    if (!['direct', 'community'].includes(channelType)) {
      return res.status(400).json({ error: 'Invalid channel type for manual creation' });
    }

    let channelId;
    let participants = [];

    if (channelType === 'direct') {
      if (!participantIds || participantIds.length !== 1) {
        return res.status(400).json({ error: 'Direct channels require exactly one other participant' });
      }
      const otherId = participantIds[0];
      const ids = [req.user.userId.toString(), otherId].sort();
      channelId = `direct_${ids[0]}_${ids[1]}`;

      const existing = await Channel.findOne({ channelId });
      if (existing) return res.json(existing);

      participants = [
        { user: req.user.userId, role: req.user.role },
        { user: otherId, role: 'carrier' }, // role resolved on read
      ];
    } else {
      channelId = `community_${Date.now()}`;
      participants = [{ user: req.user.userId, role: req.user.role }];
    }

    const channel = await Channel.create({
      channelType,
      channelId,
      participants,
      communityInfo: channelType === 'community' ? communityInfo : undefined,
    });

    res.status(201).json(channel);
  } catch (err) {
    console.error('Create channel error:', err);
    res.status(500).json({ error: 'Failed to create channel' });
  }
});

// ----------------------------------------
// GET /api/chat/channels
// List all channels for the authenticated user
// ----------------------------------------
router.get('/channels', auth, async (req, res) => {
  try {
    const channels = await Channel.find({
      'participants.user': req.user.userId,
      status: { $ne: 'archived' },
    })
      .sort({ lastMessageAt: -1 })
      .populate('loadId', 'title origin destination status')
      .populate('participants.user', 'name role');

    // Attach unread count for each channel
    const enriched = await Promise.all(
      channels.map(async (ch) => {
        const unread = await Message.countDocuments({
          channelId: ch.channelId,
          deleted: false,
          'readBy.user': { $ne: req.user.userId },
          sender: { $ne: req.user.userId },
        });
        return { ...ch.toObject(), unreadCount: unread };
      })
    );

    res.json(enriched);
  } catch (err) {
    console.error('List channels error:', err);
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

// ----------------------------------------
// GET /api/chat/channels/:channelId
// Get channel details
// ----------------------------------------
router.get('/channels/:channelId', auth, async (req, res) => {
  try {
    const channel = await Channel.findOne({ channelId: req.params.channelId })
      .populate('loadId', 'title origin destination status rate equipmentType')
      .populate('participants.user', 'name role');

    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (!isParticipant(channel, req.user.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(channel);
  } catch (err) {
    console.error('Get channel error:', err);
    res.status(500).json({ error: 'Failed to fetch channel' });
  }
});

// ----------------------------------------
// GET /api/chat/channels/:channelId/messages
// Paginated messages (cursor-based, newest first)
// ----------------------------------------
router.get('/channels/:channelId/messages', auth, async (req, res) => {
  try {
    const channel = await Channel.findOne({ channelId: req.params.channelId });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (!isParticipant(channel, req.user.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { before, limit = 50 } = req.query;
    const query = { channelId: req.params.channelId, deleted: false };
    if (before) query.createdAt = { $lt: new Date(before) };

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit), 100))
      .populate('sender', 'name role');

    res.json(messages.reverse()); // return oldest-first for display
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ----------------------------------------
// POST /api/chat/channels/:channelId/messages
// Send a message
// ----------------------------------------
router.post('/channels/:channelId/messages', auth, async (req, res) => {
  try {
    const channel = await Channel.findOne({ channelId: req.params.channelId });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (!isParticipant(channel, req.user.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (channel.status === 'locked') {
      return res.status(403).json({ error: 'This channel is locked' });
    }

    const { content, messageType, attachments, location } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    const message = await Message.create({
      channelType: channel.channelType,
      channelId: channel.channelId,
      sender: req.user.userId,
      content: content.trim(),
      messageType: messageType || 'text',
      attachments: attachments || [],
      location: location || undefined,
      readBy: [{ user: req.user.userId }],
    });

    // Update channel metadata
    await Channel.findOneAndUpdate(
      { channelId: channel.channelId },
      {
        lastMessageAt: new Date(),
        lastMessagePreview: content.trim().substring(0, 80),
      }
    );

    const populated = await message.populate('sender', 'name role');

    // Broadcast to channel room
    const io = getIO();
    if (io) io.to(channel.channelId).emit('newMessage', populated);

    res.status(201).json(populated);
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ----------------------------------------
// PUT /api/chat/channels/:channelId/messages/:messageId
// Edit a message (own messages only)
// ----------------------------------------
router.put('/channels/:channelId/messages/:messageId', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (message.sender?.toString() !== req.user.userId.toString()) {
      return res.status(403).json({ error: 'Can only edit your own messages' });
    }
    if (message.messageType === 'system') {
      return res.status(400).json({ error: 'Cannot edit system messages' });
    }

    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Content is required' });
    }

    message.content = content.trim();
    message.edited = true;
    message.editedAt = new Date();
    await message.save();

    const io = getIO();
    if (io) io.to(req.params.channelId).emit('messageEdited', message);

    res.json(message);
  } catch (err) {
    console.error('Edit message error:', err);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// ----------------------------------------
// DELETE /api/chat/channels/:channelId/messages/:messageId
// Soft-delete a message (own messages only)
// ----------------------------------------
router.delete('/channels/:channelId/messages/:messageId', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId);
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (message.sender?.toString() !== req.user.userId.toString()) {
      return res.status(403).json({ error: 'Can only delete your own messages' });
    }

    message.deleted = true;
    message.content = '[Message deleted]';
    await message.save();

    const io = getIO();
    if (io) io.to(req.params.channelId).emit('messageDeleted', { messageId: message._id });

    res.json({ success: true });
  } catch (err) {
    console.error('Delete message error:', err);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// ----------------------------------------
// POST /api/chat/channels/:channelId/read
// Mark messages as read up to now
// ----------------------------------------
router.post('/channels/:channelId/read', auth, async (req, res) => {
  try {
    const channel = await Channel.findOne({ channelId: req.params.channelId });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (!isParticipant(channel, req.user.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await Message.updateMany(
      {
        channelId: req.params.channelId,
        'readBy.user': { $ne: req.user.userId },
        sender: { $ne: req.user.userId },
      },
      { $addToSet: { readBy: { user: req.user.userId, readAt: new Date() } } }
    );

    const io = getIO();
    if (io) {
      io.to(req.params.channelId).emit('readReceipt', {
        channelId: req.params.channelId,
        userId: req.user.userId,
        readAt: new Date(),
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Mark read error:', err);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// ----------------------------------------
// POST /api/chat/channels/:channelId/mute
// Toggle mute for current user
// ----------------------------------------
router.post('/channels/:channelId/mute', auth, async (req, res) => {
  try {
    const channel = await Channel.findOne({ channelId: req.params.channelId });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (!isParticipant(channel, req.user.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const participant = channel.participants.find(
      (p) => p.user.toString() === req.user.userId.toString()
    );
    participant.muted = !participant.muted;
    await channel.save();

    res.json({ muted: participant.muted });
  } catch (err) {
    console.error('Mute channel error:', err);
    res.status(500).json({ error: 'Failed to toggle mute' });
  }
});

module.exports = router;
