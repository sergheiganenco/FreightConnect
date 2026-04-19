const express = require('express');
const router = express.Router();
const auth = require('../middlewares/authMiddleware');
const Load = require('../models/Load');
const { getIO } = require('../utils/socket');

const VALID_SOURCES = ['browser', 'mobile_app', 'eld', 'api'];

// POST /api/tracking/location — source-agnostic location ingest
// Works for browser, mobile app, ELD webhook, or any external tracker.
router.post('/location', auth, async (req, res) => {
  try {
    const { loadId, latitude, longitude, speed, heading, accuracy, source } = req.body;

    if (!loadId || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'loadId, latitude, and longitude are required' });
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }

    const load = await Load.findById(loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });

    // Only the assigned carrier (or admin) can update location
    if (String(load.acceptedBy) !== String(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to update this load\'s location' });
    }

    const locationData = {
      latitude,
      longitude,
      speed:     speed ?? null,
      heading:   heading ?? null,
      accuracy:  accuracy ?? null,
      source:    VALID_SOURCES.includes(source) ? source : 'api',
      updatedAt: new Date(),
    };

    await Load.findByIdAndUpdate(loadId, { carrierLocation: locationData });

    // Broadcast to shipper + carrier via socket
    const io = getIO();
    const payload = { loadId, ...locationData };
    if (load.postedBy) {
      io.to(`user_${load.postedBy}`).emit('carrierLocationUpdate', payload);
    }
    io.to(`user_${load.acceptedBy}`).emit('carrierLocationUpdate', payload);

    res.json({ ok: true });
  } catch (err) {
    console.error('Tracking location error:', err);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// GET /api/tracking/:loadId — get current carrier location for a load
router.get('/:loadId', auth, async (req, res) => {
  try {
    const load = await Load.findById(req.params.loadId).select('carrierLocation postedBy acceptedBy status');
    if (!load) return res.status(404).json({ error: 'Load not found' });

    // Only shipper, assigned carrier, or admin can view
    const userId = String(req.user._id);
    const allowed = userId === String(load.postedBy) || userId === String(load.acceptedBy) || req.user.role === 'admin';
    if (!allowed) return res.status(403).json({ error: 'Not authorized' });

    res.json({
      carrierLocation: load.carrierLocation || null,
      status: load.status,
    });
  } catch (err) {
    console.error('Get tracking error:', err);
    res.status(500).json({ error: 'Failed to get location' });
  }
});

module.exports = router;
