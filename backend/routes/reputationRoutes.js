/**
 * reputationRoutes.js — Public Reputation & Trust Badges
 *
 * These endpoints surface trust data that BOTH sides can see before committing:
 *   - Carriers see: shipper's payment speed, facility wait times, load accuracy
 *   - Shippers see: carrier's on-time %, cargo claims, trust tier, insurance status
 *
 * This builds platform confidence: "I can trust this person because I can SEE their track record."
 *
 * GET /api/reputation/:userId          — public reputation profile
 * GET /api/reputation/:userId/badges   — earned badges list
 * GET /api/reputation/facility/:name   — facility reputation (wait times)
 */

const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/authMiddleware');
const User    = require('../models/User');
const Load    = require('../models/Load');
const Rating  = require('../models/Rating');
const DwellEvent = require('../models/DwellEvent');
const { getScoreBreakdown } = require('../services/trustScoreService');
const { getFacilityStats }  = require('../services/detentionService');

// ── Badge definitions ────────────────────────────────────────────────────────
// Badges are earned based on verifiable on-platform behavior.
// Each badge has a condition function + display metadata.
const BADGE_DEFS = [
  // Carrier badges
  {
    id: 'verified_carrier',
    label: 'Verified Carrier',
    description: 'FMCSA verified with active authority',
    icon: 'verified',
    color: '#34d399',
    role: 'carrier',
    check: (user) => user.verification?.status === 'verified',
  },
  {
    id: 'on_time_pro',
    label: 'On-Time Pro',
    description: '95%+ on-time delivery rate (min 10 loads)',
    icon: 'schedule',
    color: '#6366f1',
    role: 'carrier',
    check: (user) => (user.trustScore?.onTimeRate || 0) >= 95 && (user.trustScore?.totalLoadsCompleted || 0) >= 10,
  },
  {
    id: 'road_warrior',
    label: 'Road Warrior',
    description: '50+ loads delivered on the platform',
    icon: 'local_shipping',
    color: '#f97316',
    role: 'carrier',
    check: (user) => (user.trustScore?.totalLoadsCompleted || 0) >= 50,
  },
  {
    id: 'rising_star',
    label: 'Rising Star',
    description: '10+ loads delivered',
    icon: 'trending_up',
    color: '#fbbf24',
    role: 'carrier',
    check: (user) => (user.trustScore?.totalLoadsCompleted || 0) >= 10 && (user.trustScore?.totalLoadsCompleted || 0) < 50,
  },
  {
    id: 'zero_claims',
    label: 'Zero Claims',
    description: 'No cargo damage claims filed',
    icon: 'shield',
    color: '#22c55e',
    role: 'carrier',
    check: (user) => (user.trustScore?.claimsCount || 0) === 0 && (user.trustScore?.totalLoadsCompleted || 0) >= 5,
  },
  {
    id: 'top_rated',
    label: 'Top Rated',
    description: '4.5+ average rating (min 5 reviews)',
    icon: 'star',
    color: '#eab308',
    role: 'carrier',
    // checked via ratings query below
    check: null,
  },
  {
    id: 'insured',
    label: 'Fully Insured',
    description: 'Cargo + auto liability insurance verified & current',
    icon: 'security',
    color: '#3b82f6',
    role: 'carrier',
    check: (user) => {
      const ins = user.verification?.insurance;
      return ins?.cargoLiability?.status === 'valid' && ins?.autoLiability?.status === 'valid';
    },
  },

  // Shipper badges
  {
    id: 'fast_payer',
    label: 'Fast Payer',
    description: 'Average payment within 48 hours of delivery',
    icon: 'payments',
    color: '#34d399',
    role: 'shipper',
    // checked via ratings query below
    check: null,
  },
  {
    id: 'volume_shipper',
    label: 'Volume Shipper',
    description: '50+ loads posted on the platform',
    icon: 'inventory',
    color: '#6366f1',
    role: 'shipper',
    check: null, // checked via load count
  },
  {
    id: 'reliable_shipper',
    label: 'Reliable Shipper',
    description: 'Low cancellation rate (<3%) with 10+ loads',
    icon: 'verified_user',
    color: '#22c55e',
    role: 'shipper',
    check: (user) => (user.trustScore?.cancellationRate || 0) < 3 && (user.trustScore?.totalLoadsCompleted || 0) >= 10,
  },
  {
    id: 'shipper_top_rated',
    label: 'Top Rated Shipper',
    description: '4.5+ average rating from carriers',
    icon: 'star',
    color: '#eab308',
    role: 'shipper',
    check: null,
  },
];

// ── GET /:userId — Public reputation profile ────────────────────────────────
router.get('/:userId', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select('name companyName role verification trustScore createdAt');
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Trust score breakdown
    const breakdown = await getScoreBreakdown(req.params.userId);

    // Rating averages
    const ratings = await Rating.getAverageForUser(req.params.userId);

    // Load stats
    const isCarrier = user.role === 'carrier';
    const loadFilter = isCarrier
      ? { acceptedBy: user._id, status: 'delivered' }
      : { postedBy: user._id, status: 'delivered' };
    const totalDelivered = await Load.countDocuments(loadFilter);

    // For shippers: facility reputation (average wait times at their facilities)
    let facilityReputation = null;
    if (!isCarrier) {
      const mongoose = require('mongoose');
      const dwellPipeline = [
        { $match: { shipper: new mongoose.Types.ObjectId(req.params.userId), departedAt: { $ne: null } } },
        {
          $group: {
            _id: null,
            avgDwellMin:     { $avg: '$dwellMinutes' },
            avgDetentionMin: { $avg: '$detentionMinutes' },
            totalEvents:     { $sum: 1 },
            detentionEvents: { $sum: { $cond: [{ $gt: ['$detentionMinutes', 0] }, 1, 0] } },
          },
        },
      ];
      const [dwellResult] = await DwellEvent.aggregate(dwellPipeline);
      if (dwellResult) {
        facilityReputation = {
          avgWaitMinutes: Math.round(dwellResult.avgDwellMin),
          detentionRate:  Math.round((dwellResult.detentionEvents / dwellResult.totalEvents) * 100),
          totalVisits:    dwellResult.totalEvents,
        };
      }
    }

    // Member tenure
    const memberMonths = Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (30 * 24 * 60 * 60 * 1000));

    res.json({
      userId: user._id,
      name: user.name,
      companyName: user.companyName,
      role: user.role,
      trustScore: breakdown,
      ratings: {
        overall: ratings.overall,
        communication: ratings.communication,
        punctuality: ratings.punctuality,
        professionalism: ratings.professionalism,
        count: ratings.count,
      },
      stats: {
        totalDelivered,
        memberMonths,
        onTimeRate: breakdown.onTimeRate,
        cancellationRate: breakdown.cancellationRate,
      },
      facilityReputation,
      verificationStatus: user.verification?.status || 'unverified',
      insuranceStatus: isCarrier ? {
        cargo: user.verification?.insurance?.cargoLiability?.status || 'unknown',
        auto: user.verification?.insurance?.autoLiability?.status || 'unknown',
      } : undefined,
    });
  } catch (err) {
    console.error('Error fetching reputation:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /:userId/badges — Earned badges ─────────────────────────────────────
router.get('/:userId/badges', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select('role verification trustScore createdAt');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const ratings = await Rating.getAverageForUser(req.params.userId);

    // Count loads for shipper badges
    const loadCount = user.role === 'shipper'
      ? await Load.countDocuments({ postedBy: user._id })
      : 0;

    const earned = [];

    for (const badge of BADGE_DEFS) {
      // Skip badges for wrong role
      if (badge.role !== user.role) continue;

      let isEarned = false;

      // Special checks that need external data
      if (badge.id === 'top_rated' || badge.id === 'shipper_top_rated') {
        isEarned = ratings.overall >= 4.5 && ratings.count >= 5;
      } else if (badge.id === 'fast_payer') {
        // Check via shipper ratings — paymentSpeed category
        const paymentRatings = await Rating.aggregate([
          { $match: { toUser: user._id, 'categories.paymentSpeed': { $exists: true, $ne: null } } },
          { $group: { _id: null, avg: { $avg: '$categories.paymentSpeed' }, count: { $sum: 1 } } },
        ]);
        isEarned = paymentRatings.length > 0 && paymentRatings[0].avg >= 4.0 && paymentRatings[0].count >= 5;
      } else if (badge.id === 'volume_shipper') {
        isEarned = loadCount >= 50;
      } else if (badge.check) {
        isEarned = badge.check(user);
      }

      if (isEarned) {
        earned.push({
          id: badge.id,
          label: badge.label,
          description: badge.description,
          icon: badge.icon,
          color: badge.color,
        });
      }
    }

    res.json({ userId: req.params.userId, role: user.role, badges: earned });
  } catch (err) {
    console.error('Error fetching badges:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /facility/:name — Facility reputation ──────────────────────────────
router.get('/facility/:name', auth, async (req, res) => {
  try {
    const stats = await getFacilityStats(decodeURIComponent(req.params.name));
    if (!stats) return res.json({ facilityName: req.params.name, stats: {}, message: 'No data yet' });
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
