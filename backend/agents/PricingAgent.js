/**
 * PricingAgent — dynamically adjusts rate suggestions based on real-time
 * supply/demand per lane.
 *
 * Runs every 5 minutes. Analyzes open loads and available carriers per lane
 * (origin_state → dest_state), calculates a "market heat" score, and persists
 * results in the MarketInsight model. Other services can call
 * `getMarketInsight(originState, destState)` for on-demand lookups.
 *
 * Heat score 0–100:
 *   80–100 = "hot"         (demand >> supply → suggest higher rates)
 *   40–79  = "balanced"
 *   0–39   = "competitive" (supply >> demand → suggest lower rates)
 */

const { Agent } = require('./AgentFramework');
const Load = require('../models/Load');
const User = require('../models/User');
const MarketInsight = require('../models/MarketInsight');

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract state abbreviation from an address string.
 * Tries the last comma-separated token, trimmed to 2-char uppercase.
 * Falls back to the whole string uppercased.
 */
function extractState(address) {
  if (!address) return 'XX';
  const parts = address.split(',');
  const last = (parts[parts.length - 1] || '').trim();
  // Handle "City, ST 12345" or "City, State"
  const stateMatch = last.match(/^([A-Za-z]{2})\b/);
  if (stateMatch) return stateMatch[1].toUpperCase();
  return last.substring(0, 2).toUpperCase() || 'XX';
}

/** Base CPM (cents per mile) by equipment — mirrors rateSuggestionService */
const BASE_CPM = {
  'Dry Van': 285, 'Reefer': 340, 'Flatbed': 310, 'Step Deck': 300,
  'Lowboy': 360, 'Tanker': 320, 'Box Truck': 250, 'Power Only': 220,
  'Conestoga': 315, 'RGN': 380,
};
const DEFAULT_CPM = 290;

// ── Public helper (called by routes without waiting for agent tick) ─────────

/**
 * Get the latest market insight for a lane + optional equipment type.
 * @param {string} originState — 2-char state code
 * @param {string} destState   — 2-char state code
 * @param {string} [equipmentType]
 * @returns {Promise<Object|null>}
 */
async function getMarketInsight(originState, destState, equipmentType) {
  const lane = `${originState.toUpperCase()}-${destState.toUpperCase()}`;
  const query = { lane };
  if (equipmentType) query.equipmentType = equipmentType;
  return MarketInsight.findOne(query).sort({ calculatedAt: -1 }).lean();
}

// ── Agent class ─────────────────────────────────────────────────────────────

class PricingAgent extends Agent {
  constructor() {
    super('PricingAgent', { intervalMs: 5 * 60_000 }); // every 5 min
  }

  /** @returns {Promise<number>} number of market insight records upserted */
  async execute() {
    // 1. Aggregate open loads by lane + equipment
    const openLoads = await Load.find({ status: 'open' })
      .select('origin destination equipmentType rate')
      .lean();

    // 2. Build lane buckets
    /** @type {Map<string, { loads: any[], equipmentType: string }>} */
    const laneBuckets = new Map();

    for (const load of openLoads) {
      const oState = extractState(load.origin);
      const dState = extractState(load.destination);
      const equip = load.equipmentType || 'Dry Van';
      const key = `${oState}-${dState}::${equip}`;

      if (!laneBuckets.has(key)) {
        laneBuckets.set(key, { loads: [], equipmentType: equip, lane: `${oState}-${dState}` });
      }
      laneBuckets.get(key).loads.push(load);
    }

    // 3. Count available carriers per equipment type
    const carriers = await User.find({
      role: 'carrier',
      'verification.status': 'verified',
    })
      .select('preferences.equipmentTypes fleet')
      .lean();

    /** @type {Map<string, number>} equipmentType → count of available carriers */
    const carriersByEquip = new Map();
    for (const c of carriers) {
      const types = c.preferences?.equipmentTypes || ['Dry Van'];
      const hasAvailable = (c.fleet || []).some((t) => t.available);
      if (!hasAvailable && (c.fleet || []).length > 0) continue;
      for (const t of types) {
        carriersByEquip.set(t, (carriersByEquip.get(t) || 0) + 1);
      }
    }

    // 4. Historical acceptance rates per lane (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentLoads = await Load.find({
      createdAt: { $gte: thirtyDaysAgo },
      status: { $in: ['accepted', 'in-transit', 'delivered', 'open', 'cancelled'] },
    })
      .select('origin destination equipmentType status rate')
      .lean();

    /** @type {Map<string, { total: number, accepted: number, rates: number[] }>} */
    const laneHistory = new Map();
    for (const rl of recentLoads) {
      const oS = extractState(rl.origin);
      const dS = extractState(rl.destination);
      const key = `${oS}-${dS}::${rl.equipmentType || 'Dry Van'}`;
      if (!laneHistory.has(key)) laneHistory.set(key, { total: 0, accepted: 0, rates: [] });
      const h = laneHistory.get(key);
      h.total++;
      if (['accepted', 'in-transit', 'delivered'].includes(rl.status)) {
        h.accepted++;
        if (rl.rate) h.rates.push(rl.rate);
      }
    }

    // 5. Compute heat score and upsert MarketInsight
    let actionCount = 0;
    const validUntil = new Date(Date.now() + 10 * 60_000); // valid 10 min

    for (const [key, bucket] of laneBuckets) {
      try {
        const loadCount = bucket.loads.length;
        const carrierCount = carriersByEquip.get(bucket.equipmentType) || 0;
        const hist = laneHistory.get(key) || { total: 0, accepted: 0, rates: [] };
        const acceptanceRate = hist.total > 0 ? hist.accepted / hist.total : 0.5;

        // Heat = f(demand/supply ratio, acceptance scarcity)
        const supplyDemandRatio = carrierCount > 0 ? loadCount / carrierCount : loadCount > 0 ? 5 : 0;
        let heatScore = Math.round(
          Math.min(100, supplyDemandRatio * 30 + (1 - acceptanceRate) * 40)
        );
        heatScore = Math.max(0, Math.min(100, heatScore));

        // Trend from acceptance rate
        const trend = acceptanceRate > 0.7 ? 'falling' : acceptanceRate < 0.3 ? 'rising' : 'stable';

        // Average rate
        const avgRate = hist.rates.length > 0
          ? Math.round(hist.rates.reduce((s, r) => s + r, 0) / hist.rates.length)
          : 0;

        // Suggested min/max based on heat
        const cpm = BASE_CPM[bucket.equipmentType] || DEFAULT_CPM;
        const heatMultiplier = 1 + (heatScore - 50) / 200; // ±25% range
        const baseRate = avgRate || Math.round(cpm * 5); // fallback ~500 mile load
        const suggestedMin = Math.round(baseRate * heatMultiplier * 0.9);
        const suggestedMax = Math.round(baseRate * heatMultiplier * 1.15);

        await MarketInsight.findOneAndUpdate(
          { lane: bucket.lane, equipmentType: bucket.equipmentType },
          {
            openLoads: loadCount,
            availableCarriers: carrierCount,
            avgRateCentsPerMile: cpm,
            heatScore,
            trend,
            suggestedRateMinCents: suggestedMin,
            suggestedRateMaxCents: suggestedMax,
            calculatedAt: new Date(),
            validUntil,
          },
          { upsert: true, new: true },
        );

        actionCount++;
      } catch (err) {
        console.error(`[PricingAgent] Error on lane ${key}:`, err.message);
      }
    }

    return actionCount;
  }
}

module.exports = PricingAgent;
module.exports.getMarketInsight = getMarketInsight;
