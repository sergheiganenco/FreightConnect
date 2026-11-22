/**
 * Road distance via OpenRouteService. Never throws; returns null on any problem.
 * Profile: driving-hgv (truck routing; GET /loads/:id/route uses this same helper, so card and map agree).
 * ORS returns metres -> statute miles at 1609.344 m/mi.
 */
const axios = require('axios');
const { haversineMiles } = require('../utils/geo');

const ORS_TIMEOUT_MS = 4000;
const M_PER_MILE = 1609.344;
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

/** Raw ORS route: { coordinates, meters, seconds } or null (no key / error / timeout). */
async function fetchOrsRoute(oLat, oLng, dLat, dLng) {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) return null;
  try {
    const url = `https://api.openrouteservice.org/v2/directions/driving-hgv?api_key=${apiKey}&start=${oLng},${oLat}&end=${dLng},${dLat}`;
    const { data } = await axios.get(url, { timeout: ORS_TIMEOUT_MS });
    const f = data && data.features && data.features[0];
    const seg = f && f.properties && f.properties.segments && f.properties.segments[0];
    if (!f || !seg || !isNum(seg.distance)) return null;
    return { coordinates: (f.geometry && f.geometry.coordinates) || [], meters: seg.distance, seconds: seg.duration || 0 };
  } catch (err) {
    console.warn('[routing] ORS failed (non-fatal):', err.message);
    return null;
  }
}

/** Road miles (1 decimal) for a raw ORS result, or null if impossible (<= 0 or shorter than straight-line). */
function plausibleMiles(meters, oLat, oLng, dLat, dLng) {
  if (!isNum(meters)) return null;
  const miles = meters / M_PER_MILE;
  if (!(miles > 0)) return null;
  // Road cannot beat the great-circle line (small tolerance for rounding/snapping).
  if (miles < haversineMiles(oLat, oLng, dLat, dLng) - 0.5) return null;
  return Math.round(miles * 10) / 10;
}

async function roadMiles(oLat, oLng, dLat, dLng) {
  if (![oLat, oLng, dLat, dLng].every(isNum)) return null;
  const r = await fetchOrsRoute(oLat, oLng, dLat, dLng);
  return r ? plausibleMiles(r.meters, oLat, oLng, dLat, dLng) : null;
}

/** Fields to $set on a Load for its current endpoints; null/null for multi-stop or failure. */
async function loadDistanceFields(load) {
  const hasStops = Array.isArray(load.stops) && load.stops.length > 0; // route would ignore stops
  const miles = hasStops ? null : await roadMiles(load.originLat, load.originLng, load.destinationLat, load.destinationLng);
  return { distanceMiles: miles, distanceSource: miles == null ? null : 'ors' };
}

module.exports = { fetchOrsRoute, plausibleMiles, roadMiles, loadDistanceFields };
