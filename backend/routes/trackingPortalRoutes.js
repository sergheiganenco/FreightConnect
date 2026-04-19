/**
 * Tracking Portal Routes — Public shipment tracking
 *
 * POST /api/tracking-portal/generate/:loadId — Shipper generates a tracking link (auth required)
 * GET  /api/tracking-portal/:token           — Public tracking page data (NO auth)
 */

const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/authMiddleware');
const TrackingLink = require('../models/TrackingLink');
const Load         = require('../models/Load');

// ── POST /generate/:loadId — create a public tracking link ──────────────────
router.post('/generate/:loadId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'shipper' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only shippers can generate tracking links' });
    }

    const load = await Load.findById(req.params.loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });

    // Only the shipper who posted the load (or admin) may generate
    if (req.user.role === 'shipper' && load.postedBy.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'You can only generate tracking links for your own loads' });
    }

    // Check if an active link already exists for this load
    const existing = await TrackingLink.findOne({ loadId: load._id, isActive: true });
    if (existing) {
      return res.json({
        token: existing.token,
        url: `${req.protocol}://${req.get('host')}/api/tracking-portal/${existing.token}`,
        expiresAt: existing.expiresAt,
        message: 'Existing active tracking link returned',
      });
    }

    // Default expiry: 7 days after delivery, or 30 days from now if not yet delivered
    const expiresAt = load.deliveredAt
      ? new Date(new Date(load.deliveredAt).getTime() + 7 * 24 * 60 * 60 * 1000)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const link = await TrackingLink.create({
      loadId:    load._id,
      createdBy: req.user.userId,
      expiresAt,
    });

    res.status(201).json({
      token: link.token,
      url: `${req.protocol}://${req.get('host')}/api/tracking-portal/${link.token}`,
      expiresAt: link.expiresAt,
    });
  } catch (err) {
    console.error('[TrackingPortal] Generate failed:', err.message);
    res.status(500).json({ error: 'Failed to generate tracking link' });
  }
});

// ── GET /:token — PUBLIC tracking data (no auth) ───────────────────────────
router.get('/:token', async (req, res) => {
  try {
    const link = await TrackingLink.findOne({
      token:    req.params.token,
      isActive: true,
    });

    if (!link) {
      return res.status(404).json({ error: 'Tracking link not found or has been deactivated' });
    }

    // Check expiry
    if (link.expiresAt && new Date() > new Date(link.expiresAt)) {
      return res.status(410).json({ error: 'This tracking link has expired' });
    }

    const load = await Load.findById(link.loadId)
      .select('title origin destination originLat originLng destinationLat destinationLng status carrierLocation pickupTimeWindow deliveryTimeWindow deliveredAt')
      .lean();

    if (!load) {
      return res.status(404).json({ error: 'Load not found' });
    }

    // Estimate ETA based on carrier location and destination
    let etaEstimate = null;
    if (load.status === 'in-transit' && load.carrierLocation?.latitude && load.destinationLat) {
      // Simple Haversine-based estimate assuming 55 mph average
      const R = 3959; // miles
      const dLat = (load.destinationLat - load.carrierLocation.latitude) * Math.PI / 180;
      const dLon = (load.destinationLng - load.carrierLocation.longitude) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(load.carrierLocation.latitude * Math.PI / 180) *
        Math.cos(load.destinationLat * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
      const distMiles = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const hoursRemaining = distMiles / 55;
      etaEstimate = new Date(Date.now() + hoursRemaining * 60 * 60 * 1000).toISOString();
    }

    // Return sanitized public data — NO carrier name, NO rate, NO financial info
    res.json({
      loadTitle:    load.title,
      origin:       load.origin,
      destination:  load.destination,
      status:       load.status,
      carrierLocation: load.carrierLocation?.latitude ? {
        latitude:  load.carrierLocation.latitude,
        longitude: load.carrierLocation.longitude,
        updatedAt: load.carrierLocation.updatedAt,
      } : null,
      pickupWindow:   load.pickupTimeWindow || null,
      deliveryWindow: load.deliveryTimeWindow || null,
      deliveredAt:    load.deliveredAt || null,
      etaEstimate,
      lastUpdated: load.carrierLocation?.updatedAt || null,
    });
  } catch (err) {
    console.error('[TrackingPortal] Lookup failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch tracking data' });
  }
});

module.exports = router;
