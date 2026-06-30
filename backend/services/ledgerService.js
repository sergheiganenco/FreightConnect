/**
 * Ledger Service — double-entry bookkeeping + webhook idempotency + reconciliation.
 *
 * Every money movement is recorded as a balanced pair (one debit, one credit) so
 * total debits always equal total credits. All amounts are integer cents.
 */

const LedgerEntry = require('../models/LedgerEntry');

/** Record a balanced pair of entries (debit one account, credit another). All cents. */
async function record({ transactionId, loadId, paymentId, entryType, amountCents, debitAccount, creditAccount, description, stripeRef, currency = 'usd' }) {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error('amountCents must be a non-negative integer');
  }
  const common = {
    transactionId,
    loadId: loadId || null,
    paymentId: paymentId || null,
    entryType,
    amountCents,
    currency,
    description: description || null,
    stripeRef: stripeRef || null,
  };
  await LedgerEntry.create([
    { ...common, account: debitAccount, direction: 'debit' },
    { ...common, account: creditAccount, direction: 'credit' },
  ]);
}

/** Idempotency: returns true if this event was already processed (and marks it if not). */
async function markProcessedOnce(eventId, type) {
  const ProcessedEvent = require('../models/ProcessedEvent');
  try {
    await ProcessedEvent.create({ eventId, type });
    return false; // first time
  } catch (err) {
    if (err.code === 11000) return true; // duplicate = already processed
    throw err;
  }
}

/** Reconciliation: sum debits and credits per account; they should net per accounting rules. */
async function reconcile() {
  const rows = await LedgerEntry.aggregate([
    { $group: { _id: { account: '$account', direction: '$direction' }, total: { $sum: '$amountCents' } } },
  ]);
  const totalDebits = rows.filter(r => r._id.direction === 'debit').reduce((s, r) => s + r.total, 0);
  const totalCredits = rows.filter(r => r._id.direction === 'credit').reduce((s, r) => s + r.total, 0);
  return { rows, totalDebits, totalCredits, balanced: totalDebits === totalCredits };
}

module.exports = { record, markProcessedOnce, reconcile };
