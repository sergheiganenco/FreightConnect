/**
 * Miles driven in each state, estimated from the GPS trail of a company's loads.
 *
 * An ESTIMATE for the carrier to review, not an odometer reading:
 *   - it only covers time a load was being tracked (no empty miles between loads);
 *   - distance is measured straight between consecutive location fixes;
 *   - state lines come from a simplified Census boundary file (data/usStates.json), good to a few miles.
 * ponytail: half of a hop that crosses a state line goes to each state; cut the hop at the line if the estimate ever needs to be tighter.
 */
const STATES = require('../data/usStates.json'); // { TX: [ring, ...] } rings of [lng, lat]
const { haversineMiles } = require('../utils/geo');

const BOXES = Object.entries(STATES).map(([code, rings]) => {
  let a = 180; let b = 90; let c = -180; let d = -90;
  for (const ring of rings) for (const [x, y] of ring) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; }
  return { code, rings, minX: a, minY: b, maxX: c, maxY: d };
});

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Two-letter state for a point, or null (outside the US, or in a sliver the simplified map misses). */
function stateAt(lat, lng) {
  for (const s of BOXES) {
    if (lng < s.minX || lng > s.maxX || lat < s.minY || lat > s.maxY) continue;
    if (s.rings.some((r) => inRing(lng, lat, r))) return s.code;
  }
  return null;
}

const MAX_GAP_MS = 2 * 3600000; // a longer silence is not one continuous drive
const MAX_HOP_MILES = 150;      // nor is a jump this long between two fixes

/**
 * @param {Array<{latitude, longitude, recordedAt}>} points one load's fixes, oldest first
 * @param {Object} into miles per state, added to in place
 * @returns {number} miles that could not be placed in any state
 */
function addTrail(points, into) {
  let unplaced = 0;
  let prev = null;
  for (const p of points) {
    const cur = { ...p, state: stateAt(p.latitude, p.longitude), t: +new Date(p.recordedAt) };
    if (prev && cur.t - prev.t <= MAX_GAP_MS) {
      const miles = haversineMiles(prev.latitude, prev.longitude, cur.latitude, cur.longitude);
      if (miles > 0 && miles <= MAX_HOP_MILES) {
        const a = prev.state || cur.state; const b = cur.state || prev.state;
        if (!a) unplaced += miles;
        else { into[a] = (into[a] || 0) + miles / 2; into[b] = (into[b] || 0) + miles / 2; }
      }
    }
    prev = cur;
  }
  return unplaced;
}

/** Miles per state for a company's tracked loads between two dates. */
async function milesByState(companyId, start, end) {
  const Load = require('../models/Load');
  const TrackingEvent = require('../models/TrackingEvent');
  const loadIds = await Load.find({ acceptedBy: companyId }).distinct('_id');
  const into = {}; let unplaced = 0; let fixes = 0; const loads = new Set();
  let trail = []; let current = null;
  // `carrier` is the company that held the booking when the fix was recorded: a load released by another
  // carrier and rebooked by this one must not hand over the first carrier's trail.
  const cursor = TrackingEvent.find({ load: { $in: loadIds }, carrier: companyId, recordedAt: { $gte: start, $lt: end } })
    .select('load latitude longitude recordedAt').sort({ load: 1, recordedAt: 1 }).lean().cursor();
  for await (const e of cursor) {
    if (String(e.load) !== current) { unplaced += addTrail(trail, into); trail = []; current = String(e.load); loads.add(current); }
    trail.push(e); fixes++;
  }
  unplaced += addTrail(trail, into);
  const byState = Object.entries(into).map(([jurisdiction, miles]) => ({ jurisdiction, miles: Math.round(miles) }))
    .filter((r) => r.miles > 0).sort((x, y) => y.miles - x.miles);
  return { byState, totalMiles: byState.reduce((n, r) => n + r.miles, 0), unplacedMiles: Math.round(unplaced), fixes, loads: loads.size };
}

module.exports = { stateAt, addTrail, milesByState };
