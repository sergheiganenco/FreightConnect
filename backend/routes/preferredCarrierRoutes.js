const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const auth = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validate');
const PreferredCarrier = require('../models/PreferredCarrier');
const Load = require('../models/Load');
const User = require('../models/User');
const { notifyUserSafe } = require('../utils/notifyUser');

// ── POST /api/preferred-carriers — Shipper adds a carrier to preferred list ──
router.post(
  '/',
  auth,
  [
    body('carrierId').isMongoId().withMessage('Valid carrier ID required'),
    body('tier').optional().isIn(['gold', 'silver', 'standard']).withMessage('Tier must be gold, silver, or standard'),
    body('notes').optional().isString().trim(),
  ],
  validate,
  async (req, res) => {
    try {
      if (req.user.role !== 'shipper') {
        return res.status(403).json({ error: 'Only shippers can manage preferred carriers' });
      }

      const { carrierId, tier, notes } = req.body;

      // Verify the carrier exists and is a carrier
      const carrier = await User.findById(carrierId).select('role name companyName');
      if (!carrier || carrier.role !== 'carrier') {
        return res.status(404).json({ error: 'Carrier not found' });
      }

      // Determine firstLookHours from tier
      const tierDefaults = { gold: 2, silver: 1, standard: 0 };
      const finalTier = tier || 'standard';

      const preferredCarrier = await PreferredCarrier.create({
        shipper: req.user.userId,
        carrier: carrierId,
        tier: finalTier,
        firstLookHours: tierDefaults[finalTier],
        notes: notes || '',
      });

      // Notify the carrier
      await notifyUserSafe(carrierId, {
        type: 'preferred:added',
        title: 'You were added as a preferred carrier',
        body: `A shipper has added you to their ${finalTier} tier preferred carrier list.`,
        link: '/dashboard/carrier/loads',
        metadata: { shipperId: req.user.userId, tier: finalTier },
      });

      res.status(201).json(preferredCarrier);
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: 'This carrier is already in your preferred list' });
      }
      console.error('[PreferredCarrier] POST failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ── GET /api/preferred-carriers — Shipper lists their preferred carriers ─────
router.get('/', auth, async (req, res) => {
  try {
    if (req.user.role !== 'shipper') {
      return res.status(403).json({ error: 'Only shippers can view their preferred carrier list' });
    }

    const carriers = await PreferredCarrier.find({ shipper: req.user.userId })
      .populate('carrier', 'name email companyName mcNumber dotNumber trustScore verification')
      .sort({ tier: 1, addedAt: -1 });

    res.json(carriers);
  } catch (err) {
    console.error('[PreferredCarrier] GET list failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/preferred-carriers/shippers — Carrier sees which shippers prefer them
router.get('/shippers', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') {
      return res.status(403).json({ error: 'Only carriers can view their preferred shipper list' });
    }

    const entries = await PreferredCarrier.find({
      carrier: req.user.userId,
      isActive: true,
    })
      .populate('shipper', 'name email companyName')
      .sort({ tier: 1, addedAt: -1 });

    res.json(entries);
  } catch (err) {
    console.error('[PreferredCarrier] GET shippers failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/preferred-carriers/for-load/:loadId — Check if carrier has preferred access
router.get('/for-load/:loadId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') {
      return res.status(403).json({ error: 'Only carriers can check preferred access' });
    }

    const load = await Load.findById(req.params.loadId).select('postedBy loadVisibility createdAt');
    if (!load) {
      return res.status(404).json({ error: 'Load not found' });
    }

    // Check if this carrier is a preferred carrier for this shipper
    const preferredEntry = await PreferredCarrier.findOne({
      shipper: load.postedBy,
      carrier: req.user.userId,
      isActive: true,
    });

    if (!preferredEntry) {
      // Not preferred — check if load is still in firstLook window
      if (load.loadVisibility === 'preferred') {
        // Find the max firstLookHours for any preferred carrier of this shipper
        const maxFirstLook = await PreferredCarrier.findOne({
          shipper: load.postedBy,
          isActive: true,
        }).sort({ firstLookHours: -1 }).select('firstLookHours');

        const firstLookMs = (maxFirstLook?.firstLookHours || 0) * 60 * 60 * 1000;
        const windowEnd = new Date(load.createdAt.getTime() + firstLookMs);

        if (new Date() < windowEnd) {
          return res.json({
            hasAccess: false,
            reason: 'Load is in preferred-carrier first-look window',
            publicAt: windowEnd,
          });
        }
      }

      return res.json({
        hasAccess: load.loadVisibility !== 'preferred' || load.loadVisibility === 'public',
        isPreferred: false,
      });
    }

    res.json({
      hasAccess: true,
      isPreferred: true,
      tier: preferredEntry.tier,
      firstLookHours: preferredEntry.firstLookHours,
    });
  } catch (err) {
    console.error('[PreferredCarrier] for-load check failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /api/preferred-carriers/:id — Update tier/notes ─────────────────────
router.put(
  '/:id',
  auth,
  [
    param('id').isMongoId().withMessage('Valid ID required'),
    body('tier').optional().isIn(['gold', 'silver', 'standard']).withMessage('Tier must be gold, silver, or standard'),
    body('notes').optional().isString().trim(),
    body('isActive').optional().isBoolean(),
  ],
  validate,
  async (req, res) => {
    try {
      if (req.user.role !== 'shipper') {
        return res.status(403).json({ error: 'Only shippers can update preferred carriers' });
      }

      const entry = await PreferredCarrier.findOne({
        _id: req.params.id,
        shipper: req.user.userId,
      });

      if (!entry) {
        return res.status(404).json({ error: 'Preferred carrier entry not found' });
      }

      const { tier, notes, isActive } = req.body;

      if (tier !== undefined) {
        entry.tier = tier;
        const tierDefaults = { gold: 2, silver: 1, standard: 0 };
        entry.firstLookHours = tierDefaults[tier];
      }
      if (notes !== undefined) entry.notes = notes;
      if (isActive !== undefined) entry.isActive = isActive;

      await entry.save();
      res.json(entry);
    } catch (err) {
      console.error('[PreferredCarrier] PUT failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ── DELETE /api/preferred-carriers/:id — Remove from preferred list ──────────
router.delete('/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'shipper') {
      return res.status(403).json({ error: 'Only shippers can remove preferred carriers' });
    }

    const entry = await PreferredCarrier.findOneAndDelete({
      _id: req.params.id,
      shipper: req.user.userId,
    });

    if (!entry) {
      return res.status(404).json({ error: 'Preferred carrier entry not found' });
    }

    res.json({ success: true, message: 'Preferred carrier removed' });
  } catch (err) {
    console.error('[PreferredCarrier] DELETE failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
