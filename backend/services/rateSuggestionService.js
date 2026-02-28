/**
 * Rate Suggestion Service
 * Analyses historical load data to suggest a fair market rate for a lane.
 *
 * Fallback when history is sparse: uses industry CPM (cost-per-mile) averages
 * per equipment type + OpenRouteService distance if coordinates are available.
 */

const Load = require('../models/Load');

// Baseline CPM (cents per mile) by equipment type — adjust periodically
const BASE_CPM = {
  'Dry Van':    285,
  'Reefer':     340,
  'Flatbed':    310,
  'Step Deck':  300,
  'Lowboy':     360,
  'Tanker':     320,
  'Box Truck':  250,
  'Power Only': 220,
  'Conestoga':  315,
  'RGN':        380,
};
const DEFAULT_CPM = 290;

// ── Haversine straight-line distance in miles ────────────────────────────────
function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Suggest a market rate for a given load.
 * @param {Object} load — full Load document (or plain object with same fields)
 * @returns {Object} { suggested, min, max, confidence, basis }
 */
async function suggestRate(load) {
  const originLC = (load.origin || '').toLowerCase();
  const destLC   = (load.destination || '').toLowerCase();

  // ── Pull accepted/delivered loads on the same lane ────────────────────────
  const historical = await Load.find({
    status: { $in: ['accepted', 'delivered'] },
    equipmentType: load.equipmentType,
    $expr: {
      $and: [
        { $gt: [{ $strLenCP: '$origin' }, 0] },
        { $gt: [{ $strLenCP: '$destination' }, 0] },
      ],
    },
  })
    .select('rate origin destination originLat originLng destinationLat destinationLng')
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  // Filter to nearby lanes (loose string match OR same state)
  const originState = originLC.split(',').pop()?.trim();
  const destState   = destLC.split(',').pop()?.trim();

  const laneSamples = historical.filter((h) => {
    const ho = (h.origin || '').toLowerCase();
    const hd = (h.destination || '').toLowerCase();
    return (
      (ho.includes(originState) || originState?.length > 2 && ho.includes(originLC.split(',')[0]?.trim())) &&
      (hd.includes(destState)   || destState?.length > 2   && hd.includes(destLC.split(',')[0]?.trim()))
    );
  });

  if (laneSamples.length >= 3) {
    const rates = laneSamples.map((h) => h.rate).sort((a, b) => a - b);
    const avg   = rates.reduce((s, r) => s + r, 0) / rates.length;
    const min   = rates[0];
    const max   = rates[rates.length - 1];
    const p25   = rates[Math.floor(rates.length * 0.25)];
    const p75   = rates[Math.floor(rates.length * 0.75)];
    return {
      suggested:  Math.round(avg),
      min:        Math.round(p25),
      max:        Math.round(p75),
      confidence: laneSamples.length >= 10 ? 'high' : 'medium',
      basis:      `${laneSamples.length} comparable loads on this lane`,
    };
  }

  // ── Fallback: CPM × estimated distance ───────────────────────────────────
  let miles = null;

  if (load.originLat && load.originLng && load.destinationLat && load.destinationLng) {
    // 1.3 factor converts straight-line to approximate road miles
    miles = Math.round(
      haversineMiles(load.originLat, load.originLng, load.destinationLat, load.destinationLng) * 1.3
    );
  }

  if (miles && miles > 0) {
    const cpm = BASE_CPM[load.equipmentType] || DEFAULT_CPM;
    const suggested = Math.round((miles * cpm) / 100);
    return {
      suggested,
      min: Math.round(suggested * 0.85),
      max: Math.round(suggested * 1.2),
      confidence: 'low',
      basis: `~${miles} mi estimated · $${(cpm / 100).toFixed(2)}/mi for ${load.equipmentType || 'this equipment'}`,
    };
  }

  // ── Last resort: equipment average from all history ───────────────────────
  const equipSamples = historical.slice(0, 50);
  if (equipSamples.length >= 2) {
    const avg = equipSamples.reduce((s, h) => s + h.rate, 0) / equipSamples.length;
    return {
      suggested:  Math.round(avg),
      min:        Math.round(avg * 0.8),
      max:        Math.round(avg * 1.25),
      confidence: 'low',
      basis:      `${equipSamples.length} recent ${load.equipmentType || ''} loads (no lane data)`,
    };
  }

  return { suggested: null, min: null, max: null, confidence: 'none', basis: 'Insufficient data' };
}

module.exports = { suggestRate };
