/**
 * fraudDetectionService.js — Detects common trucking fraud patterns
 *
 * Detection patterns:
 *   1. Double-brokering: carrier accepts load then posts a suspiciously similar one
 *   2. Identity red flags: high cancel ratio, new accounts taking high-value loads
 *   3. Price manipulation: undercutting bids by exactly $1, suspiciously low shipper rates
 *   4. Unusual patterns: velocity abuse (too many loads), dormant account bursts
 */

const Load      = require('../models/Load');
const User      = require('../models/User');
const Bid       = require('../models/Bid');
const FraudAlert = require('../models/FraudAlert');
const { notifyUserSafe } = require('../utils/notifyUser');
const { adjustScore }    = require('./trustScoreService');

// ── Thresholds ───────────────────────────────────────────────────────────────
const DOUBLE_BROKER_WINDOW_MS    = 60 * 60 * 1000;   // 1 hour
const DOUBLE_BROKER_RATE_MARGIN  = 0.15;              // 15% rate difference threshold
const HIGH_VALUE_LOAD_THRESHOLD  = 5000;              // $5,000+
const NEW_ACCOUNT_DAYS           = 7;                 // account age to be "new"
const CANCEL_RATIO_THRESHOLD     = 0.40;              // 40%+ cancel rate is suspicious
const MIN_LOADS_FOR_CANCEL_CHECK = 5;                 // need at least 5 loads to judge
const VELOCITY_MAX_ACTIVE_LOADS  = 10;                // more than 10 simultaneous active loads
const DORMANT_MONTHS             = 3;                 // 3 months of no activity
const DORMANT_BURST_THRESHOLD    = 5;                 // 5+ loads accepted in 24h after dormancy
const UNDERCUT_AMOUNT            = 1;                 // exactly $1 undercut
const UNDERCUT_MIN_OCCURRENCES   = 3;                 // need 3+ instances to flag
const LOW_RATE_PERCENTILE        = 0.5;               // below 50% of avg market rate
const CRITICAL_FRAUD_SCORE       = 80;                // auto-suspend threshold
const LOOKBACK_HOURS             = 6;                 // how far back to scan per run

/**
 * Create a fraud alert if a similar one doesn't already exist (idempotent).
 * Returns the alert if created, null if duplicate.
 */
async function createAlert(userId, type, severity, description, evidence, autoAction = 'none') {
  // Idempotent: don't duplicate open/investigating alerts of same type for same user
  const existing = await FraudAlert.findOne({
    user: userId,
    type,
    status: { $in: ['open', 'investigating'] },
  });
  if (existing) return null;

  const alert = await FraudAlert.create({
    user: userId,
    type,
    severity,
    description,
    evidence,
    autoAction,
  });

  // Notify all admins
  const admins = await User.find({ role: 'admin' }).select('_id');
  for (const admin of admins) {
    await notifyUserSafe(admin._id, {
      type: 'fraud_alert',
      title: `Fraud Alert: ${type.replace(/_/g, ' ')} [${severity.toUpperCase()}]`,
      body: description,
      link: '/dashboard/admin/fraud',
      metadata: { alertId: alert._id, userId, type, severity },
    });
  }

  return alert;
}

// ── Pattern 1: Double-Brokering ──────────────────────────────────────────────
async function detectDoubleBrokering(lookbackDate) {
  let flagged = 0;

  // Find loads accepted by carriers in the lookback window
  const recentlyAccepted = await Load.find({
    status: { $in: ['accepted', 'in-transit'] },
    acceptedBy: { $ne: null },
    updatedAt: { $gte: lookbackDate },
  }).select('_id acceptedBy origin destination originLat originLng destinationLat destinationLng rate updatedAt');

  for (const accepted of recentlyAccepted) {
    const carrierId = accepted.acceptedBy;

    // Check if this carrier (as a shipper) posted a similar load shortly after accepting
    const suspicious = await Load.find({
      postedBy: carrierId,
      status: 'open',
      createdAt: {
        $gte: accepted.updatedAt,
        $lte: new Date(accepted.updatedAt.getTime() + DOUBLE_BROKER_WINDOW_MS),
      },
    }).select('_id origin destination rate createdAt');

    for (const posted of suspicious) {
      // Check lane similarity: same origin/destination text (case-insensitive)
      const sameOrigin = accepted.origin.toLowerCase().trim() === posted.origin.toLowerCase().trim();
      const sameDestination = accepted.destination.toLowerCase().trim() === posted.destination.toLowerCase().trim();

      if (!sameOrigin || !sameDestination) continue;

      // Check rate: posted rate should be lower (carrier skimming margin)
      const rateDiff = (accepted.rate - posted.rate) / accepted.rate;
      if (rateDiff < 0 || rateDiff > DOUBLE_BROKER_RATE_MARGIN) continue;

      // This looks like double-brokering
      const alert = await createAlert(
        carrierId,
        'double_brokering',
        'critical',
        `Carrier accepted load (${accepted.origin} -> ${accepted.destination}, $${accepted.rate}) ` +
        `then posted a matching load ${Math.round((posted.createdAt - accepted.updatedAt) / 60000)} minutes later ` +
        `at $${posted.rate} (${Math.round(rateDiff * 100)}% margin).`,
        {
          acceptedLoadId: accepted._id,
          postedLoadId: posted._id,
          acceptedRate: accepted.rate,
          postedRate: posted.rate,
          marginPercent: Math.round(rateDiff * 100),
          timeBetweenMinutes: Math.round((posted.createdAt - accepted.updatedAt) / 60000),
          lane: `${accepted.origin} -> ${accepted.destination}`,
        },
        'warning'
      );

      if (alert) {
        flagged++;
        await adjustScore(carrierId, 'fraud_double_brokering_alert', -15);
      }
    }
  }

  return flagged;
}

// ── Pattern 2: Identity Red Flags ────────────────────────────────────────────
async function detectIdentityRedFlags(lookbackDate) {
  let flagged = 0;

  // 2a. High accept-to-cancel ratio
  const carriers = await User.find({ role: 'carrier' }).select('_id name companyName createdAt');

  for (const carrier of carriers) {
    const totalAccepted = await Load.countDocuments({ acceptedBy: carrier._id });
    if (totalAccepted < MIN_LOADS_FOR_CANCEL_CHECK) continue;

    const totalCancelled = await Load.countDocuments({
      acceptedBy: carrier._id,
      status: 'cancelled',
      cancelledBy: carrier._id,
    });

    const cancelRatio = totalCancelled / totalAccepted;
    if (cancelRatio >= CANCEL_RATIO_THRESHOLD) {
      const alert = await createAlert(
        carrier._id,
        'identity_fraud',
        cancelRatio >= 0.6 ? 'high' : 'medium',
        `Carrier "${carrier.name}" has a ${Math.round(cancelRatio * 100)}% cancellation rate ` +
        `(${totalCancelled}/${totalAccepted} loads). Possible bad actor or non-serious carrier.`,
        {
          totalAccepted,
          totalCancelled,
          cancelRatio: Math.round(cancelRatio * 100),
          carrierName: carrier.name,
          companyName: carrier.companyName,
        }
      );
      if (alert) flagged++;
    }
  }

  // 2b. New accounts immediately accepting high-value loads
  const newAccountCutoff = new Date(Date.now() - NEW_ACCOUNT_DAYS * 24 * 60 * 60 * 1000);
  const newCarriers = await User.find({
    role: 'carrier',
    createdAt: { $gte: newAccountCutoff },
  }).select('_id name createdAt');

  for (const nc of newCarriers) {
    const highValueLoads = await Load.find({
      acceptedBy: nc._id,
      rate: { $gte: HIGH_VALUE_LOAD_THRESHOLD },
      status: { $in: ['accepted', 'in-transit'] },
    }).select('_id rate title');

    if (highValueLoads.length > 0) {
      const accountAgeDays = Math.round((Date.now() - nc.createdAt.getTime()) / (24 * 60 * 60 * 1000));
      const alert = await createAlert(
        nc._id,
        'identity_fraud',
        'high',
        `New carrier account (${accountAgeDays} days old) accepted ${highValueLoads.length} high-value ` +
        `load(s) worth $${highValueLoads.reduce((s, l) => s + l.rate, 0).toLocaleString()}+. ` +
        `Verify identity before loads move.`,
        {
          accountAgeDays,
          loads: highValueLoads.map(l => ({ id: l._id, rate: l.rate, title: l.title })),
          totalValue: highValueLoads.reduce((s, l) => s + l.rate, 0),
        }
      );
      if (alert) flagged++;
    }
  }

  return flagged;
}

// ── Pattern 3: Price Manipulation ────────────────────────────────────────────
async function detectPriceManipulation(lookbackDate) {
  let flagged = 0;

  // 3a. Carrier consistently bids exactly $1 under lowest bid
  const carriers = await User.find({ role: 'carrier' }).select('_id name');

  for (const carrier of carriers) {
    const carrierBids = await Bid.find({
      carrierId: carrier._id,
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // last 30 days
    }).select('loadId amount createdAt');

    let undercutCount = 0;
    const undercutEvidence = [];

    for (const bid of carrierBids) {
      // Find the lowest OTHER bid on same load placed BEFORE this one
      const lowestOtherBid = await Bid.findOne({
        loadId: bid.loadId,
        carrierId: { $ne: carrier._id },
        createdAt: { $lt: bid.createdAt },
      }).sort({ amount: 1 }).select('amount carrierId');

      if (lowestOtherBid && Math.abs(lowestOtherBid.amount - bid.amount - UNDERCUT_AMOUNT) < 0.01) {
        undercutCount++;
        undercutEvidence.push({
          loadId: bid.loadId,
          bidAmount: bid.amount,
          lowestOtherBid: lowestOtherBid.amount,
          diff: lowestOtherBid.amount - bid.amount,
        });
      }
    }

    if (undercutCount >= UNDERCUT_MIN_OCCURRENCES) {
      const alert = await createAlert(
        carrier._id,
        'price_manipulation',
        'medium',
        `Carrier "${carrier.name}" bid exactly $1 under the lowest bid ${undercutCount} times ` +
        `in the last 30 days. Possible bid scraping or insider information.`,
        {
          undercutCount,
          totalBids: carrierBids.length,
          examples: undercutEvidence.slice(0, 5),
        }
      );
      if (alert) flagged++;
    }
  }

  // 3b. Shipper posting loads at suspiciously low rates
  const avgRateResult = await Load.aggregate([
    { $match: { status: { $ne: 'cancelled' }, rate: { $gt: 0 } } },
    { $group: { _id: null, avgRate: { $avg: '$rate' } } },
  ]);

  if (avgRateResult.length > 0) {
    const avgRate = avgRateResult[0].avgRate;
    const lowRateThreshold = avgRate * LOW_RATE_PERCENTILE;

    const suspiciousLoads = await Load.find({
      createdAt: { $gte: lookbackDate },
      rate: { $lt: lowRateThreshold, $gt: 0 },
      status: 'open',
    }).select('_id postedBy rate origin destination');

    // Group by shipper
    const shipperLoads = {};
    for (const load of suspiciousLoads) {
      const key = load.postedBy?.toString();
      if (!key) continue;
      if (!shipperLoads[key]) shipperLoads[key] = [];
      shipperLoads[key].push(load);
    }

    for (const [shipperId, loads] of Object.entries(shipperLoads)) {
      if (loads.length < 2) continue; // need a pattern, not a one-off

      const alert = await createAlert(
        shipperId,
        'price_manipulation',
        'low',
        `Shipper posted ${loads.length} loads at rates below 50% of platform average ($${Math.round(avgRate)}). ` +
        `Rates range from $${Math.min(...loads.map(l => l.rate))} to $${Math.max(...loads.map(l => l.rate))}. ` +
        `May be manipulating market rate data.`,
        {
          avgPlatformRate: Math.round(avgRate),
          lowRateThreshold: Math.round(lowRateThreshold),
          loads: loads.map(l => ({ id: l._id, rate: l.rate, lane: `${l.origin} -> ${l.destination}` })),
        }
      );
      if (alert) flagged++;
    }
  }

  return flagged;
}

// ── Pattern 4: Unusual Activity ──────────────────────────────────────────────
async function detectUnusualActivity(lookbackDate) {
  let flagged = 0;

  // 4a. Velocity abuse: carrier has too many simultaneous active loads
  const activeLoadCounts = await Load.aggregate([
    { $match: { status: { $in: ['accepted', 'in-transit'] }, acceptedBy: { $ne: null } } },
    { $group: { _id: '$acceptedBy', count: { $sum: 1 } } },
    { $match: { count: { $gt: VELOCITY_MAX_ACTIVE_LOADS } } },
  ]);

  for (const entry of activeLoadCounts) {
    const carrier = await User.findById(entry._id).select('name fleet');
    if (!carrier) continue;

    // Allow more loads if carrier has a large fleet
    const fleetSize = (carrier.fleet || []).length;
    const adjustedMax = Math.max(VELOCITY_MAX_ACTIVE_LOADS, fleetSize * 2);
    if (entry.count <= adjustedMax) continue;

    const alert = await createAlert(
      entry._id,
      'velocity_abuse',
      entry.count > adjustedMax * 2 ? 'high' : 'medium',
      `Carrier "${carrier.name}" has ${entry.count} active loads simultaneously ` +
      `(fleet size: ${fleetSize} trucks, threshold: ${adjustedMax}). ` +
      `Cannot physically deliver this volume.`,
      {
        activeLoadCount: entry.count,
        fleetSize,
        threshold: adjustedMax,
      }
    );
    if (alert) flagged++;
  }

  // 4b. Dormant account burst: no activity for months, then sudden spike
  const dormantCutoff = new Date(Date.now() - DORMANT_MONTHS * 30 * 24 * 60 * 60 * 1000);
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Find carriers who accepted loads in the last 24h
  const recentAcceptors = await Load.aggregate([
    {
      $match: {
        acceptedBy: { $ne: null },
        updatedAt: { $gte: last24h },
        status: { $in: ['accepted', 'in-transit'] },
      },
    },
    { $group: { _id: '$acceptedBy', recentCount: { $sum: 1 } } },
    { $match: { recentCount: { $gte: DORMANT_BURST_THRESHOLD } } },
  ]);

  for (const entry of recentAcceptors) {
    // Check if carrier had NO activity in the dormant period before the burst
    const priorActivity = await Load.countDocuments({
      acceptedBy: entry._id,
      updatedAt: { $gte: dormantCutoff, $lt: last24h },
      status: { $in: ['accepted', 'in-transit', 'delivered'] },
    });

    if (priorActivity > 0) continue; // not dormant

    const carrier = await User.findById(entry._id).select('name');
    if (!carrier) continue;

    const alert = await createAlert(
      entry._id,
      'unusual_activity',
      'high',
      `Carrier "${carrier.name}" was dormant for ${DORMANT_MONTHS}+ months, then accepted ` +
      `${entry.recentCount} loads in the last 24 hours. Possible account takeover.`,
      {
        dormantMonths: DORMANT_MONTHS,
        priorActivityCount: priorActivity,
        burstCount: entry.recentCount,
      }
    );
    if (alert) flagged++;
  }

  return flagged;
}

// ── Fraud Risk Score ─────────────────────────────────────────────────────────
/**
 * Calculate a fraud risk score for a user (0-100).
 * Considers open/confirmed alerts, account age, verification, and trust score.
 */
async function calculateFraudScore(userId) {
  const user = await User.findById(userId).select('role verification trustScore createdAt');
  if (!user) return { score: 0, factors: [] };

  let score = 0;
  const factors = [];

  // Active fraud alerts
  const alerts = await FraudAlert.find({
    user: userId,
    status: { $in: ['open', 'investigating', 'confirmed'] },
  }).select('type severity');

  const severityWeights = { low: 5, medium: 15, high: 30, critical: 50 };
  for (const alert of alerts) {
    const weight = severityWeights[alert.severity] || 10;
    score += weight;
    factors.push({
      type: alert.type,
      severity: alert.severity,
      points: weight,
    });
  }

  // Account age factor: newer = riskier
  const ageDays = Math.round((Date.now() - user.createdAt.getTime()) / (24 * 60 * 60 * 1000));
  if (ageDays < 7) {
    score += 10;
    factors.push({ type: 'new_account', detail: `${ageDays} days old`, points: 10 });
  }

  // Unverified = riskier
  if (user.verification?.status !== 'verified') {
    score += 10;
    factors.push({ type: 'unverified', detail: user.verification?.status || 'unverified', points: 10 });
  }

  // Low trust score = riskier
  const trustScore = user.trustScore?.score ?? 50;
  if (trustScore < 30) {
    score += 15;
    factors.push({ type: 'low_trust', detail: `Trust score: ${trustScore}`, points: 15 });
  }

  score = Math.min(100, score);

  return { score, factors, alertCount: alerts.length };
}

// ── Auto-Suspend ─────────────────────────────────────────────────────────────
/**
 * Auto-suspend users with critical fraud scores.
 */
async function autoSuspendCritical() {
  let suspended = 0;

  const openAlerts = await FraudAlert.find({
    status: 'open',
    severity: 'critical',
    autoAction: 'none',
  }).select('user');

  const userIds = [...new Set(openAlerts.map(a => a.user.toString()))];

  for (const userId of userIds) {
    const { score } = await calculateFraudScore(userId);
    if (score < CRITICAL_FRAUD_SCORE) continue;

    const user = await User.findById(userId);
    if (!user || user.role === 'admin') continue; // never auto-suspend admins

    // Suspend the account
    if (!user.verification) user.verification = {};
    user.verification.status = 'suspended';
    await user.save();

    // Mark alerts as auto-actioned
    await FraudAlert.updateMany(
      { user: userId, status: 'open', severity: 'critical' },
      { $set: { autoAction: 'suspended' } }
    );

    // Notify the user
    await notifyUserSafe(userId, {
      type: 'account_suspended',
      title: 'Account Suspended',
      body: 'Your account has been suspended due to suspicious activity. Please contact support.',
      link: '/contact',
    });

    // Trust score penalty
    await adjustScore(userId, 'fraud_auto_suspended', -25);

    suspended++;
    console.log(`[FraudDetection] Auto-suspended user ${userId} (fraud score: ${score})`);
  }

  return suspended;
}

// ── Run All Detections ───────────────────────────────────────────────────────
async function runAllDetections() {
  const lookbackDate = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
  const results = {};

  results.doubleBrokering   = await detectDoubleBrokering(lookbackDate);
  results.identityRedFlags  = await detectIdentityRedFlags(lookbackDate);
  results.priceManipulation = await detectPriceManipulation(lookbackDate);
  results.unusualActivity   = await detectUnusualActivity(lookbackDate);
  results.autoSuspended     = await autoSuspendCritical();

  const total = Object.values(results).reduce((s, v) => s + v, 0);
  return { ...results, total };
}

module.exports = {
  detectDoubleBrokering,
  detectIdentityRedFlags,
  detectPriceManipulation,
  detectUnusualActivity,
  calculateFraudScore,
  autoSuspendCritical,
  runAllDetections,
};
