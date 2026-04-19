/**
 * DemandForecastAgent — predicts future load demand per lane using historical
 * patterns (simple moving averages + day-of-week seasonal decomposition).
 *
 * Runs every hour. Analyzes the last 90 days of load data grouped by lane and
 * equipment type, then produces 7-day predictions stored in DemandForecast.
 *
 * No external ML library required — uses basic statistics:
 *   1. Daily load count per lane
 *   2. 7-day simple moving average (SMA)
 *   3. Day-of-week seasonal factor (Mon–Sun)
 *   4. Week-of-month adjustment
 *   5. Prediction = SMA * seasonalFactor * weekFactor
 */

const { Agent } = require('./AgentFramework');
const Load = require('../models/Load');
const DemandForecast = require('../models/DemandForecast');

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractState(address) {
  if (!address) return 'XX';
  const parts = address.split(',');
  const last = (parts[parts.length - 1] || '').trim();
  const match = last.match(/^([A-Za-z]{2})\b/);
  return match ? match[1].toUpperCase() : last.substring(0, 2).toUpperCase() || 'XX';
}

/** Return day-of-week index (0 = Sunday … 6 = Saturday) */
function dow(date) {
  return new Date(date).getDay();
}

/** Return ISO date string (YYYY-MM-DD) for grouping */
function dateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

class DemandForecastAgent extends Agent {
  constructor() {
    super('DemandForecastAgent', { intervalMs: 60 * 60_000 }); // every hour
  }

  /** @returns {Promise<number>} number of forecast records upserted */
  async execute() {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // 1. Fetch historical loads
    const loads = await Load.find({ createdAt: { $gte: ninetyDaysAgo } })
      .select('origin destination equipmentType createdAt')
      .lean();

    if (loads.length === 0) return 0;

    // 2. Group by lane + equipment + date
    /** @type {Map<string, Map<string, number>>} key → dateStr → count */
    const laneDaily = new Map();
    /** @type {Map<string, string>} key → equipmentType */
    const laneEquip = new Map();

    for (const load of loads) {
      const oS = extractState(load.origin);
      const dS = extractState(load.destination);
      const equip = load.equipmentType || 'Dry Van';
      const key = `${oS}-${dS}::${equip}`;
      const dk = dateKey(load.createdAt);

      if (!laneDaily.has(key)) {
        laneDaily.set(key, new Map());
        laneEquip.set(key, equip);
      }
      const dailyMap = laneDaily.get(key);
      dailyMap.set(dk, (dailyMap.get(dk) || 0) + 1);
    }

    // 3. For each lane, compute SMA + seasonal factors + predictions
    let actionCount = 0;
    const validUntil = new Date(Date.now() + 2 * 60 * 60_000); // valid 2 hours

    for (const [key, dailyMap] of laneDaily) {
      try {
        const lane = key.split('::')[0];
        const equip = laneEquip.get(key);

        // Build daily time series (fill missing days with 0)
        const allDates = [];
        const start = new Date(ninetyDaysAgo);
        for (let d = new Date(start); d <= new Date(); d.setDate(d.getDate() + 1)) {
          allDates.push(dateKey(d));
        }

        const series = allDates.map((dk) => ({
          date: dk,
          count: dailyMap.get(dk) || 0,
          dow: dow(dk),
        }));

        if (series.length < 7) continue;

        // Overall daily average
        const totalLoads = series.reduce((s, d) => s + d.count, 0);
        const historicalAvg = totalLoads / series.length;

        // Day-of-week seasonal factor
        const dowCounts = Array(7).fill(0);
        const dowDays = Array(7).fill(0);
        for (const s of series) {
          dowCounts[s.dow] += s.count;
          dowDays[s.dow]++;
        }
        const dowAvgs = dowCounts.map((c, i) => (dowDays[i] > 0 ? c / dowDays[i] : historicalAvg));
        const overallAvg = historicalAvg || 1;
        const seasonalFactors = dowAvgs.map((a) => a / overallAvg || 1);

        // 7-day SMA from the last 7 days
        const last7 = series.slice(-7);
        const sma7 = last7.reduce((s, d) => s + d.count, 0) / 7;

        // Week-of-month factor (week 1 vs rest)
        const today = new Date();
        const weekOfMonth = Math.ceil(today.getDate() / 7);
        const weekFactor = weekOfMonth <= 1 ? 1.1 : weekOfMonth >= 4 ? 0.9 : 1.0;

        // Composite seasonal factor (average of next 7 days' DOW factors)
        const predictions = [];
        let seasonalSum = 0;
        for (let i = 1; i <= 7; i++) {
          const futureDate = new Date(Date.now() + i * 24 * 60 * 60 * 1000);
          const futureDow = futureDate.getDay();
          const sf = seasonalFactors[futureDow] || 1;
          seasonalSum += sf;

          const predicted = Math.max(0, Math.round(sma7 * sf * weekFactor));
          // Confidence decreases with distance
          const confidence = Math.max(0.2, Math.min(0.95, 1 - (i * 0.1) + (series.length / 180)));

          predictions.push({
            date: futureDate,
            predictedLoads: predicted,
            confidence: Math.round(confidence * 100) / 100,
          });
        }

        const avgSeasonalFactor = seasonalSum / 7;

        await DemandForecast.findOneAndUpdate(
          { lane, equipmentType: equip },
          {
            predictions,
            historicalAvg: Math.round(historicalAvg * 100) / 100,
            seasonalFactor: Math.round(avgSeasonalFactor * 100) / 100,
            calculatedAt: new Date(),
            validUntil,
          },
          { upsert: true, new: true },
        );

        actionCount++;
      } catch (err) {
        console.error(`[DemandForecastAgent] Error on lane ${key}:`, err.message);
      }
    }

    return actionCount;
  }
}

module.exports = DemandForecastAgent;
