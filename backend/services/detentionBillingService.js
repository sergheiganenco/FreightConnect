/**
 * detentionBillingService.js — Detention auto-collect (Path A: accrual MVP)
 *
 * Bridges the finished detention engine (DwellEvent) to the Load.accessorialCharges
 * workflow WITHOUT trusting any carrier-supplied number.
 *
 * Security / correctness contract:
 *   - Amount is server-authoritative: recomputed here from authoritative
 *     contract/server rates (rate provenance lock, gap #3). A carrier has no
 *     writable path to the rate (Contract.pricing is SHIPPER_ONLY).
 *   - Idempotent on dwellEventId — exactly one detention charge per dwell event.
 *   - Evidence + amount are frozen into the charge at proposal time and hashed.
 *     A material change resets the proposal (new hash) and re-notifies, so the
 *     shipper can never approve a number different from what they were shown (#2).
 *   - State machine (gap #4): pending → approved → paid (terminal),
 *     pending → rejected (terminal). A rejected charge is re-proposed ONLY if the
 *     evidence materially changes (different evidenceHash). A paid charge is never
 *     touched.
 *
 * Settlement is the existing settleAccessorialCharge() path (post-delivery,
 * §9-406 factoring redirect), invoked from the approve route — NOT here.
 */

const crypto = require('crypto');
const Load = require('../models/Load');
const { notifyUserSafe, notifyAdmins } = require('../utils/notifyUser');

// An approved or paid charge is never auto-rewound by a later recalculation —
// reversing a settled/approved payment is a financial operation that must be
// handled manually, not silently mutated.
const TERMINAL_STATUSES = ['approved', 'paid'];

/** Surface a post-approval discrepancy for manual admin review (never silent). */
async function flagDiscrepancy(load, charge, reason) {
  console.error('[detentionBilling] DISCREPANCY load', String(load._id), 'charge', String(charge._id), '—', reason);
  try {
    if (typeof notifyAdmins === 'function') {
      await notifyAdmins({
        type: 'detention_discrepancy',
        title: 'Detention charge needs manual review',
        body: `Load ${load._id}: ${reason} (charge ${charge._id}, status ${charge.status}, $${(charge.amountCents / 100).toFixed(2)}).`,
        link: '/dashboard/admin',
        metadata: { loadId: String(load._id), chargeId: String(charge._id), reason },
      });
    }
  } catch (e) {
    console.error('[detentionBilling] notifyAdmins failed:', e.message);
  }
}

/** Deterministic hash of the amount + evidence the shipper is shown. */
function computeEvidenceHash(dwellEventId, amountCents, evidence, locationVerified) {
  const iso = (d) => (d ? new Date(d).toISOString() : null);
  const canonical = JSON.stringify({
    dwellEventId:       String(dwellEventId),
    amountCents,
    arrivedAt:          iso(evidence.arrivedAt),
    dockInAt:           iso(evidence.dockInAt),
    dockOutAt:          iso(evidence.dockOutAt),
    departedAt:         iso(evidence.departedAt),
    dwellMinutes:       evidence.dwellMinutes,
    freeMinutes:        evidence.freeMinutes,
    detentionMinutes:   evidence.detentionMinutes,
    detentionRateCents: evidence.detentionRateCents,
    // provenance is part of what the shipper approves: a flip must change the hash (re-propose / flag), never go stale
    locationVerified:   locationVerified === true,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

async function notifyProposal(load, charge, { reproposed }) {
  const dollars = (charge.amountCents / 100).toFixed(2);
  await notifyUserSafe(load.postedBy, {
    type: 'detention_proposed',
    title: reproposed ? 'Detention Charge Updated' : 'Detention Charge Proposed',
    body: `Detention charge of $${dollars} ${reproposed ? 're-proposed' : 'proposed'} on "${load.title}" — review the dwell evidence and approve or reject.`
      + (charge.locationVerified === true ? '' : ' The arrival or departure position was not verified (link-token fix or manual check-in): check it carefully. Even if you approve it, it is held for manual review by our team and is not collected or paid out automatically.'),
    link: '/dashboard/shipper/loads',
    metadata: { loadId: String(load._id), chargeId: String(charge._id), amountCents: charge.amountCents, evidenceHash: charge.evidenceHash },
  });
  if (load.acceptedBy) {
    await notifyUserSafe(load.acceptedBy, {
      type: 'detention_auto_billed',
      title: 'Detention Auto-Billed',
      body: `Detention of $${dollars} on "${load.title}" was documented from your dwell time and sent to the shipper for approval.`
        + (charge.locationVerified === true ? '' : ' Your arrival or departure location was not verified, so this charge is awaiting manual review before it can be collected or paid.'),
      link: '/dashboard/carrier/my-loads',
      metadata: { loadId: String(load._id), chargeId: String(charge._id), amountCents: charge.amountCents },
    });
  }
}

function buildDescription(evidence, stopType, detentionMinutes, locationVerified) {
  return `Detention at ${evidence.facilityName || stopType} — ${detentionMinutes} min over free time`
    + (locationVerified ? '' : ' [needs review: location not verified]');
}

const sameInstant = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

/** A dwell event bills only under the load's CURRENT booking (same carrier, same bookedAt; both null = legacy). */
function eventBelongsToCurrentBooking(event, load) {
  return !!event && !!load.acceptedBy && String(event.carrier) === String(load.acceptedBy)
    && sameInstant(event.bookedAt, load.bookedAt);
}

/** False for a cancelled event or one from an earlier booking. */
function eventBillable(event, load) {
  return !!event && event.closedReason !== 'cancelled' && eventBelongsToCurrentBooking(event, load);
}

/**
 * Money may move automatically for a charge only if it is not a system detention charge, or its dwell position
 * was authenticated (=== true; false/null/undefined all fail closed), or an admin confirmed it by hand.
 */
function isAutoPayable(charge) {
  return !charge || charge.source !== 'system_detention' || charge.locationVerified === true || !!charge.adminConfirmedAt;
}

/** For approve/settle: is this system charge's dwell event still billable under the load's current booking? */
async function chargeEventBillable(load, charge) {
  if (!charge || charge.source !== 'system_detention') return true;
  const event = charge.dwellEventId ? await require('../models/DwellEvent').findById(charge.dwellEventId) : null;
  return eventBillable(event, load);
}

/**
 * Sync a dwell event's server-computed detention fee into Load.accessorialCharges.
 * Called from recalculateDwellEvent AFTER departedAt is set.
 * @returns {{ action: 'none'|'created'|'reproposed'|'voided', charge: object|null }}
 */
async function syncDetentionCharge(dwellEvent) {
  // Gate: only act once the driver has departed (dwell is terminal).
  if (!dwellEvent || !dwellEvent.departedAt) return { action: 'none', charge: null };

  const load = await Load.findById(dwellEvent.load);
  if (!load) return { action: 'none', charge: null };
  // Never bill a cancelled event, or one that is not the load's current booking (re-booked / other carrier).
  if (!eventBillable(dwellEvent, load)) return { action: 'none', charge: null };

  // Rate provenance lock (#3): recompute the amount from AUTHORITATIVE rates,
  // never from a (potentially mutated) stored value. Lazy-require breaks the
  // detentionService ↔ detentionBillingService require cycle.
  const { getDetentionRates, calculateDetention } = require('./detentionService');
  const rates = await getDetentionRates(dwellEvent.load);
  if (dwellEvent.detentionRateCents !== rates.rateCentsPerHour ||
      dwellEvent.freeMinutes !== rates.freeMinutes) {
    console.error('[detentionBilling] rate provenance mismatch on dwell', String(dwellEvent._id),
      '— using authoritative rates',
      { stored: { rate: dwellEvent.detentionRateCents, free: dwellEvent.freeMinutes }, authoritative: rates });
  }
  const { detentionMinutes, feeCents } = calculateDetention(
    dwellEvent.dwellMinutes || 0, rates.freeMinutes, rates.rateCentsPerHour
  );

  const evidence = {
    arrivedAt:          dwellEvent.arrivedAt || null,
    dockInAt:           dwellEvent.dockInAt || null,
    dockOutAt:          dwellEvent.dockOutAt || null,
    departedAt:         dwellEvent.departedAt || null,
    dwellMinutes:       dwellEvent.dwellMinutes || 0,
    freeMinutes:        rates.freeMinutes,
    detentionMinutes,
    detentionRateCents: rates.rateCentsPerHour,
    facilityName:       dwellEvent.facilityName || '',
    source:             'auto',
  };
  // Only an authenticated geofence arrival AND departure counts as verified; link-token fixes, manual check-ins
  // and pre-existing (null) events do not.
  const locationVerified = dwellEvent.arrivalAuthenticated === true && dwellEvent.departureAuthenticated === true;
  const newHash = computeEvidenceHash(dwellEvent._id, feeCents, evidence, locationVerified);

  const existing = load.accessorialCharges.find(
    (c) => c.source === 'system_detention' && String(c.dwellEventId) === String(dwellEvent._id)
  );

  // ── No detention owed ──────────────────────────────────────────────────────
  if (feeCents <= 0) {
    if (!existing) return { action: 'none', charge: null };
    if (existing.status === 'pending') {
      // A still-pending proposal that recalculated down to $0 → auto-void.
      existing.status = 'rejected';
      existing.rejectionReason = 'auto-voided: detention recalculated to $0';
      existing.rejectedAt = new Date();
      await load.save();
      return { action: 'voided', charge: existing };
    }
    if (TERMINAL_STATUSES.includes(existing.status)) {
      // A $0 recompute after approval/settlement can't silently undo the money —
      // flag it for manual review instead of leaving it unhandled.
      await flagDiscrepancy(load, existing, 'detention recalculated to $0 after approval');
      return { action: 'flagged', charge: existing };
    }
    return { action: 'none', charge: existing }; // already rejected — nothing to do
  }

  // ── No existing charge → propose (atomic on dwellEventId to defeat the
  //    concurrent-depart race that could otherwise push two charges) ──────────
  if (!existing) {
    const updated = await Load.findOneAndUpdate(
      { _id: load._id, 'accessorialCharges.dwellEventId': { $ne: dwellEvent._id } },
      { $push: { accessorialCharges: {
        type: 'detention',
        source: 'system_detention',
        dwellEventId: dwellEvent._id,
        description: buildDescription(evidence, dwellEvent.stopType, detentionMinutes, locationVerified),
        locationVerified,
        amountCents: feeCents,
        status: 'pending',
        requestedAt: new Date(),
        proposedAt: new Date(),
        evidence,
        evidenceHash: newHash,
      } } },
      { new: true }
    );
    if (!updated) return { action: 'none', charge: null }; // a concurrent writer already created it
    const charge = updated.accessorialCharges.find(
      (c) => c.source === 'system_detention' && String(c.dwellEventId) === String(dwellEvent._id)
    );
    await notifyProposal(updated, charge, { reproposed: false });
    return { action: 'created', charge };
  }

  // ── Terminal (approved/paid) → never auto-rewind; flag genuine changes ──────
  if (TERMINAL_STATUSES.includes(existing.status)) {
    if (existing.evidenceHash !== newHash) {
      await flagDiscrepancy(load, existing, 'detention evidence/amount changed after approval');
    }
    return { action: 'none', charge: existing };
  }

  // ── Unchanged evidence → idempotent no-op (covers same-evidence re-depart AND
  //    a rejected charge that should STAY rejected) ───────────────────────────
  if (existing.evidenceHash === newHash) return { action: 'none', charge: existing };

  // ── Material change on a pending/rejected charge → (re)propose: reset to
  //    pending, refreeze, re-notify. A rejected charge re-proposes only because
  //    its hash differs (material change). ───────────────────────────────────
  existing.status = 'pending';
  existing.amountCents = feeCents;
  existing.description = buildDescription(evidence, dwellEvent.stopType, detentionMinutes, locationVerified);
  existing.locationVerified = locationVerified;
  existing.evidence = evidence;
  existing.evidenceHash = newHash;
  existing.proposedAt = new Date();
  // Invalidate any prior approval/rejection — the shown number changed.
  existing.approvedBy = null;
  existing.approvedAt = null;
  existing.adminConfirmedAt = null;
  existing.adminConfirmedBy = null;
  existing.approvalAudit = { approverUserId: null, approvedAt: null, amountCentsApproved: null, evidenceHashShown: null };
  existing.rejectedBy = null;
  existing.rejectedAt = null;
  existing.rejectionReason = null;
  await load.save();
  await notifyProposal(load, existing, { reproposed: true });
  return { action: 'reproposed', charge: existing };
}

module.exports = { syncDetentionCharge, computeEvidenceHash, isAutoPayable, chargeEventBillable, eventBillable };
