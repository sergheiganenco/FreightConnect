/**
 * standbyService — standby carriers for a booked load.
 *
 * At booking, carriers with a live bid (pending/countered) on the load are its natural
 * standby list. The marker lives on the Bid (`standby.rank`); no new collection.
 * Ranking: lowest bid amount first, ties by carrier trust score (higher first), then
 * earliest bid. Capped at MAX_STANDBY. Standby carriers are only notified (never
 * auto-booked); they book through the normal gated accept flow.
 */
const Bid = require('../models/Bid');
const User = require('../models/User');
const { filterCarriersWhoCanSee } = require('./loadVisibility');
const { notifyUserSafe } = require('../utils/notifyUser');

const MAX_STANDBY = 5;

/** Live-bid carriers that are verified, active and allowed to see the load as an OPEN load, ranked. */
async function rankedCandidates(load, { excludeCarrierId = null, statuses, requireRank = false } = {}) {
  const l = load.toObject ? load.toObject() : load;
  const filter = { loadId: l._id, status: { $in: statuses } };
  if (excludeCarrierId) filter.carrierId = { $ne: excludeCarrierId };
  if (requireRank) { filter['standby.rank'] = { $ne: null }; filter['standby.optedOut'] = { $ne: true }; }
  const bids = await Bid.find(filter).lean();
  if (!bids.length) return [];
  const users = await User.find({ _id: { $in: bids.map((b) => b.carrierId) }, role: 'carrier', 'verification.status': 'verified' })
    .select('active parentAccountId trustScore.score').lean();
  // Visibility is judged as if the load were open (a booked load is "visible" to everyone).
  const visible = await filterCarriersWhoCanSee({ ...l, status: 'open' }, users);
  const score = new Map(visible.map((u) => [String(u._id), u.trustScore?.score ?? 50]));
  return bids.filter((b) => score.has(String(b.carrierId)))
    .sort((a, b) => a.amount - b.amount || score.get(String(b.carrierId)) - score.get(String(a.carrierId)) || new Date(a.createdAt) - new Date(b.createdAt))
    .slice(0, MAX_STANDBY);
}

/** Called right after a load is booked. Never throws. Returns the number of standby bids marked. */
async function buildStandby(load, winnerCarrierId) {
  try {
    await Bid.updateMany({ loadId: load._id, 'standby.rank': { $ne: null } }, { $unset: { standby: 1 } }); // stale from an earlier booking
    const ranked = await rankedCandidates(load, { excludeCarrierId: winnerCarrierId, statuses: ['pending', 'countered'] });
    await Promise.all(ranked.map((b, i) => Bid.updateOne({ _id: b._id }, { $set: { 'standby.rank': i + 1 } })));
    return ranked.length;
  } catch (err) {
    console.error('[standby] build failed (non-fatal):', err.message);
    return 0;
  }
}

/** Standby bids still eligible right now (re-checked: time has passed since booking). */
async function currentStandby(load) {
  try {
    return await rankedCandidates(load, { statuses: ['pending', 'countered', 'rejected'], requireRank: true });
  } catch (err) {
    console.error('[standby] lookup failed (non-fatal):', err.message);
    return [];
  }
}

/** Notify standby carriers (all at once, rank order) that the load is open again, then clear the markers. */
async function notifyStandby(load) {
  const list = await currentStandby(load);
  for (const b of list) {
    await notifyUserSafe(b.carrierId, {
      type: 'load:standby_available',
      title: 'Load available again',
      body: `"${load.title}" (${load.origin} to ${load.destination}) is open again. You were on standby - book it from the load board if you still want it. First to book gets it.`,
      link: `/dashboard/carrier/loads?loadId=${load._id}`,
      metadata: { loadId: String(load._id), standbyRank: b.standby.rank },
    });
  }
  try { await Bid.updateMany({ loadId: load._id }, { $unset: { standby: 1 } }); } catch (_) { /* markers are cosmetic after release */ }
  return list.length;
}

module.exports = { buildStandby, currentStandby, notifyStandby, MAX_STANDBY };
