/**
 * Smart Matching Service
 * Scores loads against carrier preferences and returns ranked results.
 *
 * Score breakdown (total 100 pts):
 *   Equipment match      → 35 pts
 *   Rate meets minimum   → 25 pts
 *   Lane / region match  → 25 pts
 *   Trust score bonus    → 15 pts
 */

const User = require('../models/User');
const Load = require('../models/Load');

// ── Haversine distance in miles ─────────────────────────────────────────────
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Fuzzy string match (case-insensitive substring) ──────────────────────────
function strMatch(a, b) {
  if (!a || !b) return false;
  return (
    a.toLowerCase().includes(b.toLowerCase()) ||
    b.toLowerCase().includes(a.toLowerCase())
  );
}

/**
 * Score a single load against a carrier's preferences.
 * Returns a number 0–100.
 */
function calculateMatchScore(load, carrier) {
  const prefs = carrier.preferences || {};
  let score = 0;

  // ── 1. Equipment type match (35 pts) ────────────────────────────
  const carrierEquip = prefs.equipmentTypes || [];
  if (carrierEquip.length === 0) {
    score += 18; // no preference = half credit
  } else if (load.equipmentType && carrierEquip.some((e) => strMatch(e, load.equipmentType))) {
    score += 35;
  }
  // else 0 — wrong equipment, bad match

  // ── 2. Rate meets carrier minimum (25 pts) ──────────────────────
  const minRate = prefs.minRate || 0;
  if (load.rate >= minRate) {
    // Bonus if rate significantly exceeds minimum
    const overage = minRate > 0 ? (load.rate - minRate) / minRate : 0;
    score += Math.min(25, 15 + Math.floor(overage * 20));
  }
  // rate below minimum = 0 pts

  // ── 3. Lane / region match (25 pts) ─────────────────────────────
  const lanes = prefs.preferredLanes || [];
  const regions = prefs.preferredRegions || [];

  if (lanes.length === 0 && regions.length === 0) {
    score += 12; // no preference = half credit
  } else {
    // Check lane match
    const laneMatch = lanes.some(
      (l) => strMatch(l.origin, load.origin) && strMatch(l.destination, load.destination)
    );
    if (laneMatch) {
      score += 25;
    } else {
      // Check region match (origin or destination in preferred region)
      const regionMatch = regions.some(
        (r) => strMatch(r, load.origin) || strMatch(r, load.destination)
      );
      if (regionMatch) score += 12;
    }
  }

  // ── 4. Trust score bonus (15 pts) ───────────────────────────────
  const ts = carrier.trustScore?.score ?? 50;
  score += Math.round((ts / 100) * 15);

  // ── 5. Mileage penalty ──────────────────────────────────────────
  if (prefs.maxMileage && load.distance && load.distance > prefs.maxMileage) {
    score = Math.max(0, score - 15);
  }

  return Math.min(100, Math.round(score));
}

/**
 * Find and rank open loads for a specific carrier.
 * Returns [{load, score}] sorted descending, up to `limit`.
 */
async function findMatchesForCarrier(carrierId, limit = 20) {
  const carrier = await User.findById(carrierId).lean();
  if (!carrier || carrier.role !== 'carrier') return [];

  const openLoads = await Load.find({ status: 'open' }).lean();

  const scored = openLoads.map((load) => ({
    load,
    score: calculateMatchScore(load, carrier),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Find the best-matched carriers for a specific load.
 * Returns [{carrier, score}] sorted descending, up to `limit`.
 */
async function findMatchesForLoad(loadId, limit = 10) {
  const load = await Load.findById(loadId).lean();
  if (!load) return [];

  // Only verified carriers with available trucks
  const carriers = await User.find({
    role: 'carrier',
    'verification.status': 'verified',
  }).lean();

  const scored = carriers.map((carrier) => ({
    carrier,
    score: calculateMatchScore(load, carrier),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * After a load is posted: find top 5 matching carriers and emit
 * a socket notification to each of them.
 * Non-blocking — errors are swallowed.
 */
async function notifyMatchedCarriers(load, io) {
  try {
    const matches = await findMatchesForLoad(load._id, 5);
    if (!io) return;
    for (const { carrier, score } of matches) {
      if (score < 40) continue; // only notify good matches
      io.to(`user_${carrier._id}`).emit('newLoadMatch', {
        loadId: load._id,
        title: load.title,
        origin: load.origin,
        destination: load.destination,
        rate: load.rate,
        score,
      });
    }
  } catch (err) {
    console.error('[matchingService] notifyMatchedCarriers error:', err.message);
  }
}

module.exports = { calculateMatchScore, findMatchesForCarrier, findMatchesForLoad, notifyMatchedCarriers };
