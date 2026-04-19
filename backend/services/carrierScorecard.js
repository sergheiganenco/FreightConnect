/**
 * carrierScorecard — Carrier performance scorecard generator
 *
 * Aggregates load completion, on-time rates, exceptions, ratings,
 * HOS violations, and verification status over a configurable period.
 *
 * Usage:
 *   const { generateScorecard } = require('../services/carrierScorecard');
 *   const card = await generateScorecard(carrierId, 90);
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const Load = require('../models/Load');
const Rating = require('../models/Rating');
const Exception = require('../models/Exception');

/**
 * Generate a performance scorecard for a carrier over a given period.
 *
 * @param {string} carrierId — User._id of the carrier
 * @param {number} [period=90] — Number of days to look back
 * @returns {Promise<object>} Scorecard object
 */
async function generateScorecard(carrierId, period = 90) {
  const carrierObjId = new mongoose.Types.ObjectId(carrierId);
  const sinceDate = new Date(Date.now() - period * 24 * 60 * 60 * 1000);

  // ── Fetch carrier user ────────────────────────────────────────────────────
  const user = await User.findById(carrierId).select(
    'verification trustScore createdAt'
  );
  if (!user) throw new Error('Carrier not found');

  // ── Load metrics ──────────────────────────────────────────────────────────
  const loadFilter = { acceptedBy: carrierObjId, updatedAt: { $gte: sinceDate } };

  const [totalLoads, completedLoads, lateLoads] = await Promise.all([
    Load.countDocuments({ ...loadFilter, status: { $in: ['accepted', 'in-transit', 'delivered'] } }),
    Load.countDocuments({ ...loadFilter, status: 'delivered' }),
    Load.countDocuments({
      ...loadFilter,
      status: 'delivered',
      deliveredAt: { $exists: true },
      'deliveryTimeWindow.end': { $exists: true },
      $expr: { $gt: ['$deliveredAt', '$deliveryTimeWindow.end'] },
    }),
  ]);

  const onTimeDeliveries = completedLoads - lateLoads;
  const onTimeRate = completedLoads > 0
    ? Math.round((onTimeDeliveries / completedLoads) * 100) / 100
    : 1;

  // Average delivery time (days) for completed loads
  let avgDeliveryTimeDays = 0;
  try {
    const deliveryTimeAgg = await Load.aggregate([
      {
        $match: {
          acceptedBy: carrierObjId,
          status: 'delivered',
          deliveredAt: { $exists: true },
          createdAt: { $gte: sinceDate },
        },
      },
      {
        $project: {
          deliveryDays: {
            $divide: [{ $subtract: ['$deliveredAt', '$createdAt'] }, 1000 * 60 * 60 * 24],
          },
        },
      },
      { $group: { _id: null, avg: { $avg: '$deliveryDays' } } },
    ]);
    if (deliveryTimeAgg.length) {
      avgDeliveryTimeDays = Math.round(deliveryTimeAgg[0].avg * 100) / 100;
    }
  } catch (_) { /* non-critical */ }

  // ── Exception metrics ─────────────────────────────────────────────────────
  let exceptionsFiledAgainst = 0;
  let disputesLost = 0;
  try {
    // Exceptions where the carrier's loads are involved
    const carrierLoadIds = await Load.find({ acceptedBy: carrierObjId })
      .distinct('_id');

    exceptionsFiledAgainst = await Exception.countDocuments({
      loadId: { $in: carrierLoadIds },
      filedByRole: { $in: ['shipper', 'system'] },
      createdAt: { $gte: sinceDate },
    });

    disputesLost = await Exception.countDocuments({
      loadId: { $in: carrierLoadIds },
      filedByRole: { $in: ['shipper', 'system'] },
      type: 'dispute',
      status: 'resolved',
      createdAt: { $gte: sinceDate },
    });
  } catch (_) { /* Exception model may not be available */ }

  const exceptionRate = totalLoads > 0
    ? Math.round((exceptionsFiledAgainst / totalLoads) * 100) / 100
    : 0;

  // ── Rating metrics ────────────────────────────────────────────────────────
  const ratingAvg = await Rating.getAverageForUser(carrierId);

  // ── HOS violations ────────────────────────────────────────────────────────
  let hosViolations = 0;
  try {
    const ELDLog = require('../models/ELDLog');
    const eldLogs = await ELDLog.find({
      carrierId: carrierObjId,
      date: { $gte: sinceDate },
      'violations.0': { $exists: true },
    }).select('violations');
    hosViolations = eldLogs.reduce((sum, log) => sum + log.violations.length, 0);
  } catch (_) { /* ELDLog model may not be available */ }

  // ── Insurance & FMCSA status ──────────────────────────────────────────────
  const insuranceStatus = user.verification?.insurance?.status || 'unknown';
  const fmcsaStatus = user.verification?.status || 'unverified';

  // ── Trust score ───────────────────────────────────────────────────────────
  const trustScore = user.trustScore?.score ?? 50;
  const trustLevel = scoreToLevel(trustScore);

  // ── Trend (compare first half vs second half of period) ───────────────────
  const midDate = new Date(Date.now() - (period / 2) * 24 * 60 * 60 * 1000);
  const [firstHalf, secondHalf] = await Promise.all([
    Load.countDocuments({
      acceptedBy: carrierObjId,
      status: 'delivered',
      deliveredAt: { $gte: sinceDate, $lt: midDate },
    }),
    Load.countDocuments({
      acceptedBy: carrierObjId,
      status: 'delivered',
      deliveredAt: { $gte: midDate },
    }),
  ]);

  let trend = 'stable';
  if (secondHalf > firstHalf * 1.2) trend = 'improving';
  else if (secondHalf < firstHalf * 0.8 && firstHalf > 0) trend = 'declining';

  return {
    carrierId,
    period,
    metrics: {
      totalLoads,
      completedLoads,
      onTimeDeliveries,
      onTimeRate,
      avgDeliveryTimeDays,
      exceptionsFiledAgainst,
      exceptionRate,
      disputesLost,
      avgRating: ratingAvg.overall,
      ratingCount: ratingAvg.count,
      hosViolations,
      insuranceStatus,
      fmcsaStatus,
    },
    trustScore,
    trustLevel,
    trend,
    generatedAt: new Date(),
  };
}

/**
 * Map numeric trust score to level label.
 * @param {number} score
 * @returns {string}
 */
function scoreToLevel(score) {
  if (score <= 20) return 'new';
  if (score <= 40) return 'basic';
  if (score <= 60) return 'verified';
  if (score <= 80) return 'trusted';
  return 'elite';
}

module.exports = { generateScorecard };
