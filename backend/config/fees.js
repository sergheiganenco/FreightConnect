/**
 * Platform fee — single source of truth.
 *
 * Used by the payment pipeline (escrow/payout math in paymentRoutes) AND the
 * tax layer (annual summaries, CSV export). These previously disagreed
 * (payments charged 2% while tax summaries assumed 5%), so the tax page's
 * "net" contradicted actually-settled money. Change it here, not inline.
 */
const PLATFORM_FEE_PCT = 0.02; // 2% platform fee

module.exports = { PLATFORM_FEE_PCT };
