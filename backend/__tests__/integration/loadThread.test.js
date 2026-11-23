/**
 * Integration: a load's chat thread belongs to one booking (services/loadThread).
 */
require('../setup');
const mongoose = require('mongoose');
const Channel = require('../../models/Channel');
const Message = require('../../models/Message');
const { openLoadThread, archiveLoadThread, canAccessChannel, threadId } = require('../../services/loadThread');

const id = () => new mongoose.Types.ObjectId();

describe('load thread', () => {
  test('opened once per booking; the same carrier reuses it', async () => {
    const loadId = id(), carrierId = id(), shipperId = id();
    const a = await openLoadThread({ loadId, carrierId, shipperId, welcome: 'hello' });
    expect(a.created).toBe(true);
    expect(await Message.countDocuments({ channelId: threadId(loadId) })).toBe(1);
    const b = await openLoadThread({ loadId, carrierId, shipperId, welcome: 'hello again' });
    expect(b.created).toBe(false);
    expect(await Message.countDocuments({ channelId: threadId(loadId) })).toBe(1);
  });

  test("another carrier never inherits a thread: the old one is re-filed, not deleted", async () => {
    const loadId = id(), first = id(), second = id(), shipperId = id();
    await openLoadThread({ loadId, carrierId: first, shipperId, welcome: 'first booking' });
    await Message.create({ channelType: 'load_thread', channelId: threadId(loadId), sender: shipperId, content: 'gate code 4411', readBy: [] });

    const next = await openLoadThread({ loadId, carrierId: second, shipperId, welcome: 'second booking' });
    expect(next.created).toBe(true);
    const live = await Message.find({ channelId: threadId(loadId) }).lean();
    expect(live.map((m) => m.content)).toEqual(['second booking']);
    expect(next.channel.participants.map((p) => String(p.user))).toEqual([String(second), String(shipperId)]);

    // the first booking's conversation still exists, under its own id, for its own two parties
    const old = await Channel.findOne({ loadId, channelId: { $ne: threadId(loadId) } }).lean();
    expect(old.participants.map((p) => String(p.user))).toContain(String(first));
    expect(await Message.countDocuments({ channelId: old.channelId })).toBe(2);
  });

  test('leftover messages with no channel are re-filed before a new thread opens', async () => {
    const loadId = id();
    await Message.create({ channelType: 'load_thread', channelId: threadId(loadId), sender: null, content: 'cancel note of the previous booking', messageType: 'system', readBy: [] });
    await openLoadThread({ loadId, carrierId: id(), shipperId: id() });
    expect(await Message.countDocuments({ channelId: threadId(loadId) })).toBe(0);
    expect(await Message.countDocuments({ content: /cancel note/ })).toBe(1);
  });

  test('archive with nothing there is a no-op', async () => {
    await expect(archiveLoadThread(id())).resolves.toBeUndefined();
  });

  test('access: participants, and company sub-accounts only for load threads', () => {
    const company = id(), sub = id(), stranger = id();
    const thread = { channelType: 'load_thread', participants: [{ user: company, role: 'carrier' }] };
    const direct = { channelType: 'direct', participants: [{ user: company, role: 'carrier' }] };
    expect(canAccessChannel(thread, { userId: company, companyOwnerId: company })).toBe(true);
    expect(canAccessChannel(thread, { userId: sub, companyOwnerId: company })).toBe(true);
    expect(canAccessChannel(direct, { userId: sub, companyOwnerId: company })).toBe(false);
    expect(canAccessChannel(thread, { userId: stranger, companyOwnerId: stranger })).toBe(false);
    expect(canAccessChannel(null, { userId: company })).toBe(false);
    expect(canAccessChannel(thread, {})).toBe(false);
  });
});
