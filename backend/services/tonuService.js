/**
 * tonuService.js — the fee a shipper owes the carrier when it cancels a truck that was already booked
 * ("truck ordered, not used").
 *
 * The fee is ALWAYS written onto the load as a charge, so it is a record and not just a notice.
 * It is collected from the shipper's saved card and paid to the carrier only when ENABLE_TONU_COLLECTION=true
 * (keep it off until Stripe is live and the Terms the shipper accepts cover this charge). With the switch off, or
 * when the card cannot be charged, the charge stays pending for the shipper to pay or contest.
 * The carrier is paid ONLY from money actually collected: never from the platform's own balance.
 */
const Load = require('../models/Load');

async function recordAndCollectTonu({ loadId, amountCents, cancelledBy }) {
  const load = await Load.findById(loadId);
  if (!load || !load.acceptedBy || !Number.isInteger(amountCents) || amountCents <= 0) return { recorded: false };
  load.accessorialCharges.push({
    type: 'tonu',
    source: 'system_tonu',
    amountCents,
    description: 'Truck ordered, not used: the shipper cancelled after the carrier had accepted.',
    status: 'pending',
    requestedBy: load.acceptedBy,
    requestedAt: new Date(),
  });
  await load.save();
  const charge = load.accessorialCharges[load.accessorialCharges.length - 1];
  const out = { recorded: true, chargeId: charge._id, collected: false, paidToCarrier: false };
  if (process.env.ENABLE_TONU_COLLECTION !== 'true') return { ...out, reason: 'collection_off' };

  let collect;
  try { collect = await require('./escrowService').collectAccessorialFromShipper(load._id, charge._id); }
  catch (e) { collect = { ok: false, code: 'error' }; }
  if (!collect || !collect.ok) {
    if (collect && collect.paymentIntentId) {
      charge.shipperPaymentStatus = collect.requiresAction ? 'requires_action' : 'failed';
      charge.shipperPaymentIntentId = collect.paymentIntentId;
      await load.save();
    }
    return { ...out, reason: (collect && (collect.requiresAction ? 'requires_action' : collect.code)) || 'error' };
  }

  // Collected. The shipper confirmed the fee in the cancel dialog, so the cancelling user is the approver.
  charge.status = 'approved';
  charge.approvedBy = cancelledBy;
  charge.approvedAt = new Date();
  charge.shipperPaymentStatus = 'collected';
  charge.shipperPaymentIntentId = collect.paymentIntentId || null;
  await load.save();
  const settle = await require('../routes/paymentRoutes').settleAccessorialCharge(load._id, charge._id);
  return { ...out, collected: true, paidToCarrier: !!(settle && settle.ok && !settle.redirectedToFactor && !settle.held), settle };
}

module.exports = { recordAndCollectTonu };
