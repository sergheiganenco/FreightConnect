const Load = require('../models/Load');
const StatusHistory = require('../models/StatusHistory');

/**
 * Valid status transitions for loads.
 *
 * Each key is a current status; its value is the list of statuses it can
 * transition to.  Any transition not listed here is illegal.
 */
const VALID_TRANSITIONS = {
  'open':       ['accepted', 'cancelled'],
  'accepted':   ['in-transit', 'cancelled'],
  'in-transit': ['delivered', 'disputed'],
  'delivered':  ['disputed'],
  'cancelled':  [],
  'disputed':   ['resolved'],
};

/**
 * Check whether a status transition is allowed.
 *
 * @param {string} currentStatus - The load's current status
 * @param {string} newStatus     - The desired next status
 * @returns {boolean} true if the transition is valid
 */
function canTransition(currentStatus, newStatus) {
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed) return false;
  return allowed.includes(newStatus);
}

/**
 * Atomically transition a load from one status to another.
 *
 * Uses `findOneAndUpdate` with a status precondition so the update only
 * succeeds if the load is still in `expectedStatus`.  This prevents race
 * conditions (e.g., two carriers accepting the same load).
 *
 * @param {string|ObjectId} loadId         - The load _id
 * @param {string}          expectedStatus - The status the load must currently be in
 * @param {string}          newStatus      - The status to transition to
 * @param {Object}          [updateFields] - Additional fields to $set alongside the status
 * @param {string|ObjectId} [userId]       - The user triggering the transition (for audit)
 * @param {string}          [reason]       - Optional reason for the transition
 * @returns {Promise<{success: boolean, load?: Document, error?: string}>}
 */
async function transitionLoadStatus(
  loadId,
  expectedStatus,
  newStatus,
  updateFields = {},
  userId = null,
  reason = null
) {
  // Validate the transition is legal before hitting the DB
  if (!canTransition(expectedStatus, newStatus)) {
    return {
      success: false,
      error: `Invalid transition: "${expectedStatus}" → "${newStatus}" is not allowed`,
    };
  }

  try {
    const load = await Load.findOneAndUpdate(
      { _id: loadId, status: expectedStatus },
      {
        $set: { status: newStatus, ...updateFields, updatedAt: new Date() },
        $inc: { __v: 1 },
      },
      { new: true }
    ).populate('postedBy acceptedBy');

    if (!load) {
      // Distinguish "not found" from "wrong status"
      const current = await Load.findById(loadId).select('status').lean();
      if (!current) {
        return { success: false, error: 'Load not found' };
      }
      return {
        success: false,
        error: `Cannot transition from "${current.status}" to "${newStatus}" (expected "${expectedStatus}")`,
      };
    }

    // Record the transition in the audit trail (non-blocking — do not fail the caller)
    try {
      await StatusHistory.record('load', loadId, expectedStatus, newStatus, userId, reason);
    } catch (historyErr) {
      console.error('[StatusHistory] Failed to record load transition (non-fatal):', historyErr.message);
    }

    return { success: true, load };
  } catch (err) {
    console.error('[loadStateMachine] transitionLoadStatus failed:', err.message);
    return { success: false, error: 'Database error during status transition' };
  }
}

module.exports = { VALID_TRANSITIONS, canTransition, transitionLoadStatus };
