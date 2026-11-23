const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const auth = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validate');
const PreferredCarrier = require('../models/PreferredCarrier');
const { PUBLIC_PARTY_SELECT } = require('../services/trustScoreService');
const Load = require('../models/Load');
const User = require('../models/User');
const { notifyUserSafe } = require('../utils/notifyUser');
const { carrierCanSeeLoad } = require('../services/loadVisibility');

// The network belongs to the company: a sub-account acts for its owner, on the shipper and on the carrier side.
const companyOf = (req) => req.user.companyOwnerId || req.user.userId;

// ── POST /api/preferred-carriers — Shipper adds a carrier to preferred list ──
router.post(
  '/',
  auth,
  [
    body('carrierId').optional().isMongoId().withMessage('Valid carrier ID required'),
    body('dotNumber').optional().isString().trim().matches(/^\d{1,8}$/).withMessage('DOT number must be 1 to 8 digits'),
    body('tier').optional().isIn(['gold', 'silver', 'standard']).withMessage('Tier must be gold, silver, or standard'),
    body('notes').optional().isString().trim(),
  ],
  validate,
  async (req, res) => {
    try {
      if (req.user.role !== 'shipper') {
        return res.status(403).json({ error: 'Only shippers can manage preferred carriers' });
      }

      const { tier, notes, dotNumber } = req.body;
      if (!req.body.carrierId && !dotNumber) return res.status(400).json({ error: 'carrierId or dotNumber is required' });

      // A carrier COMPANY account (never a team member's login), found by id or by its FMCSA-confirmed DOT number.
      const carrier = await User.findOne({
        ...(req.body.carrierId ? { _id: req.body.carrierId } : { 'verification.fmcsaData.dotNumber': dotNumber }),
        role: 'carrier', parentAccountId: null, active: { $ne: false },
      }).select('_id');
      if (!carrier) {
        return res.status(404).json({ error: dotNumber ? 'No verified carrier with that DOT number is on FreightConnect' : 'Carrier not found' });
      }
      const carrierId = carrier._id;

      // Determine firstLookHours from tier
      const tierDefaults = { gold: 2, silver: 1, standard: 0 };
      const finalTier = tier || 'standard';

      const preferredCarrier = await PreferredCarrier.create({
        shipper: companyOf(req),
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
        metadata: { shipperId: companyOf(req), tier: finalTier },
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

    const carriers = await PreferredCarrier.find({ shipper: companyOf(req) })
      .populate('carrier', PUBLIC_PARTY_SELECT)
      .sort({ tier: 1, addedAt: -1 });

    res.json(carriers);
  } catch (err) {
    console.error('[PreferredCarrier] GET list failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/preferred-carriers/candidates — carriers that delivered this shipper's loads and are not in the network yet
router.get('/candidates', auth, async (req, res) => {
  try {
    if (req.user.role !== 'shipper') return res.status(403).json({ error: 'Forbidden' });
    const cid = companyOf(req);
    const [hauled, already] = await Promise.all([
      Load.distinct('acceptedBy', { postedBy: cid, status: 'delivered' }),
      PreferredCarrier.distinct('carrier', { shipper: cid }),
    ]);
    const skip = new Set(already.map(String));
    const ids = hauled.filter((id) => id && !skip.has(String(id))).slice(0, 50);
    const carriers = await User.find({ _id: { $in: ids }, role: 'carrier', active: { $ne: false } }).select(PUBLIC_PARTY_SELECT).lean();
    res.json(carriers);
  } catch (err) {
    console.error('[PreferredCarrier] GET candidates failed:', err.message);
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
      carrier: companyOf(req),
      isActive: true,
    })
      .populate('shipper', 'name companyName')
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

    if (!/^[a-f0-9]{24}$/i.test(req.params.loadId)) return res.status(404).json({ error: 'Load not found' });
    const load = await Load.findById(req.params.loadId).select('postedBy status loadVisibility tender createdAt');
    // A load this carrier may not see answers exactly like one that does not exist.
    if (!load || load.status !== 'open' || !(await carrierCanSeeLoad(load, companyOf(req)))) return res.status(404).json({ error: 'Load not found' });
    const entry = await PreferredCarrier.findOne({ shipper: load.postedBy, carrier: companyOf(req), isActive: true }).select('tier firstLookHours');
    res.json({ hasAccess: true, isPreferred: !!entry, ...(entry ? { tier: entry.tier, firstLookHours: entry.firstLookHours } : {}) });
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
        shipper: companyOf(req),
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
router.delete('/:id', auth, param('id').isMongoId().withMessage('Valid ID required'), validate, async (req, res) => {
  try {
    if (req.user.role !== 'shipper') {
      return res.status(403).json({ error: 'Only shippers can remove preferred carriers' });
    }

    const entry = await PreferredCarrier.findOneAndDelete({
      _id: req.params.id,
      shipper: companyOf(req),
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
