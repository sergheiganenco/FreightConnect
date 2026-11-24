/**
 * The record of one transaction (the items 49 CFR 371.3 lists for a brokered shipment): who shipped,
 * who hauled, the bill of lading reference, the freight charge, what the platform kept, what the
 * carrier was paid and when, plus everything that happened to the load. Both parties see the same
 * record; it is rebuilt from the stored data each time and never edited by hand.
 */
const User = require('../models/User');
const Payment = require('../models/Payment');
const StatusHistory = require('../models/StatusHistory');
const { PLATFORM_FEE_PCT } = require('../config/fees');
const { carrierDocIdentity } = require('../utils/pdfGenerator');

async function buildLoadRecord(load) {
  const [shipper, carrier, payment, history] = await Promise.all([
    User.findById(load.postedBy).select('name companyName').lean(),
    load.acceptedBy ? User.findById(load.acceptedBy).select('name companyName mcNumber dotNumber verification.status verification.fmcsaData').lean() : null,
    Payment.findOne({ loadId: load._id }).sort({ createdAt: -1 }).lean(),
    StatusHistory.find({ entityType: 'load', entityId: load._id }).sort({ timestamp: 1 }).limit(500).lean(),
  ]);

  const freightCents = load.rateCents != null ? load.rateCents : Math.round((load.rate || 0) * 100);
  const feeCents = payment && payment.platformFeeCents != null ? payment.platformFeeCents : Math.round(freightCents * PLATFORM_FEE_PCT);
  const sig = (s) => (s && (s.dataUrl || s.signerName) ? { signerName: s.signerName || null, signedAt: s.signedAt || null } : null);

  return {
    loadId: String(load._id),
    title: load.title,
    status: load.status,
    generatedAt: new Date(),
    shipper: { name: (shipper && (shipper.companyName || shipper.name)) || 'N/A' },
    carrier: carrier ? carrierDocIdentity(carrier) : null,
    driverName: load.assignedDriverName || null,
    truckId: load.assignedTruckId || null,
    shipment: {
      origin: load.origin, destination: load.destination,
      commodity: load.commodityType || null, weight: load.loadWeight || null, equipment: load.equipmentType || null,
      pieces: load.pieceCount || null, sealNumber: load.sealNumber || null, pickupNumber: load.pickupNumber || null,
      pickupWindow: load.pickupTimeWindow || null, deliveryWindow: load.deliveryTimeWindow || null,
      deliveredAt: load.deliveredAt || null,
    },
    money: {
      freightChargeCents: freightCents,
      platformFeeCents: feeCents,
      carrierPayCents: payment && payment.carrierPayoutCents != null ? payment.carrierPayoutCents : freightCents - feeCents,
      paymentTerms: load.paymentTerms || null,
      payment: payment
        ? { status: payment.status, createdAt: payment.createdAt, releasedAt: payment.releasedAt || null, refundedAt: payment.refundedAt || null, payoutRoute: payment.payoutRoute || null }
        : null, // no payment has been taken through the platform for this load
      accessorials: (load.accessorialCharges || []).map((a) => ({
        type: a.type, description: a.description || null, amountCents: a.amountCents, status: a.status,
        requestedAt: a.requestedAt, approvedAt: a.approvedAt || null, paidAt: a.paidAt || null,
      })),
    },
    signatures: { shipper: sig(load.shipperSignature), driver: sig(load.pickupSignature), consignee: sig(load.deliverySignature) },
    documents: {
      rateConfirmation: !!(load.documents && load.documents.rateConfirmation),
      billOfLading: !!(load.documents && load.documents.bol),
      proofOfDelivery: !!(load.documents && load.documents.pod),
      photos: (load.evidence || []).length,
    },
    timeline: history.map((h) => ({ at: h.timestamp, from: h.fromStatus, to: h.toStatus, reason: h.reason || null })),
  };
}

module.exports = { buildLoadRecord };
