const express = require('express');
const router = express.Router();
const auth = require('../middlewares/authMiddleware');
const Bid = require('../models/Bid');
const Load = require('../models/Load');
const User = require('../models/User');
const { suggestRate } = require('../services/rateSuggestionService');
const { getIO } = require('../utils/socket');
const { generateRateConfirmation } = require('../utils/pdfGenerator');
const { notifyUserSafe } = require('../utils/notifyUser');

// ── Helper: notify via socket ────────────────────────────────────────────────
function notify(userId, event, payload) {
  try { getIO().to(`user_${userId}`).emit(event, payload); } catch (_) {}
}

// ── Helper: auto-generate Rate Confirmation (non-blocking) ──────────────────
async function autoGenerateRateCon(loadId, carrierId, shipperId) {
  try {
    const [load, carrier, shipper] = await Promise.all([
      Load.findById(loadId),
      User.findById(carrierId).select('name email companyName mcNumber dotNumber verification'),
      User.findById(shipperId).select('name email companyName'),
    ]);
    if (!load || !carrier || !shipper) return;
    const filePath = await generateRateConfirmation(load, carrier, shipper);
    await Load.findByIdAndUpdate(loadId, { 'documents.rateConfirmation': filePath });
    notify(carrierId.toString(), 'doc:generated', { loadId, type: 'rateConfirmation', path: filePath });
    notify(shipperId.toString(), 'doc:generated', { loadId, type: 'rateConfirmation', path: filePath });
  } catch (err) {
    console.error('[RateCon] Auto-generate failed (non-fatal):', err.message);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// GET /api/bids/rate-suggestion/:loadId
// Returns market rate suggestion for a load
// ────────────────────────────────────────────────────────────────────────────
router.get('/rate-suggestion/:loadId', auth, async (req, res) => {
  try {
    const load = await Load.findById(req.params.loadId).lean();
    if (!load) return res.status(404).json({ error: 'Load not found' });
    const suggestion = await suggestRate(load);
    res.json(suggestion);
  } catch (err) {
    console.error('Rate suggestion error:', err);
    res.status(500).json({ error: 'Failed to get rate suggestion' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/bids/rate-suggestion-preview
// Returns market rate suggestion before a load is saved (for the Post Load form)
// ────────────────────────────────────────────────────────────────────────────
router.post('/rate-suggestion-preview', auth, async (req, res) => {
  try {
    const { origin, destination, equipmentType } = req.body;
    if (!origin || !destination || !equipmentType) {
      return res.status(400).json({ error: 'origin, destination, and equipmentType are required' });
    }
    // Build a pseudo-load for suggestRate (no loadId needed)
    const pseudoLoad = { origin, destination, equipmentType };
    // Attempt geocoding for distance-based estimate
    try {
      const fetch = require('node-fetch');
      const [oRes, dRes] = await Promise.all([
        fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(origin)}&limit=1`).then(r => r.json()),
        fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(destination)}&limit=1`).then(r => r.json()),
      ]);
      if (oRes.length) { pseudoLoad.originLat = parseFloat(oRes[0].lat); pseudoLoad.originLng = parseFloat(oRes[0].lon); }
      if (dRes.length) { pseudoLoad.destinationLat = parseFloat(dRes[0].lat); pseudoLoad.destinationLng = parseFloat(dRes[0].lon); }
    } catch (_) { /* geocoding failure is non-fatal */ }
    const suggestion = await suggestRate(pseudoLoad);
    res.json(suggestion);
  } catch (err) {
    console.error('Rate suggestion preview error:', err);
    res.status(500).json({ error: 'Failed to get rate suggestion' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/bids  — carrier places a bid
// ────────────────────────────────────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') {
      return res.status(403).json({ error: 'Only carriers can place bids' });
    }
    const { loadId, amount, message } = req.body;
    if (!loadId || !amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'loadId and a positive amount are required' });
    }

    const load = await Load.findById(loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });
    if (load.status !== 'open') return res.status(409).json({ error: 'Load is no longer open for bids' });

    // Upsert: carrier can revise their bid (replaces previous)
    const bid = await Bid.findOneAndUpdate(
      { loadId, carrierId: req.user.userId },
      {
        $set: { amount: Number(amount), message, status: 'pending', counterAmount: null },
        $push: {
          history: {
            actor: 'carrier',
            action: 'placed',
            amount: Number(amount),
            note: message,
          },
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Notify shipper
    notify(load.postedBy.toString(), 'bid:new', {
      bidId: bid._id,
      loadId,
      loadTitle: load.title,
      amount: bid.amount,
      carrierId: req.user.userId,
    });
    notifyUserSafe(load.postedBy.toString(), {
      type: 'bid:new',
      title: 'New bid on your load',
      body: `$${bid.amount.toLocaleString()} bid on "${load.title}"`,
      link: '/dashboard/shipper/loads',
      metadata: { loadId, bidId: bid._id },
    });

    res.status(201).json(bid);
  } catch (err) {
    console.error('Place bid error:', err);
    res.status(500).json({ error: 'Failed to place bid' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/bids/load/:loadId — all bids on a load (shipper or carrier sees own)
// ────────────────────────────────────────────────────────────────────────────
router.get('/load/:loadId', auth, async (req, res) => {
  try {
    const load = await Load.findById(req.params.loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });

    let filter = { loadId: req.params.loadId };

    if (req.user.role === 'carrier') {
      filter.carrierId = req.user.userId; // carrier sees only their own bid
    } else if (req.user.role === 'shipper') {
      // Verify this shipper owns the load
      if (load.postedBy.toString() !== req.user.userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
    // admin sees all

    const bids = await Bid.find(filter)
      .populate('carrierId', 'name companyName trustScore verification.status')
      .sort({ amount: 1, createdAt: 1 });

    res.json(bids);
  } catch (err) {
    console.error('Get bids error:', err);
    res.status(500).json({ error: 'Failed to fetch bids' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/bids/my — carrier's own bids across all loads
// ────────────────────────────────────────────────────────────────────────────
router.get('/my', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
    const bids = await Bid.find({ carrierId: req.user.userId })
      .populate('loadId', 'title origin destination rate status')
      .sort({ updatedAt: -1 })
      .limit(50);
    res.json(bids);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bids' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// PUT /api/bids/:id/accept — shipper accepts bid (updates load rate + acceptedBy)
// ────────────────────────────────────────────────────────────────────────────
router.put('/:id/accept', auth, async (req, res) => {
  try {
    const bid = await Bid.findById(req.params.id).populate('loadId');
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    if (req.user.role !== 'shipper') return res.status(403).json({ error: 'Only shippers can accept bids' });
    if (bid.loadId.postedBy.toString() !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    if (!['pending', 'countered'].includes(bid.status)) {
      return res.status(409).json({ error: 'Bid is not in an acceptable state' });
    }

    const finalAmount = bid.status === 'countered' ? (bid.counterAmount || bid.amount) : bid.amount;

    bid.status = 'accepted';
    bid.history.push({ actor: 'shipper', action: 'accepted', amount: finalAmount });
    await bid.save();

    // Update load: set rate to negotiated amount and accept
    await Load.findByIdAndUpdate(bid.loadId._id, {
      rate: finalAmount,
      acceptedBy: bid.carrierId,
      status: 'accepted',
    });

    // Reject all other bids on this load
    await Bid.updateMany(
      { loadId: bid.loadId._id, _id: { $ne: bid._id }, status: 'pending' },
      { $set: { status: 'rejected' }, $push: { history: { actor: 'shipper', action: 'rejected', note: 'Another bid was accepted' } } }
    );

    // Notify carrier
    notify(bid.carrierId.toString(), 'bid:accepted', {
      bidId: bid._id,
      loadId: bid.loadId._id,
      loadTitle: bid.loadId.title,
      finalAmount,
    });
    notifyUserSafe(bid.carrierId.toString(), {
      type: 'bid:accepted',
      title: 'Your bid was accepted!',
      body: `$${finalAmount.toLocaleString()} · ${bid.loadId.title}`,
      link: '/dashboard/carrier/my-loads',
      metadata: { loadId: bid.loadId._id, bidId: bid._id, finalAmount },
    });

    // Auto-generate Rate Confirmation (non-blocking)
    autoGenerateRateCon(bid.loadId._id, bid.carrierId, bid.loadId.postedBy);

    // Auto-create load_thread channel
    try {
      const Channel = require('../models/Channel');
      const Message = require('../models/Message');
      const channelId = `load_${bid.loadId._id}`;
      if (!await Channel.findOne({ channelId })) {
        await Channel.create({
          channelType: 'load_thread',
          channelId,
          loadId: bid.loadId._id,
          participants: [
            { user: bid.carrierId, role: 'carrier' },
            { user: bid.loadId.postedBy, role: 'shipper' },
          ],
        });
        await Message.create({
          channelType: 'load_thread',
          channelId,
          sender: null,
          content: `✅ Bid accepted at $${finalAmount.toLocaleString()}. Good luck on the road!`,
          messageType: 'system',
        });
        const io = getIO();
        io.to(`user_${bid.loadId.postedBy}`).emit(`chat:channelCreated:${bid.loadId.postedBy}`, {});
        io.to(`user_${bid.carrierId}`).emit(`chat:channelCreated:${bid.carrierId}`, {});
      }
    } catch (chatErr) {
      console.error('Failed to create load chat (non-fatal):', chatErr.message);
    }

    res.json({ bid, finalAmount });
  } catch (err) {
    console.error('Accept bid error:', err);
    res.status(500).json({ error: 'Failed to accept bid' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// PUT /api/bids/:id/reject — shipper rejects a bid
// ────────────────────────────────────────────────────────────────────────────
router.put('/:id/reject', auth, async (req, res) => {
  try {
    const bid = await Bid.findById(req.params.id).populate('loadId', 'postedBy title');
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    if (req.user.role !== 'shipper' || bid.loadId.postedBy.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    bid.status = 'rejected';
    bid.history.push({ actor: 'shipper', action: 'rejected', note: req.body.reason });
    await bid.save();

    notify(bid.carrierId.toString(), 'bid:rejected', {
      bidId: bid._id,
      loadId: bid.loadId._id,
      loadTitle: bid.loadId.title,
    });
    notifyUserSafe(bid.carrierId.toString(), {
      type: 'bid:rejected',
      title: 'Your bid was not accepted',
      body: `Load: "${bid.loadId.title}"`,
      link: '/dashboard/carrier/loads',
      metadata: { loadId: bid.loadId._id, bidId: bid._id },
    });

    res.json(bid);
  } catch (err) {
    res.status(500).json({ error: 'Failed to reject bid' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// PUT /api/bids/:id/counter — shipper counters with a new amount
// ────────────────────────────────────────────────────────────────────────────
router.put('/:id/counter', auth, async (req, res) => {
  try {
    const { counterAmount, note } = req.body;
    if (!counterAmount || Number(counterAmount) <= 0) {
      return res.status(400).json({ error: 'A positive counterAmount is required' });
    }
    const bid = await Bid.findById(req.params.id).populate('loadId', 'postedBy title');
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    if (req.user.role !== 'shipper' || bid.loadId.postedBy.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (bid.status !== 'pending') return res.status(409).json({ error: 'Can only counter a pending bid' });

    bid.status = 'countered';
    bid.counterAmount = Number(counterAmount);
    bid.history.push({ actor: 'shipper', action: 'countered', amount: Number(counterAmount), note });
    await bid.save();

    notify(bid.carrierId.toString(), 'bid:countered', {
      bidId: bid._id,
      loadId: bid.loadId._id,
      loadTitle: bid.loadId.title,
      counterAmount: bid.counterAmount,
    });
    notifyUserSafe(bid.carrierId.toString(), {
      type: 'bid:countered',
      title: 'Shipper countered your bid',
      body: `Counter: $${bid.counterAmount.toLocaleString()} · "${bid.loadId.title}"`,
      link: '/dashboard/carrier/loads',
      metadata: { loadId: bid.loadId._id, bidId: bid._id, counterAmount: bid.counterAmount },
    });

    res.json(bid);
  } catch (err) {
    res.status(500).json({ error: 'Failed to counter bid' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// PUT /api/bids/:id/accept-counter — carrier accepts shipper's counter
// ────────────────────────────────────────────────────────────────────────────
router.put('/:id/accept-counter', auth, async (req, res) => {
  try {
    const bid = await Bid.findById(req.params.id).populate('loadId');
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    if (req.user.role !== 'carrier' || bid.carrierId.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (bid.status !== 'countered') return res.status(409).json({ error: 'Bid has not been countered' });

    bid.status = 'accepted';
    bid.history.push({ actor: 'carrier', action: 'accepted', amount: bid.counterAmount });
    await bid.save();

    await Load.findByIdAndUpdate(bid.loadId._id, {
      rate: bid.counterAmount,
      acceptedBy: bid.carrierId,
      status: 'accepted',
    });

    notify(bid.loadId.postedBy.toString(), 'bid:accepted', {
      bidId: bid._id,
      loadId: bid.loadId._id,
      finalAmount: bid.counterAmount,
    });
    notifyUserSafe(bid.loadId.postedBy.toString(), {
      type: 'bid:counter_accepted',
      title: 'Carrier accepted your counter offer',
      body: `$${bid.counterAmount.toLocaleString()} · Load assigned`,
      link: '/dashboard/shipper/loads',
      metadata: { loadId: bid.loadId._id, bidId: bid._id, finalAmount: bid.counterAmount },
    });

    // Auto-generate Rate Confirmation (non-blocking)
    autoGenerateRateCon(bid.loadId._id, bid.carrierId, bid.loadId.postedBy);

    res.json({ bid, finalAmount: bid.counterAmount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to accept counter' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// DELETE /api/bids/:id — carrier withdraws their bid
// ────────────────────────────────────────────────────────────────────────────
router.delete('/:id', auth, async (req, res) => {
  try {
    const bid = await Bid.findById(req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    if (req.user.role !== 'carrier' || bid.carrierId.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!['pending', 'countered'].includes(bid.status)) {
      return res.status(409).json({ error: 'Cannot withdraw an accepted or rejected bid' });
    }
    bid.status = 'withdrawn';
    bid.history.push({ actor: 'carrier', action: 'withdrawn' });
    await bid.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to withdraw bid' });
  }
});

module.exports = router;
