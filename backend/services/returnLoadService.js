/**
 * Return Load Service — Core matching logic for reducing deadhead miles.
 *
 * Given a carrier's current/upcoming destination, finds open loads nearby
 * and scores them by proximity, rate, equipment match, timing, and lane familiarity.
 */

const Load = require('../models/Load');
const User = require('../models/User');

// ── Configuration ────────────────────────────────────────────────────────────
const DEFAULT_RADIUS_MILES = 50;
const MAX_RESULTS = 10;
const EARTH_RADIUS_MILES = 3958.8;
const DELIVERY_BUFFER_HOURS = 2; // minimum hours between delivery and next pickup

// ── Haversine distance (miles) ───────────────────────────────────────────────
function haversineDistance(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Estimate load distance (origin → destination) ────────────────────────────
function estimateLoadMiles(load) {
  if (load.originLat && load.originLng && load.destinationLat && load.destinationLng) {
    return haversineDistance(load.originLat, load.originLng, load.destinationLat, load.destinationLng);
  }
  return null;
}

// ── Rate per mile ────────────────────────────────────────────────────────────
function ratePerMile(load) {
  const miles = estimateLoadMiles(load);
  if (!miles || miles < 1) return 0;
  return load.rate / miles;
}

// ── Scoring weights ──────────────────────────────────────────────────────────
const WEIGHTS = {
  proximity: 35,     // closer origin = better
  ratePerMile: 25,   // higher $/mile = better
  equipmentMatch: 20, // exact equipment match bonus
  timing: 10,        // pickup window compatibility
  laneHistory: 10,   // carrier has run this lane before
};

/**
 * Score a candidate load against carrier context.
 *
 * @param {Object} candidate   – Open load document
 * @param {Object} context     – { lat, lng, equipmentTypes, deliveryEndTime, laneSet }
 * @param {number} distance    – Miles from carrier destination to candidate origin
 * @param {number} radiusMiles – Search radius
 * @returns {{ score: number, breakdown: Object }}
 */
function scoreCandidate(candidate, context, distance, radiusMiles) {
  const breakdown = {};

  // 1. Proximity (closer = higher score, linear falloff)
  breakdown.proximity = Math.max(0, 1 - distance / radiusMiles) * WEIGHTS.proximity;

  // 2. Rate per mile (normalize: $3+/mi = perfect, $0 = zero)
  const rpm = ratePerMile(candidate);
  breakdown.ratePerMile = Math.min(1, rpm / 3) * WEIGHTS.ratePerMile;

  // 3. Equipment match
  if (context.equipmentTypes && context.equipmentTypes.length > 0) {
    breakdown.equipmentMatch = context.equipmentTypes.includes(candidate.equipmentType)
      ? WEIGHTS.equipmentMatch
      : 0;
  } else {
    // No preference set — give half credit
    breakdown.equipmentMatch = WEIGHTS.equipmentMatch * 0.5;
  }

  // 4. Timing — pickup should be after delivery + buffer
  breakdown.timing = 0;
  if (context.deliveryEndTime && candidate.pickupTimeWindow?.start) {
    const deliveryEnd = new Date(context.deliveryEndTime).getTime();
    const pickupStart = new Date(candidate.pickupTimeWindow.start).getTime();
    const bufferMs = DELIVERY_BUFFER_HOURS * 3600000;
    if (pickupStart >= deliveryEnd + bufferMs) {
      // Good timing — closer to buffer = better (within 24h)
      const gap = pickupStart - deliveryEnd;
      const maxGap = 24 * 3600000; // 24 hours
      breakdown.timing = Math.max(0, 1 - gap / maxGap) * WEIGHTS.timing;
    }
    // If pickup is before delivery ends, score is 0 (can't make it)
  } else {
    // No timing info — give partial credit
    breakdown.timing = WEIGHTS.timing * 0.5;
  }

  // 5. Lane history — has carrier run origin→destination of this load before?
  breakdown.laneHistory = 0;
  if (context.laneSet && candidate.origin && candidate.destination) {
    const laneKey = `${candidate.origin.toLowerCase().trim()}|${candidate.destination.toLowerCase().trim()}`;
    if (context.laneSet.has(laneKey)) {
      breakdown.laneHistory = WEIGHTS.laneHistory;
    }
  }

  const score = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  return { score, breakdown };
}

/**
 * Build a Set of lane keys from the carrier's past accepted/delivered loads.
 */
async function buildLaneHistory(carrierId) {
  const pastLoads = await Load.find(
    { acceptedBy: carrierId, status: { $in: ['delivered', 'in-transit', 'accepted'] } },
    { origin: 1, destination: 1 }
  ).limit(200).lean();

  const laneSet = new Set();
  for (const l of pastLoads) {
    if (l.origin && l.destination) {
      laneSet.add(`${l.origin.toLowerCase().trim()}|${l.destination.toLowerCase().trim()}`);
    }
  }
  return laneSet;
}

/**
 * Find return load suggestions from a specific location.
 *
 * @param {Object} params
 * @param {number} params.lat – Latitude of carrier's current/destination location
 * @param {number} params.lng – Longitude
 * @param {string} params.carrierId – Carrier user ID
 * @param {string[]} [params.equipmentTypes] – Equipment type filter
 * @param {Date}   [params.deliveryEndTime] – When current delivery is expected to finish
 * @param {number} [params.radiusMiles] – Search radius (default 50)
 * @param {string} [params.excludeLoadId] – Load to exclude from results (the current load)
 * @returns {Promise<Array>} Scored and sorted suggestions
 */
async function findReturnLoads({
  lat,
  lng,
  carrierId,
  equipmentTypes,
  deliveryEndTime,
  radiusMiles = DEFAULT_RADIUS_MILES,
  excludeLoadId,
}) {
  if (lat == null || lng == null) {
    throw new Error('Latitude and longitude are required');
  }

  // Rough bounding box filter (1 degree latitude ~ 69 miles)
  const latDelta = radiusMiles / 69;
  const lngDelta = radiusMiles / (69 * Math.cos((lat * Math.PI) / 180));

  const filter = {
    status: 'open',
    originLat: { $gte: lat - latDelta, $lte: lat + latDelta },
    originLng: { $gte: lng - lngDelta, $lte: lng + lngDelta },
  };

  if (excludeLoadId) {
    filter._id = { $ne: excludeLoadId };
  }

  // Fetch candidate loads
  const candidates = await Load.find(filter)
    .select('title origin originLat originLng destination destinationLat destinationLng rate equipmentType pickupTimeWindow deliveryTimeWindow postedBy status loadWeight commodityType')
    .populate('postedBy', 'name companyName')
    .limit(100)
    .lean();

  // Build carrier context
  const [user, laneSet] = await Promise.all([
    User.findById(carrierId).select('preferences').lean(),
    buildLaneHistory(carrierId),
  ]);

  const carrierEquipment = equipmentTypes && equipmentTypes.length > 0
    ? equipmentTypes
    : (user?.preferences?.equipmentTypes || []);

  const context = {
    lat,
    lng,
    equipmentTypes: carrierEquipment,
    deliveryEndTime,
    laneSet,
  };

  // Score each candidate
  const scored = [];
  for (const candidate of candidates) {
    if (!candidate.originLat || !candidate.originLng) continue;

    const distance = haversineDistance(lat, lng, candidate.originLat, candidate.originLng);
    if (distance > radiusMiles) continue; // precise Haversine check after bounding-box filter

    const { score, breakdown } = scoreCandidate(candidate, context, distance, radiusMiles);

    const loadMiles = estimateLoadMiles(candidate);
    const rpm = loadMiles && loadMiles > 0 ? Math.round((candidate.rate / loadMiles) * 100) / 100 : null;

    scored.push({
      load: {
        _id: candidate._id,
        title: candidate.title,
        origin: candidate.origin,
        destination: candidate.destination,
        originLat: candidate.originLat,
        originLng: candidate.originLng,
        destinationLat: candidate.destinationLat,
        destinationLng: candidate.destinationLng,
        rate: candidate.rate,
        equipmentType: candidate.equipmentType,
        pickupTimeWindow: candidate.pickupTimeWindow,
        deliveryTimeWindow: candidate.deliveryTimeWindow,
        loadWeight: candidate.loadWeight,
        commodityType: candidate.commodityType,
        postedBy: candidate.postedBy,
      },
      distanceFromLocation: Math.round(distance * 10) / 10, // miles, 1 decimal
      loadMiles: loadMiles ? Math.round(loadMiles) : null,
      ratePerMile: rpm,
      matchScore: Math.round(score),      // 0-100
      matchBreakdown: breakdown,
      equipmentMatch: carrierEquipment.includes(candidate.equipmentType),
      familiarLane: laneSet.has(
        `${(candidate.origin || '').toLowerCase().trim()}|${(candidate.destination || '').toLowerCase().trim()}`
      ),
    });
  }

  // Sort by score descending, return top N
  scored.sort((a, b) => b.matchScore - a.matchScore);
  return scored.slice(0, MAX_RESULTS);
}

/**
 * Find return loads for a specific load the carrier has accepted/is delivering.
 */
async function findReturnLoadsForLoad(loadId, carrierId) {
  const load = await Load.findById(loadId).lean();
  if (!load) throw new Error('Load not found');

  if (!load.destinationLat || !load.destinationLng) {
    throw new Error('Load destination coordinates are missing');
  }

  return findReturnLoads({
    lat: load.destinationLat,
    lng: load.destinationLng,
    carrierId,
    deliveryEndTime: load.deliveryTimeWindow?.end || null,
    excludeLoadId: loadId,
  });
}

module.exports = {
  findReturnLoads,
  findReturnLoadsForLoad,
  haversineDistance,
};
