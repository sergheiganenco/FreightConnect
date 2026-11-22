/**
 * Estimated load economics for a carrier. Pure, integer-cents, no DB.
 * cost = costPerMileCents x (tripMiles + deadheadMiles when known), rounded ONCE.
 * Returns null when it cannot be computed (never a guessed number).
 * Excludes tolls, detention and accessorials -- callers must label it an estimate.
 */
function estimateEconomics({ rateCents, tripMiles, deadheadMiles, costPerMileCents }) {
  const pos = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
  if (!Number.isInteger(costPerMileCents) || costPerMileCents <= 0) return null;
  if (!Number.isInteger(rateCents) || rateCents <= 0) return null;
  if (!pos(tripMiles)) return null;

  const includesDeadhead = typeof deadheadMiles === 'number' && Number.isFinite(deadheadMiles) && deadheadMiles >= 0;
  const totalMiles = tripMiles + (includesDeadhead ? deadheadMiles : 0);
  const costCents = Math.round(costPerMileCents * totalMiles);
  const profitCents = rateCents - costCents;
  // Per mile is over the same miles the cost used.
  const profitPerMileCents = Math.round(profitCents / totalMiles);
  return { costCents, profitCents, profitPerMileCents, totalMiles, includesDeadhead };
}

module.exports = { estimateEconomics };
