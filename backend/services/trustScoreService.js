const User = require('../models/User');

/**
 * Recalculate trust score for a user from their stats.
 * Saves to DB and returns the new score.
 */
async function calculateTrustScore(userId) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const ts = user.trustScore || {};
  let score = 50; // Base

  // ── Positive signals ──────────────────────────────────────────
  const completed = ts.totalLoadsCompleted || 0;
  const onTimeRate = ts.onTimeRate ?? 100;
  const disputeRate = ts.disputeResolutionRate ?? 100;

  // Per on-time delivery (+5 each, up to 30)
  score += Math.min(completed * 5, 30);

  // On-time rate bonus/penalty (scaled around 100%)
  score += Math.round((onTimeRate - 100) * 0.3);

  // Dispute resolution (scaled around 100%)
  score += Math.round((disputeRate - 100) * 0.15);

  // Claims penalty (-8 each)
  score -= (ts.claimsCount || 0) * 8;

  // Cancellation rate penalty (>5% triggers -10)
  if ((ts.cancellationRate || 0) > 5) score -= 10;

  // Verification bonus (+2, one-time)
  if (user.verification?.status === 'verified') score += 2;

  // Tenure bonus: +1 per quarter on platform (max +8 for 2 years)
  const joined = user.createdAt || new Date();
  const quarters = Math.floor((Date.now() - joined.getTime()) / (90 * 24 * 60 * 60 * 1000));
  score += Math.min(quarters, 8);

  // Milestone: first 10 loads bonus (+5)
  if (completed >= 10) score += 5;

  // Clamp 0-100
  score = Math.max(0, Math.min(100, Math.round(score)));

  user.trustScore.score = score;
  user.trustScore.lastCalculated = new Date();
  await user.save();

  return score;
}

/**
 * Apply a point change with a history entry.
 * reason: string describing why (e.g. 'on_time_delivery', 'claim_filed')
 * points: positive or negative number
 */
async function adjustScore(userId, reason, points) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  if (!user.trustScore) user.trustScore = { score: 50, history: [] };

  const prev = user.trustScore.score;
  const next = Math.max(0, Math.min(100, prev + points));

  user.trustScore.score = next;
  user.trustScore.lastCalculated = new Date();
  user.trustScore.history.push({
    score: next,
    reason,
    change: points,
    date: new Date(),
  });

  // Keep history to last 50 entries
  if (user.trustScore.history.length > 50) {
    user.trustScore.history = user.trustScore.history.slice(-50);
  }

  // Auto-suspend at 0
  if (next === 0 && user.role === 'carrier') {
    user.verification = user.verification || {};
    user.verification.status = 'suspended';
  }

  await user.save();
  return next;
}

/**
 * Return score breakdown for display on frontend.
 */
async function getScoreBreakdown(userId) {
  const user = await User.findById(userId).select('trustScore verification role createdAt');
  if (!user) throw new Error('User not found');

  const ts = user.trustScore || {};
  const score = ts.score ?? 50;

  let tier = 'warning';
  let color = '#fbbf24';
  if (score >= 70) { tier = 'trusted'; color = '#34d399'; }
  else if (score < 40) { tier = 'risk'; color = '#ef4444'; }

  return {
    score,
    tier,
    color,
    onTimeRate: ts.onTimeRate ?? 100,
    cancellationRate: ts.cancellationRate ?? 0,
    claimsCount: ts.claimsCount ?? 0,
    disputeResolutionRate: ts.disputeResolutionRate ?? 100,
    totalLoadsCompleted: ts.totalLoadsCompleted ?? 0,
    lastCalculated: ts.lastCalculated,
    history: (ts.history || []).slice(-10),
    verificationStatus: user.verification?.status || 'unverified',
    memberSince: user.createdAt,
  };
}

module.exports = { calculateTrustScore, adjustScore, getScoreBreakdown };
