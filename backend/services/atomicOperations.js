const Load = require('../models/Load');
const Bid = require('../models/Bid');
const Payment = require('../models/Payment');
const StatusHistory = require('../models/StatusHistory');

/**
 * Atomically accept a load — prevents two carriers from accepting the same load.
 *
 * Uses `findOneAndUpdate` with `{ status: 'open', acceptedBy: null }` as the
 * filter condition, so only one carrier can win the race.
 *
 * @param {string|ObjectId} loadId    - The load _id to accept
 * @param {string|ObjectId} carrierId - The carrier's user _id
 * @returns {Promise<{success: boolean, load?: Document, error?: string}>}
 */
async function atomicAcceptLoad(loadId, carrierId) {
  try {
    const load = await Load.findOneAndUpdate(
      { _id: loadId, status: 'open', acceptedBy: null },
      {
        $set: {
          status: 'accepted',
          acceptedBy: carrierId,
          updatedAt: new Date(),
        },
        $inc: { __v: 1 },
      },
      { new: true }
    ).populate('postedBy acceptedBy');

    if (!load) {
      const existing = await Load.findById(loadId).select('status acceptedBy').lean();
      if (!existing) {
        return { success: false, error: 'Load not found' };
      }
      if (existing.status !== 'open') {
        return { success: false, error: `Load is no longer open (current status: ${existing.status})` };
      }
      if (existing.acceptedBy) {
        return { success: false, error: 'Load is already accepted by another carrier' };
      }
      return { success: false, error: 'Load is not available for acceptance' };
    }

    // Record the status change in the audit trail
    try {
      await StatusHistory.record(
        'load',
        loadId,
        'open',
        'accepted',
        carrierId,
        'Carrier accepted load'
      );
    } catch (historyErr) {
      console.error('[StatusHistory] Failed to record accept (non-fatal):', historyErr.message);
    }

    return { success: true, load };
  } catch (err) {
    console.error('[atomicAcceptLoad] failed:', err.message);
    return { success: false, error: 'Database error during load acceptance' };
  }
}

/**
 * Atomically place a bid on a load — prevents duplicate bids from the same carrier.
 *
 * Relies on the unique compound index `{ loadId, carrierId }` on the Bid
 * collection.  If the carrier already has a bid on this load, the insert will
 * fail with a duplicate key error (E11000), which is caught and returned as a
 * user-friendly message.
 *
 * @param {string|ObjectId} loadId    - The load _id
 * @param {string|ObjectId} carrierId - The carrier's user _id
 * @param {Object}          bidData   - Bid fields: { amount, message }
 * @returns {Promise<{success: boolean, bid?: Document, error?: string}>}
 */
async function atomicPlaceBid(loadId, carrierId, bidData) {
  try {
    // Verify the load exists and is open
    const load = await Load.findById(loadId).select('status allowCarrierBidding').lean();
    if (!load) {
      return { success: false, error: 'Load not found' };
    }
    if (load.status !== 'open') {
      return { success: false, error: `Cannot bid on a load with status "${load.status}"` };
    }
    if (load.allowCarrierBidding === false) {
      return { success: false, error: 'Bidding is not allowed on this load' };
    }

    const bid = await Bid.create({
      loadId,
      carrierId,
      amount: bidData.amount,
      message: bidData.message || '',
      status: 'pending',
      history: [{
        actor: 'carrier',
        action: 'placed',
        amount: bidData.amount,
        note: bidData.message || '',
      }],
    });

    // Record bid creation in audit trail
    try {
      await StatusHistory.record(
        'bid',
        bid._id,
        'none',
        'pending',
        carrierId,
        'Bid placed'
      );
    } catch (historyErr) {
      console.error('[StatusHistory] Failed to record bid placement (non-fatal):', historyErr.message);
    }

    return { success: true, bid };
  } catch (err) {
    // Duplicate key error means carrier already has a bid on this load
    if (err.code === 11000) {
      return { success: false, error: 'You already have a bid on this load' };
    }
    console.error('[atomicPlaceBid] failed:', err.message);
    return { success: false, error: 'Database error during bid placement' };
  }
}

/**
 * Atomically update a payment's status using an optimistic concurrency check.
 *
 * Only succeeds if the payment is currently in `expectedStatus`, preventing
 * double-releases, double-refunds, etc.
 *
 * @param {string|ObjectId} paymentId      - The payment _id
 * @param {string}          expectedStatus - The status the payment must currently be in
 * @param {string}          newStatus      - The status to transition to
 * @param {Object}          [updateFields] - Additional fields to $set (e.g. releasedAt, stripeTransferId)
 * @param {string|ObjectId} [userId]       - The user triggering the change (for audit)
 * @param {string}          [reason]       - Optional reason
 * @returns {Promise<{success: boolean, payment?: Document, error?: string}>}
 */
async function atomicPaymentUpdate(paymentId, expectedStatus, newStatus, updateFields = {}, userId = null, reason = null) {
  try {
    const payment = await Payment.findOneAndUpdate(
      { _id: paymentId, status: expectedStatus },
      {
        $set: { status: newStatus, ...updateFields, updatedAt: new Date() },
        $inc: { __v: 1 },
      },
      { new: true }
    );

    if (!payment) {
      const current = await Payment.findById(paymentId).select('status').lean();
      if (!current) {
        return { success: false, error: 'Payment not found' };
      }
      return {
        success: false,
        error: `Cannot transition payment from "${current.status}" to "${newStatus}" (expected "${expectedStatus}")`,
      };
    }

    // Record in audit trail
    try {
      await StatusHistory.record('payment', paymentId, expectedStatus, newStatus, userId, reason);
    } catch (historyErr) {
      console.error('[StatusHistory] Failed to record payment transition (non-fatal):', historyErr.message);
    }

    return { success: true, payment };
  } catch (err) {
    console.error('[atomicPaymentUpdate] failed:', err.message);
    return { success: false, error: 'Database error during payment status update' };
  }
}

module.exports = { atomicAcceptLoad, atomicPlaceBid, atomicPaymentUpdate };
