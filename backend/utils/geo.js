/**
 * geo.js — small geospatial helpers for lane / deadhead search.
 *
 * The Load model stores plain originLat/originLng/destinationLat/destinationLng
 * numbers (not GeoJSON), so we use a cheap lat/lng bounding box to pre-filter in
 * Mongo and then refine with an exact great-circle (haversine) distance.
 * All distances are in statute miles.
 */

const EARTH_RADIUS_MI = 3958.7613;
const MILES_PER_DEG_LAT = 69.0; // ~constant

const toRad = (d) => (d * Math.PI) / 180;

/** Great-circle distance between two lat/lng points, in miles. */
function haversineMiles(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * A lat/lng bounding box that fully contains a circle of `radiusMiles` around a
 * point. Longitude degrees shrink toward the poles, so scale by cos(latitude).
 * Returns { latMin, latMax, lngMin, lngMax }.
 */
function boundingBox(lat, lng, radiusMiles) {
  const latDelta = radiusMiles / MILES_PER_DEG_LAT;
  // Guard against cos→0 near the poles (never realistic for US freight, but safe).
  const cosLat = Math.max(0.01, Math.abs(Math.cos(toRad(lat))));
  const lngDelta = radiusMiles / (MILES_PER_DEG_LAT * cosLat);
  return {
    latMin: lat - latDelta,
    latMax: lat + latDelta,
    lngMin: lng - lngDelta,
    lngMax: lng + lngDelta,
  };
}

/** Round to n decimal places, returning a Number (avoids trailing-float noise). */
function round(n, places = 2) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

module.exports = { haversineMiles, boundingBox, round, toRad };
