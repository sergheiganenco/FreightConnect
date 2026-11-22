
module.exports = (io) => {
  const express = require("express");
  const router = express.Router();
  const fetch = require("node-fetch");
  const { body, param } = require("express-validator");
  const auth = require("../middlewares/authMiddleware");
  const validate = require("../middlewares/validate");
  const Load = require("../models/Load");
  const axios = require("axios");
  require("dotenv").config();
  const User = require("../models/User");
  const { generateRateConfirmation, generateBOL } = require("../utils/pdfGenerator");
  const { transitionLoadStatus, canTransition } = require('../services/loadStateMachine');
  const StatusHistory = require('../models/StatusHistory');
  const { checkScheduleConflicts } = require('../services/scheduleConflictService');
  const { notifyUserSafe, notifyAdmins } = require('../utils/notifyUser');
  const { isAutoPayable, chargeEventBillable } = require('../services/detentionBillingService');
  const { pickupBlockers, deliveryBlockers } = require('../services/evidenceService');
  const antiFraudGuard = require('../services/antiFraudGuard');
  const { checkLoadEligibility } = require('../services/loadEligibility');
  const { carrierOpenVisibleConditions, carrierCanSeeLoad } = require('../services/loadVisibility');
  const { haversineMiles, boundingBox, round } = require('../utils/geo');
  const { refreshLoad, messages: pickupRiskMessages, noShowSnapshot, fileNoShowReview } = require('../jobs/pickupRiskMonitor');
  const { estimateEconomics } = require('../utils/loadEconomics');
  const { fetchOrsRoute, plausibleMiles, loadDistanceFields } = require('../services/routingService');
  const { createPostedLoad } = require('../services/loadPostingService');

  // ── Authorization helpers ──────────────────────────────────────────────────
  // The company (owner id) that the acting account belongs to. Sub-accounts
  // (dispatcher/driver) resolve to their owner; owners resolve to themselves.
  function companyOf(req) {
    return req.user.companyOwnerId || req.user.userId;
  }
  // A "party" is the posting shipper company, the accepting carrier company, or an
  // admin — compared at the COMPANY level so sub-accounts are recognized.
  function isLoadParty(load, req) {
    if (req.user.role === 'admin') return true;
    const cid = companyOf(req);
    return load.postedBy?.toString() === cid || load.acceptedBy?.toString() === cid;
  }
  // Carriers may additionally browse OPEN loads they could accept from the board.
  // Returns null when allowed, else the HTTP error to send. A first-look (preferred)
  // load hidden from this carrier answers 404 so its existence is not revealed.
  async function browseDenial(load, req) {
    if (isLoadParty(load, req)) return null;
    if (req.user.role === 'carrier' && load.status === 'open') {
      return (await carrierCanSeeLoad(load, companyOf(req))) ? null : { status: 404, error: 'Load not found' };
    }
    return { status: 403, error: 'Forbidden' };
  }

  // Release an in-escrow authorization hold when a load is cancelled. The escrow
  // uses manual capture, so the funds are only AUTHORIZED — the correct action is
  // to cancel the PaymentIntent (which frees the hold on the shipper's card), not
  // to mark a refund of money that was never captured. Also clears the load's
  // escrow flags so a reopened load starts clean. Returns true if a hold existed.
  async function releaseEscrowHold(loadId, reason) {
    const Payment = require('../models/Payment');
    const payment = await Payment.findOne({ loadId, status: 'in_escrow' });
    if (!payment) return false;

    if (process.env.STRIPE_SECRET_KEY && payment.stripePaymentIntentId) {
      try {
        const escrowService = require('../services/escrowService');
        await escrowService.cancelHold(payment.stripePaymentIntentId, reason);
      } catch (holdErr) {
        console.error('[cancel] Stripe hold cancel failed (non-fatal):', holdErr.message);
      }
    }

    payment.status = 'cancelled';
    payment.refundedAt = new Date();
    await payment.save();

    try {
      await Load.updateOne({ _id: loadId }, { $set: { escrowFunded: false, escrowPaymentIntentId: null } });
    } catch (_) { /* non-critical */ }

    return true;
  }

  // A carrier-fault drop of an ACCEPTED load (already moved to 'cancelled' + cascaded): re-post it for the
  // shipper. 'cancelled' -> 'open' is NOT a valid state-machine transition, so this is one atomic update
  // plus a manual StatusHistory entry. Clears the acceptance fingerprint, driver, rate-con and escrow flags
  // so the relisted load is clean for the next carrier (the Load hooks clear pickup code, risk state and
  // archive evidence). Releases the escrow hold (authorization only, manual capture). Returns escrowRefunded.
  async function reopenAfterCarrierDrop(load, actorId, historyNote, escrowReason) {
    await Load.findByIdAndUpdate(load._id, {
      $set: {
        status: 'open',
        acceptedBy: null,
        assignedTruckId: null,
        acceptanceFingerprint: null,
        assignedDriverId: null,
        assignedDriverName: null,
        cancelledBy: null,
        cancelledByRole: null,
        cancelReason: null,
        cancelledAt: null,
        paymentAssured: false,
        escrowFunded: false,
        escrowPaymentIntentId: null,
        'documents.rateConfirmation': null,
      },
    });
    StatusHistory.record('load', load._id, 'cancelled', 'open', actorId, historyNote).catch(() => {});
    try {
      return await releaseEscrowHold(load._id, escrowReason);
    } catch { return false; /* non-critical */ }
  }

  // When a load is cancelled, terminate the records that hang off it so carriers
  // and shippers don't see live bids/appointments/trip stops on a dead load.
  async function cancelLoadCascade(loadId) {
    try {
      const Bid = require('../models/Bid');
      await Bid.updateMany(
        { loadId, status: { $in: ['pending', 'countered', 'accepted'] } },
        { $set: { status: 'rejected' } }
      );
    } catch (e) { console.error('[cancel cascade] bids failed (non-fatal):', e.message); }
    try {
      const Appointment = require('../models/Appointment');
      // Appointment has no top-level status: each leg (pickup/delivery) carries its own. Cancel only
      // legs that are still live; 'missed' and already 'cancelled' legs are history and stay as they are.
      for (const leg of ['pickup', 'delivery']) {
        await Appointment.updateMany(
          { load: loadId, [`${leg}.status`]: { $in: ['pending', 'confirmed', 'rescheduled'] } },
          { $set: { [`${leg}.status`]: 'cancelled' }, $push: { history: { action: 'cancelled', type: leg, notes: 'Load cancelled or released', timestamp: new Date() } } }
        );
      }
    } catch (e) { console.error('[cancel cascade] appointments failed (non-fatal):', e.message); }
    try {
      const Trip = require('../models/Trip');
      await Trip.updateMany(
        { loads: loadId, status: { $in: ['planned', 'active'] } },
        { $pull: { loads: loadId } }
      );
    } catch (e) { console.error('[cancel cascade] trips failed (non-fatal):', e.message); }
  }

  // ── Helper: auto-generate Rate Confirmation (non-blocking) ─────────────────
  async function autoGenerateRateCon(loadId, carrierId, shipperId) {
    try {
      const [load, carrier, shipper] = await Promise.all([
        Load.findById(loadId),
        User.findById(carrierId).select('name email companyName mcNumber dotNumber verification'),
        User.findById(shipperId).select('name email companyName'),
      ]);
      if (!load || !carrier || !shipper) return;
      const filePath = await generateRateConfirmation(load, carrier, shipper);
      await Load.findByIdAndUpdate(loadId, { 'documents.rateConfirmation': filePath });
      try { io.to(`user_${carrierId}`).emit('doc:generated', { loadId, type: 'rateConfirmation', path: filePath }); } catch (_) {}
      try { io.to(`user_${shipperId}`).emit('doc:generated', { loadId, type: 'rateConfirmation', path: filePath }); } catch (_) {}
    } catch (err) {
      console.error('[RateCon] Auto-generate failed (non-fatal):', err.message);
    }
  }

  // ── Helper: auto-generate Bill of Lading on delivery (non-blocking) ────────
  async function autoGenerateBOL(loadId) {
    try {
      const load = await Load.findById(loadId);
      // Always (re)generate on delivery: a pickup-signed BOL must be refreshed so
      // it embeds deliveredAt + the delivery/consignee signature. Idempotent —
      // overwrites the same <id>-bol.pdf.
      if (!load) return;
      const [carrier, shipper] = await Promise.all([
        load.acceptedBy ? User.findById(load.acceptedBy).select('name email companyName mcNumber dotNumber verification') : null,
        load.postedBy ? User.findById(load.postedBy).select('name email companyName') : null,
      ]);
      if (!carrier || !shipper || typeof generateBOL !== 'function') return;
      const filePath = await generateBOL(load, carrier, shipper);
      await Load.findByIdAndUpdate(loadId, { 'documents.bol': filePath });
      try { io.to(`user_${load.acceptedBy}`).emit('doc:generated', { loadId, type: 'bol', path: filePath }); } catch (_) {}
      try { io.to(`user_${load.postedBy}`).emit('doc:generated', { loadId, type: 'bol', path: filePath }); } catch (_) {}
    } catch (err) {
      console.error('[BOL] Auto-generate failed (non-fatal):', err.message);
    }
  }

  // ----------------------------------------
  // GET /api/loads - Return all loads (open + carrier's accepted)
  // ---------------------------------------
  // Trip miles / rate-per-mile (and, for carrier managers, profit) annotation shared by the
  // board list and GET /:id so a load opened from anywhere shows the same figures.
  const annotateTrip = (l, deadheadMiles, wantsEconomics, costPerMileCents) => {
    const hasO = Number.isFinite(l.originLat) && Number.isFinite(l.originLng);
    const hasD = Number.isFinite(l.destinationLat) && Number.isFinite(l.destinationLng);
    // Stored road miles when present; otherwise straight-line (understates driven miles).
    const isRoad = Number.isFinite(l.distanceMiles) && l.distanceMiles > 0;
    let tripMiles = null;
    if (isRoad) tripMiles = l.distanceMiles;
    else if (hasO && hasD) {
      tripMiles = round(haversineMiles(l.originLat, l.originLng, l.destinationLat, l.destinationLng), 0);
    }
    const milesBasis = tripMiles == null ? null : isRoad ? 'road' : 'straight_line';
    const rateCents = Number.isInteger(l.rateCents) ? l.rateCents
      : typeof l.rate === 'number' ? Math.round(l.rate * 100) : null;
    // Same cents and same miles as the economics block below.
    const ratePerMile =
      rateCents > 0 && tripMiles && tripMiles > 0
        ? round(rateCents / 100 / tripMiles, 2)
        : null;

    const out = { ...l, deadheadMiles, tripMiles, ratePerMile, milesBasis };
    if (wantsEconomics) {
      // Trip miles are road miles when stored, else straight-line (profit optimistic).
      // Deadhead is always straight-line.
      const e = estimateEconomics({ rateCents, tripMiles, deadheadMiles, costPerMileCents });
      out.economics = e && { ...e, rateCents, costPerMileCents, milesBasis, deadheadBasis: e.includesDeadhead ? 'straight_line' : null };
    }
    return out;
  };

  router.get("/", auth, async (req, res) => {
    try {
      const { status, equipmentType, minRate, maxRate, pickupStart, pickupEnd, sortBy, sortOrder } = req.query;

      // Scope by the COMPANY (owner id), so a dispatcher/driver sub-account sees the
      // company's loads. For an owner this equals their own id (behavior unchanged).
      const companyId = req.user.companyOwnerId || req.user.userId;

      let filter = {};
      // The set of open-load conditions that respect preferred-visibility gating.
      // Reused below so a `?status=` filter can't accidentally leak preferred loads.
      let carrierOpenVisible = null;

      // ---- Carrier: open loads and loads accepted by this carrier
      // Preferred-visibility loads are hidden from non-preferred carriers during firstLook window
      if (req.user.role === "carrier") {
        carrierOpenVisible = await carrierOpenVisibleConditions(companyId);

        filter = {
          $or: [
            ...carrierOpenVisible,
            // Loads accepted by this company
            { acceptedBy: companyId },
          ],
        };
      }

      // ---- Shipper: loads posted by this company
      else if (req.user.role === "shipper") {
        filter = { postedBy: companyId };
      }

      // ---- Admin: see ALL loads (no filter = all docs)
      // You can apply more admin-specific filtering if needed

      // --- Shared filters ---
      if (status && status !== "all") {
        if (req.user.role === "carrier") {
          if (status === "open") {
            // Only open loads — but keep the preferred-visibility gating intact.
            filter = { $or: carrierOpenVisible };
          } else {
            // The company's own loads in this status (do not surface others' loads).
            filter = { status, acceptedBy: companyId };
          }
        } else {
          filter.status = status;
        }
      }
      if (equipmentType) filter.equipmentType = equipmentType;
      if (minRate || maxRate) {
        filter.rate = {};
        if (minRate) filter.rate.$gte = Number(minRate);
        if (maxRate) filter.rate.$lte = Number(maxRate);
      }
      if (pickupStart || pickupEnd) {
        filter["pickupTimeWindow.start"] = {};
        if (pickupStart) filter["pickupTimeWindow.start"].$gte = new Date(pickupStart);
        if (pickupEnd) filter["pickupTimeWindow.start"].$lte = new Date(pickupEnd);
      }

      // --- Lane / deadhead geo search ---
      // originLat/originLng + originRadius (mi): loads picking up near a point.
      // destLat/destLng + destRadius (mi): loads delivering near a point.
      // A cheap bounding box pre-filters in Mongo; the exact circle is enforced in
      // JS below. origin is also the reference for the deadhead distance.
      const oLat = parseFloat(req.query.originLat);
      const oLng = parseFloat(req.query.originLng);
      const oRadius = Math.min(1000, Math.max(1, parseFloat(req.query.originRadius) || 50));
      const hasOriginSearch = Number.isFinite(oLat) && Number.isFinite(oLng) && req.query.originRadius != null;

      const dLat = parseFloat(req.query.destLat);
      const dLng = parseFloat(req.query.destLng);
      const dRadius = Math.min(1000, Math.max(1, parseFloat(req.query.destRadius) || 50));
      const hasDestSearch = Number.isFinite(dLat) && Number.isFinite(dLng) && req.query.destRadius != null;

      if (hasOriginSearch) {
        const b = boundingBox(oLat, oLng, oRadius);
        filter.originLat = { $gte: b.latMin, $lte: b.latMax };
        filter.originLng = { $gte: b.lngMin, $lte: b.lngMax };
      }
      if (hasDestSearch) {
        const b = boundingBox(dLat, dLng, dRadius);
        filter.destinationLat = { $gte: b.latMin, $lte: b.latMax };
        filter.destinationLng = { $gte: b.lngMin, $lte: b.lngMax };
      }

      // --- Sorting ---
      const sortCriteria = {};
      if (sortBy) sortCriteria[sortBy] = sortOrder === "desc" ? -1 : 1;
      else sortCriteria.createdAt = -1;

      let loads = await Load.find(filter).sort(sortCriteria).lean();

      // Profit estimate: carrier managers only (drivers never see company margin), and the
      // COMPANY OWNER's cost-per-mile, loaded once per request.
      let costPerMileCents = null;
      const wantsEconomics = req.user.role === "carrier" && req.user.companyRole !== "driver";
      if (wantsEconomics) {
        const owner = await User.findById(companyId).select("preferences.costPerMileCents").lean();
        costPerMileCents = owner?.preferences?.costPerMileCents ?? null;
      }

      // Refine the bounding box to the true radius and annotate each load with
      // trip miles, rate-per-mile, and (when an origin is given) deadhead miles.
      loads = loads
        .map((l) => {
          const hasO = Number.isFinite(l.originLat) && Number.isFinite(l.originLng);
          const hasD = Number.isFinite(l.destinationLat) && Number.isFinite(l.destinationLng);

          let deadheadMiles = null;
          if (hasOriginSearch && hasO) {
            deadheadMiles = round(haversineMiles(oLat, oLng, l.originLat, l.originLng), 0);
          }
          return annotateTrip(l, deadheadMiles, wantsEconomics, costPerMileCents);
        })
        // Enforce the exact circle (bounding box is a superset).
        .filter((l) => {
          if (hasOriginSearch) {
            if (l.deadheadMiles == null || l.deadheadMiles > oRadius) return false;
          }
          if (hasDestSearch) {
            if (!Number.isFinite(l.destinationLat) || !Number.isFinite(l.destinationLng)) return false;
            if (haversineMiles(dLat, dLng, l.destinationLat, l.destinationLng) > dRadius) return false;
          }
          return true;
        });

      // When searching by origin, closest deadhead first is the most useful order.
      if (hasOriginSearch) {
        loads.sort((a, b) => (a.deadheadMiles ?? Infinity) - (b.deadheadMiles ?? Infinity));
      }

      res.json(loads);
    } catch (err) {
      console.error("Error fetching loads:", err);
      res.status(500).json({ error: "Server error fetching loads" });
    }
  });
  

// GET /api/loads/open - All open loads (not yet assigned)
router.get("/open", auth, async (req, res) => {
  try {
    // Only show open, unassigned loads
    const companyId = req.user.companyOwnerId || req.user.userId;
    let openFilter;
    if (req.user.role === "carrier") openFilter = { $or: await carrierOpenVisibleConditions(companyId) };
    else if (req.user.role === "admin") openFilter = { status: "open" };
    else openFilter = { status: "open", postedBy: companyId }; // shippers: only their own postings
    const openLoads = await Load.find(openFilter).where({ assignedTruckId: null });
    res.json(openLoads);
  } catch (err) {
    console.error("Error fetching open loads:", err);
    res.status(500).json({ error: "Server error fetching open loads" });
  }
});


  // ----------------------------------------
  // GET /api/loads/accepted (Paginated)
  // ----------------------------------------
  router.get("/accepted", auth, async (req, res) => {
    try {
      if (req.user.role !== "carrier") {
        return res
          .status(403)
          .json({ error: "Only carriers can view accepted loads" });
      }

      const { page = 1, limit = 10 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const scopeId = req.user.companyOwnerId || req.user.userId;
      const acceptedLoads = await Load.find({ acceptedBy: scopeId })
        .skip(skip)
        .limit(parseInt(limit));

      const totalCount = await Load.countDocuments({
        acceptedBy: scopeId,
      });

      res.json({
        loads: acceptedLoads,
        totalPages: Math.ceil(totalCount / limit),
        currentPage: parseInt(page),
      });
    } catch (err) {
      console.error("Error fetching accepted loads:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // ----------------------------------------
  // GET /api/loads/posted - For Shippers
  // ----------------------------------------
  router.get("/posted", auth, async (req, res) => {
    try {
      if (req.user.role !== "shipper") {
        return res
          .status(403)
          .json({ error: "Only shippers can view their posted loads" });
      }

      const { status, sortBy, sortOrder } = req.query;

      // Company-scoped: shipper sub-accounts see the company's posted loads.
      let filters = { postedBy: req.user.companyOwnerId || req.user.userId };
      if (status) filters.status = status;

      const sortOptions = {};
      if (sortBy) sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

      const loads = await Load.find(filters).sort(sortOptions);
      res.json(loads);
    } catch (err) {
      console.error("Error fetching posted loads:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // ----------------------------------------
  // GET /api/loads/recommended — ranked open loads for the requesting carrier
  // ----------------------------------------
  router.get('/recommended', auth, async (req, res) => {
    try {
      if (req.user.role !== 'carrier') {
        return res.status(403).json({ error: 'Only carriers can view recommended loads' });
      }
      const { findMatchesForCarrier } = require('../services/matchingService');
      const limit = Math.min(parseInt(req.query.limit) || 20, 50);
      // Match against the company's preferences (which live on the owner account).
      const matches = await findMatchesForCarrier(req.user.companyOwnerId || req.user.userId, limit);
      res.json(matches); // [{load, score}]
    } catch (err) {
      console.error('Error fetching recommended loads:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

 // POST /api/loads - Create a New Load
// ----------------------------------------
const createLoadValidation = [
  body("title").trim().notEmpty().withMessage("Title is required"),
  body("origin").trim().notEmpty().withMessage("Origin is required"),
  body("destination").trim().notEmpty().withMessage("Destination is required"),
  body("rate")
    .isFloat({ gt: 0 })
    .withMessage("Rate must be a positive number"),
  body("equipmentType")
    .trim()
    .notEmpty()
    .withMessage("Equipment type is required"),
  body("requirePickupVerification").optional().isBoolean().withMessage("requirePickupVerification must be a boolean"),
  body("requirePickupPhotos").optional().isBoolean().withMessage("requirePickupPhotos must be a boolean"),
  body("requireDeliveryPhotos").optional().isBoolean().withMessage("requireDeliveryPhotos must be a boolean"),
];

router.post('/', auth, createLoadValidation, validate, async (req, res) => {
  try {
    // Verification lives on the company owner, so a shipper sub-account is checked against the company.
    const companyId = req.user.companyOwnerId || req.user.userId;
    if (req.user.role !== 'shipper') {
      return res.status(403).json({ error: 'Only shippers can post loads.' });
    }

    const {
      title,
      origin,
      destination,
      rate,
      equipmentType,

      // Time windows from the front-end form
      pickupWindowStart,
      pickupWindowEnd,
      deliveryWindowStart,
      deliveryWindowEnd,

      // Additional form fields
      commodityType,
      commodityCategory,
      weight,

      // Reefer / temperature control
      temperatureMin,
      temperatureMax,
      temperatureUnit,
      reeferNotes,

      // Hazmat details
      hazmatClass,
      hazmatPackingGroup,
      dangerousGoodsUN,
      hazardousMaterial,

      // Enterprise / extended fields
      specialHandling,
      accessorials,
      insuranceRequired,
      cargoValue,
      paymentTerms,
      currency,
      loadVisibility,
      allowCarrierBidding,
      expirationDateTime,
      notes,
      specialInstructions,
      carrierInstructions,
      documentsRequired,

      // Load dimensions
      loadLength,
      loadWidth,
      loadHeight,

      // Reference numbers
      poNumber,
      shipperReferenceNumber,
      consigneeReference,

      // Facility details
      pickupFacilityName,
      pickupAddress,
      pickupContactName,
      pickupContactPhone,
      deliveryFacilityName,
      deliveryAddress,
      deliveryContactName,
      deliveryContactPhone,

      // Overweight acknowledgment
      overweightAcknowledged,
      overweightPermitNumber,

      // Multi-stop
      stops: rawStops,

      // Pickup handshake (anti-impersonation) — optional opt-in
      requirePickupVerification,
      requirePickupPhotos,
      requireDeliveryPhotos,
    } = req.body;

    // ---------- build & save ---------
    // Parse array fields that may arrive as JSON strings (FormData uploads)
    const parseArr = (v) => {
      if (Array.isArray(v)) return v;
      if (typeof v === 'string' && v.startsWith('[')) try { return JSON.parse(v); } catch { /* ignore */ }
      return undefined;
    };

    const fields = {
      title,
      origin,
      originLat: req.body.originLat,
      originLng: req.body.originLng,
      destination,
      destinationLat: req.body.destinationLat,
      destinationLng: req.body.destinationLng,
      rate,
      equipmentType,
      commodityType: commodityType || undefined,
      commodityCategory: commodityCategory || undefined,
      loadWeight: weight ? Number(weight) : undefined,
      specialInstructions: specialInstructions || undefined,

      // Time windows (the form sends datetime-local, so no zone is required; parsed by the posting service)
      pickupTimeWindow: pickupWindowStart ? { start: pickupWindowStart, end: pickupWindowEnd } : undefined,
      deliveryTimeWindow: deliveryWindowStart ? { start: deliveryWindowStart, end: deliveryWindowEnd } : undefined,

      // Dimensions
      loadDimensions: (loadLength || loadWidth || loadHeight) ? {
        length: loadLength ? Number(loadLength) : undefined,
        width: loadWidth ? Number(loadWidth) : undefined,
        height: loadHeight ? Number(loadHeight) : undefined,
      } : undefined,

      // Hazmat
      hazardousMaterial: hazardousMaterial === true || hazardousMaterial === 'true',
      hazmatClass: (hazardousMaterial === true || hazardousMaterial === 'true') ? hazmatClass : undefined,
      hazmatPackingGroup: (hazardousMaterial === true || hazardousMaterial === 'true') ? hazmatPackingGroup : undefined,
      dangerousGoodsUN: (hazardousMaterial === true || hazardousMaterial === 'true') ? dangerousGoodsUN : undefined,

      // Enterprise fields
      specialHandling: parseArr(specialHandling),
      accessorials: parseArr(accessorials),
      insuranceRequired: insuranceRequired ? Number(insuranceRequired) : undefined,
      cargoValue: cargoValue ? Number(cargoValue) : undefined,
      paymentTerms: paymentTerms || undefined,
      currency: currency || 'USD',
      loadVisibility: loadVisibility || 'public',
      allowCarrierBidding: allowCarrierBidding !== false && allowCarrierBidding !== 'false',
      expirationDateTime: expirationDateTime ? new Date(expirationDateTime) : undefined,
      notes: notes || undefined,
      carrierInstructions: carrierInstructions || undefined,
      documentsRequired: parseArr(documentsRequired),

      // Reference numbers
      poNumber: poNumber || undefined,
      shipperReferenceNumber: shipperReferenceNumber || undefined,
      consigneeReference: consigneeReference || undefined,

      // Facility details
      pickupFacilityName: pickupFacilityName || undefined,
      pickupAddress: pickupAddress || undefined,
      pickupContactName: pickupContactName || undefined,
      pickupContactPhone: pickupContactPhone || undefined,
      deliveryFacilityName: deliveryFacilityName || undefined,
      deliveryAddress: deliveryAddress || undefined,
      deliveryContactName: deliveryContactName || undefined,
      deliveryContactPhone: deliveryContactPhone || undefined,

      // Overweight acknowledgment
      overweightAcknowledged: overweightAcknowledged === true || overweightAcknowledged === 'true',
      overweightPermitNumber: overweightPermitNumber || undefined,

      pickupVerification: { required: requirePickupVerification === true || requirePickupVerification === 'true' },
      evidenceRequired: {
        pickup: requirePickupPhotos === true || requirePickupPhotos === 'true',
        delivery: requireDeliveryPhotos === true || requireDeliveryPhotos === 'true',
      },

      // Reefer settings (convert F→C if needed)
      reefer: equipmentType === 'Reefer'
        ? {
            enabled: true,
            targetMinC: temperatureMin !== '' && temperatureMin != null && !isNaN(parseFloat(temperatureMin))
              ? (temperatureUnit === 'F' ? Math.round((parseFloat(temperatureMin) - 32) * 5 / 9 * 10) / 10 : parseFloat(temperatureMin))
              : undefined,
            targetMaxC: temperatureMax !== '' && temperatureMax != null && !isNaN(parseFloat(temperatureMax))
              ? (temperatureUnit === 'F' ? Math.round((parseFloat(temperatureMax) - 32) * 5 / 9 * 10) / 10 : parseFloat(temperatureMax))
              : undefined,
            alertOnDeviation: true,
            notes: reeferNotes || undefined,
          }
        : undefined,
    };

    if (Array.isArray(rawStops) && rawStops.length > 0) {
      fields.stops = rawStops.map((s, i) => ({
        sequence: s.sequence ?? i + 1,
        type: s.type || 'delivery',
        address: s.address,
        timeWindow: s.timeWindow || {},
        contactName: s.contactName || undefined,
        contactPhone: s.contactPhone || undefined,
        notes: s.notes || undefined,
        status: 'pending',
      }));
    }

    // gate -> validation -> geocode -> distance -> create -> notifications: shared with EDI, bulk and email import
    const r = await createPostedLoad({ shipperCompanyId: companyId, fields, io });
    if (!r.load) return res.status(r.status).json({ error: r.error, ...r.extra });
    res.status(201).json(r.needsLocation ? { ...r.load.toObject(), needsLocation: true } : r.load);
  } catch (err) {
    console.error('Error saving load:', err);
    res.status(500).json({ error: 'Failed to post load.' });
  }
});

  // ----------------------------------------
  // GET /api/loads/:id/schedule-check — Pre-accept schedule conflict check
  // Carrier calls this BEFORE accepting to see warnings/blockers
  // ----------------------------------------
  router.get("/:id/schedule-check", auth, async (req, res) => {
    try {
      if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
      const load = await Load.findById(req.params.id);
      if (!load) return res.status(404).json({ error: 'Load not found' });

      const result = await checkScheduleConflicts(req.user.companyOwnerId || req.user.userId, load);
      res.json(result);
    } catch (err) {
      console.error('Error checking schedule:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ----------------------------------------
  // PUT /api/loads/:id/accept - Accept a Load (atomic — prevents double-accept)
  // ----------------------------------------
  router.put("/:id/accept", auth, async (req, res) => {
    try {
      // A sub-account books on behalf of its company: ownership, the eligibility/
      // fraud gate, and verification/fleet/insurance all resolve to the owner account.
      const companyId = req.user.companyOwnerId || req.user.userId;
      // Pre-fetch the carrier COMPANY (verification/fleet live on the owner) and the
      // load for the anti-fraud evaluation.
      const carrier = await User.findById(companyId)
        .select('role verification fleet carrierEndorsements');
      const loadToCheck = await Load.findById(req.params.id);
      if (!loadToCheck) {
        return res.status(404).json({ error: "Load not found" });
      }
      // First-look: a non-preferred carrier cannot book a preferred load early.
      if (!(await carrierCanSeeLoad(loadToCheck, companyId))) {
        return res.status(404).json({ error: "Load not found" });
      }

      // Coordinates are required for routing/rate-con/tracking. Check BEFORE booking
      // so a geocode-less load can't be half-booked (accepted in the DB but returning
      // an error with no rate confirmation, chat thread, or status history).
      if (!loadToCheck.originLat || !loadToCheck.originLng || !loadToCheck.destinationLat || !loadToCheck.destinationLng) {
        return res.status(400).json({ error: "Load is missing required location coordinates" });
      }

      // ── Eligibility guard: equipment subtype + endorsement requirements ─────
      // Carrier-level endorsements are checked here; the assigned driver is
      // re-checked at PUT /:id/assign-driver (driver may not be set yet).
      {
        const eligibility = checkLoadEligibility({ load: loadToCheck, carrier });
        if (!eligibility.eligible) {
          return res.status(403).json({
            error: 'Not eligible for this load',
            reasons: eligibility.reasons,
          });
        }
      }

      // ── Anti-fraud guard: identity, insurance, double-broker / bot signals ──
      // Hard-blocks unverified identity and lapsed/expired insurance (no stolen
      // MC numbers). Replaces the old inline verification + insurance checks.
      const fraudResult = await antiFraudGuard.evaluateAcceptance({
        load: loadToCheck,
        carrier,
        req,
      });
      if (!fraudResult.allowed) {
        return res.status(403).json({
          error: 'Cannot accept load: ' + fraudResult.reasons.join('; '),
          reasons: fraudResult.reasons,
          verificationStatus: carrier?.verification?.status || 'unverified',
        });
      }

      // Schedule conflict check — block if "blocking" conflicts exist
      // (carrier can bypass warnings with ?force=true). Checked against the
      // company's other loads.
      {
        const scheduleResult = await checkScheduleConflicts(companyId, loadToCheck);
        if (!scheduleResult.canAccept && req.query.force !== 'true') {
          return res.status(409).json({
            error: 'Schedule conflict prevents accepting this load',
            scheduleConflicts: scheduleResult.conflicts,
            summary: scheduleResult.summary,
          });
        }
      }

      // Atomic: only succeeds if load is still open and not yet accepted.
      // Also records the device/identity fingerprint + any soft risk flags for audit.
      const acceptanceFingerprint = antiFraudGuard.buildFingerprint(req, companyId);
      const acceptUpdate = {
        status: "accepted",
        acceptedBy: companyId,
        acceptanceFingerprint,
      };
      if (fraudResult.riskFlags && fraudResult.riskFlags.length > 0) {
        acceptUpdate.riskFlags = fraudResult.riskFlags;
      }
      const load = await Load.findOneAndUpdate(
        { _id: req.params.id, status: "open", acceptedBy: null },
        { $set: acceptUpdate },
        { new: true }
      );

      if (!load) {
        const exists = await Load.findById(req.params.id);
        if (!exists) return res.status(404).json({ error: "Load not found" });
        return res.status(409).json({ error: "Load is no longer available — already accepted by another carrier" });
      }

      if (fraudResult.riskFlags && fraudResult.riskFlags.length > 0) {
        console.warn(`[antiFraudGuard] Load ${load._id} accepted by carrier ${req.user.userId} with risk flags: ${fraudResult.riskFlags.join(', ')}`);
      }

      // ── Payment-assured trust signal (non-blocking) ─────────────────────
      // Carriers can trust loads where the shipper has a payment method on file.
      // Never blocks acceptance; the helper may not exist yet.
      let paymentAssured = false;
      try {
        const { shipperHasPaymentMethod } = require('./paymentRoutes');
        if (typeof shipperHasPaymentMethod === 'function') {
          paymentAssured = await shipperHasPaymentMethod(load.postedBy);
        }
      } catch (_) {}
      try { await Load.findByIdAndUpdate(load._id, { paymentAssured }); } catch (_) {}
      await require('../services/standbyService').buildStandby(load, companyId);

      // ── Funded escrow hold at booking (non-blocking) ────────────────────
      try {
        const { createEscrowHoldForLoad } = require('./paymentRoutes');
        if (typeof createEscrowHoldForLoad === 'function') {
          const escrow = await createEscrowHoldForLoad(load._id);
          if (escrow && escrow.error) console.warn('[accept] escrow hold:', escrow.error);
        }
      } catch (e) { console.warn('[accept] escrow hold failed (non-fatal):', e.message); }

      // Auto-generate Rate Confirmation (non-blocking) — carrier = the company.
      autoGenerateRateCon(load._id, companyId, load.postedBy);

      // Auto-create a load_thread channel between the carrier company and shipper.
      try {
        const Channel = require("../models/Channel");
        const Message = require("../models/Message");
        const channelId = `load_${load._id}`;
        const existing = await Channel.findOne({ channelId });
        if (!existing) {
          const channel = await Channel.create({
            channelType: "load_thread",
            channelId,
            loadId: load._id,
            participants: [
              { user: companyId, role: "carrier" },
              { user: load.postedBy, role: "shipper" },
            ],
            lastMessageAt: new Date(),
            lastMessagePreview: "Carrier accepted this load",
          });
          await Message.create({
            channelType: "load_thread",
            channelId,
            sender: null,
            content: `✓ Carrier accepted this load. You can now communicate directly here.`,
            messageType: "system",
            readBy: [],
          });
          // Notify shipper via their personal room
          io.to(`user_${load.postedBy}`).emit('chat:channelCreated', { channel });
        }
      } catch (chatErr) {
        console.error("Failed to create load thread (non-fatal):", chatErr);
      }

      res.json({ message: "Load accepted successfully", load });

      // Record status history (non-blocking)
      StatusHistory.record('load', load._id, 'open', 'accepted', req.user.userId, 'Load accepted by carrier').catch(() => {});
    } catch (err) {
      console.error("Error accepting load:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // ----------------------------------------
  // GET /api/loads/my-loads - All loads accepted by this carrier
  // ----------------------------------------
  router.get("/my-loads", auth, async (req, res) => {
    try {
      if (req.user.role !== "carrier") {
        return res
          .status(403)
          .json({ error: "Only carriers can view this data" });
      }

      // Company-scoped: a dispatcher/driver sub-account sees the company's loads.
      const companyId = req.user.companyOwnerId || req.user.userId;
      const loads = await Load.find({ acceptedBy: companyId });
      res.json(loads);
    } catch (err) {
      console.error("Error fetching carrier loads:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // For shippers to view their own loads
router.get("/shipper-my-loads", auth, async (req, res) => {
  try {
    if (req.user.role !== "shipper") {
      return res
        .status(403)
        .json({ error: "Only shippers can view this data" });
    }

    // If your Load model stores a reference to shipper by userId:
    // Load has no `shipperId` field — the owner is `postedBy`. Company-scoped so a
    // shipper sub-account sees the company's loads. (This endpoint backs the
    // shipper Documents page, which was permanently empty due to the bad field.)
    const loads = await Load.find({ postedBy: req.user.companyOwnerId || req.user.userId });
    res.json(loads);
  } catch (err) {
    console.error("Error fetching shipper loads:", err);
    res.status(500).json({ error: "Server error" });
  }
});


  // ----------------------------------------
  // GET /api/loads/get-route - Simple route from start->end via ORS
  // (You might not use this if you do /:id/route)
  // ----------------------------------------
  router.get("/get-route", auth, async (req, res) => {
    try {
      const { start, end } = req.query;
      if (!start || !end) {
        return res.status(400).json({ error: "Start and End locations are required" });
      }

      const apiKey = process.env.ORS_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "API Key is missing in backend" });
      }

      const url = `https://api.openrouteservice.org/v2/directions/driving-hgv?api_key=${apiKey}&start=${start}&end=${end}`;

      const response = await axios.get(url);
      res.json(response.data);
    } catch (error) {
      console.error("Error fetching route:", error.response?.data || error.message);
      res.status(500).json({ error: "Failed to fetch route" });
    }
  });

  router.get("/:id", auth, async (req, res) => {
    try {
      const load = await Load.findById(req.params.id);
      if (!load) return res.status(404).json({ error: "Load not found" });
      // A party can always see their load; carriers can browse OPEN loads. Non-open
      // loads you aren't party to (private/accepted/in-transit) are not readable.
      const denied = await browseDenial(load, req);
      if (denied) return res.status(denied.status).json({ error: denied.error });
      if (req.user.role === "carrier") {
        // Same annotations as the board list (optional ?deadheadMiles= from the caller's context).
        const dh = req.query.deadheadMiles === undefined ? NaN : Number(req.query.deadheadMiles);
        const wantsEconomics = req.user.companyRole !== "driver";
        const owner = wantsEconomics
          ? await User.findById(req.user.companyOwnerId || req.user.userId).select("preferences.costPerMileCents").lean()
          : null;
        return res.json(annotateTrip(load.toObject(), Number.isFinite(dh) && dh >= 0 ? dh : null, wantsEconomics, owner?.preferences?.costPerMileCents ?? null));
      }
      res.json(load);
    } catch (err) {
      res.status(500).json({ error: "Server error fetching load by ID" });
    }
  });
  // ----------------------------------------
  // GET /api/loads/:id/tracking

  router.get("/:id/tracking", auth, async (req, res) => {
    try {
      const load = await Load.findById(req.params.id);
      if (!load) {
        console.error("Load not found");
        return res.status(404).json({ error: "Load not found" });
      }

      // Live position is sensitive — only the shipper, the accepting carrier, or an admin.
      if (!isLoadParty(load, req)) return res.status(403).json({ error: "Forbidden" });

      if (!load.acceptedBy) {
        console.error("Load not accepted by a carrier");
        return res.status(400).json({ error: "Load not accepted yet" });
      }
  
      // Find the carrier
      const carrier = await User.findById(load.acceptedBy);
      if (!carrier || !carrier.location) {
        console.error("Carrier location not found in DB");
        return res.status(404).json({ error: "Carrier location not available" });
      }
  
      // Check destination coords
      if (!load.destinationLat || !load.destinationLng) {
        console.error("Load missing destination coords");
        return res.status(400).json({ error: "Load destination coords not set" });
      }
  
      // Build ORS request
      const url = `https://api.openrouteservice.org/v2/directions/driving-hgv?api_key=${process.env.ORS_API_KEY}&start=${carrier.location.longitude},${carrier.location.latitude}&end=${load.destinationLng},${load.destinationLat}`;

  
      const orsResponse = await axios.get(url);
      if (!orsResponse.data || !orsResponse.data.features) {
        return res.status(400).json({ error: "No valid route found" });
      }
  
      // Transform [lng, lat] => [lat, lng]
      const routeCoords = orsResponse.data.features[0].geometry.coordinates;
      const leafletCoords = routeCoords.map(([lng, lat]) => [lat, lng]);
  
      res.json({
        carrierLocation: carrier.location,  // e.g. { latitude, longitude }
        route: leafletCoords,
      });
    } catch (err) {
      console.error("Error fetching tracking data:", err);
      res.status(500).json({ error: "Failed to fetch tracking data" });
    }
  });
  

  

  // ----------------------------------------
  // GET /api/loads/:id/route
  // (Origin->Destination route from the load's lat/lng)
  // ----------------------------------------
  router.get("/:id/route", auth, async (req, res) => {
    try {
      const load = await Load.findById(req.params.id);
      if (!load) return res.status(404).json({ error: "Load not found." });
      const denied = await browseDenial(load, req);
      if (denied) return res.status(denied.status).json({ error: denied.error });

      if (!load.originLat || !load.originLng || !load.destinationLat || !load.destinationLng) {
        return res.status(400).json({
          error: "Load is missing required location coordinates.",
        });
      }

      if (!process.env.ORS_API_KEY) {
        return res
          .status(500)
          .json({ error: "ORS_API_KEY is not set on the server" });
      }

      const r = await fetchOrsRoute(load.originLat, load.originLng, load.destinationLat, load.destinationLng);
      if (!r) return res.status(400).json({ error: "No valid route found." });

      const stored = plausibleMiles(r.meters, load.originLat, load.originLng, load.destinationLat, load.destinationLng);
      // Heal old loads: persist the road miles (not for multi-stop: route ignores stops).
      if (load.distanceMiles == null && stored != null && !(load.stops && load.stops.length)) {
        await Load.updateOne({ _id: load._id, distanceMiles: null }, { $set: { distanceMiles: stored, distanceSource: 'ors' } });
      }

      res.json({
        route: r.coordinates,
        // Prefer the stored figure so card and modal agree.
        distance: (load.distanceMiles ?? (stored ?? r.meters / 1609.344)).toFixed(2),
        estimatedTime: (r.seconds / 3600).toFixed(2),
      });
    } catch (err) {
      console.error("❌ Error fetching route:", err);
      res.status(500).json({ error: "Failed to fetch route." });
    }
  });

// PUT /api/loads/:id/deliver
router.put("/:id/deliver", auth, async (req, res) => {
  try {
    // Only carriers should mark loads as delivered
    if (req.user.role !== "carrier") {
      return res.status(403).json({ error: "Only carriers can mark loads as delivered" });
    }

    const load = await Load.findById(req.params.id);
    if (!load) {
      return res.status(404).json({ error: "Load not found" });
    }

    // ── Anti double-brokering: the COMPANY marking delivered MUST be the same
    //    carrier company that accepted the load (a sub-account counts as its
    //    company). ─────────────────────────────────────────────────────────────
    const haulerCheck = antiFraudGuard.verifyHaulerMatchesAcceptor(load, req.user.companyOwnerId || req.user.userId);
    if (!haulerCheck.ok) {
      return res.status(403).json({ error: haulerCheck.reason });
    }

    const photoBlock = (await pickupBlockers(load)) || (await deliveryBlockers(load));
    if (photoBlock) return res.status(409).json(photoBlock);

    // Atomic, audited transition via the state machine (in-transit/accepted → delivered)
    const result = await transitionLoadStatus(
      req.params.id,
      load.status,
      'delivered',
      { deliveredAt: new Date() },
      req.user.userId,
      'Delivered by carrier'
    );
    if (!result.success) {
      return res.status(409).json({ error: result.error });
    }
    const deliveredLoad = result.load;

    res.json({ message: "Load marked as delivered successfully", load: deliveredLoad });

    // Notify shipper + carrier rooms in real time
    try {
      const payload = {
        loadId: deliveredLoad._id,
        status: deliveredLoad.status,
        acceptedBy: deliveredLoad.acceptedBy?._id || deliveredLoad.acceptedBy,
      };
      io.to(`user_${deliveredLoad.postedBy?._id || deliveredLoad.postedBy}`).emit("loadStatusUpdated", payload);
      io.to(`user_${deliveredLoad.acceptedBy?._id || deliveredLoad.acceptedBy}`).emit("loadStatusUpdated", payload);
    } catch (_) {}

    // Refresh the BOL with delivery data/signature (non-blocking). The /status
    // path already does this; the /deliver path previously did not.
    autoGenerateBOL(deliveredLoad._id);
  } catch (err) {
    console.error("Error marking load as delivered:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /api/loads/:id/status - Update load status (accepted, in-transit, delivered)
router.put("/:id/status", auth, async (req, res) => {
  try {
    const { status } = req.body;

    if (!["accepted", "in-transit", "delivered"].includes(status)) {
      return res.status(400).json({ error: "Invalid status provided." });
    }

    // Pre-fetch load for auth check
    const existingLoad = await Load.findById(req.params.id);
    if (!existingLoad) {
      return res.status(404).json({ error: "Load not found." });
    }

    if (req.user.role !== "carrier" || String(existingLoad.acceptedBy) !== (req.user.companyOwnerId || req.user.userId)) {
      return res.status(403).json({ error: "Unauthorized action." });
    }

    // Pickup handshake: when the shipper required it, the carrier cannot start the
    // trip until the dock/shipper has verified the driver's code.
    if (status === 'in-transit' && existingLoad.pickupVerification?.required && !existingLoad.pickupVerification.verifiedAt) {
      return res.status(409).json({
        error: 'Pickup verification required: the dock or shipper must verify your pickup code before this load can be marked picked up.',
        reason: 'pickup_verification_required',
      });
    }

    // Photo evidence the shipper required (pickup photos before pickup/delivery, delivery photos before delivery).
    const photoBlock = status === 'in-transit' ? await pickupBlockers(existingLoad)
      : status === 'delivered' ? (await pickupBlockers(existingLoad)) || (await deliveryBlockers(existingLoad)) : null;
    if (photoBlock) return res.status(409).json(photoBlock);

    // On delivery, also stamp deliveredAt (so the timestamp + downstream docs are recorded)
    const updateFields = status === 'delivered' ? { deliveredAt: new Date() } : {};
    const result = await transitionLoadStatus(req.params.id, existingLoad.status, status, updateFields, req.user.userId, `Status updated by carrier`);
    if (!result.success) {
      return res.status(409).json({ error: result.error });
    }
    const load = result.load;

    // Auto-generate Bill of Lading on delivery (non-blocking)
    if (status === 'delivered') {
      autoGenerateBOL(load._id);
    }

    // Emit only to the shipper and carrier involved — not all connected users
    // (the load's parties are populated: use their ids for the room names and payload)
    const statusPayload = { loadId: load._id, status: load.status, acceptedBy: load.acceptedBy?._id || load.acceptedBy };
    io.to(`user_${load.postedBy?._id || load.postedBy}`).emit("loadStatusUpdated", statusPayload);
    io.to(`user_${load.acceptedBy?._id || load.acceptedBy}`).emit("loadStatusUpdated", statusPayload);

    res.json({ message: `Load status updated to ${status}.`, load });
  } catch (err) {
    console.error("Error updating load status:", err);
    res.status(500).json({ error: "Internal Server Error." });
  }
});

// Recommended Loads Route
router.get('/recommended/:loadId', auth, async (req, res) => {
  try {
    const currentLoad = await Load.findById(req.params.loadId);
    if (!currentLoad) {
      return res.status(404).json({ error: "Load not found." });
    }

    // Find recommended loads based on destination and timing
    const recommendedLoads = await Load.find({
      origin: currentLoad.destination,
      status: "open",
      _id: { $ne: currentLoad._id },
      ...(req.user.role === "carrier"
        ? { $and: [{ $or: await carrierOpenVisibleConditions(req.user.companyOwnerId || req.user.userId) }] }
        : req.user.role === "admin" ? {} : { postedBy: req.user.companyOwnerId || req.user.userId }),
    }).limit(5);

    res.json(recommendedLoads);
  } catch (err) {
    console.error("Error fetching recommended loads:", err);
    res.status(500).json({ error: "Server error fetching recommendations." });
  }
});

const { MIN_EDIT_LEAD_MS, PROPOSAL_TTL_MS, FALLBACK_WINDOW_MS } = require('../services/pickupRiskService').CONSTANTS;

// Window bounds must be strict ISO-8601 date-times WITH a zone (no "2026-13-45", "tomorrow" or zone-less local times);
// the handlers persist the parsed Date, never the raw string that was validated.
const isoWindowDate = (f) => body(f).isISO8601({ strict: true, strictSeparator: true }).matches(/T.*(Z|[+-]\d{2}(:?\d{2})?)$/i)
  .withMessage(`${f} must be an ISO-8601 date-time with a timezone, e.g. 2026-06-01T14:00:00Z`);

// Null-safe epoch ms for a window bound: null/undefined/''/invalid -> NaN. `new Date(null).getTime()` is 0, which
// would pass Number.isFinite and make "not earlier than the existing bound" trivially true against a missing bound.
const boundMs = (d) => { const t = d == null || d === '' ? NaN : new Date(d).getTime(); return Number.isFinite(t) ? t : NaN; };
// The state a window edit was validated against: the write only lands if the load is still exactly that
// (a pickup, cancel or re-booking in between must not let an edit through).
const loadStateGuard = (load) => ({ _id: load._id, status: load.status, acceptedBy: load.acceptedBy || null, bookedAt: load.bookedAt || null });
const WINDOW_CHANGED = { error: 'The load changed — reload and try again' };

// Only the load's shipper company or an admin may change its time windows —
// windows feed detention billing and on-time scorecards, so this must be locked down.
function assertWindowEditor(load, req) {
  if (req.user.role === 'admin') return true;
  return load.postedBy?.toString() === (req.user.companyOwnerId || req.user.userId);
}

// PUT /api/loads/:id/pickup-window  { start, end }
// Shipper company or admin. On a BOOKED load (status accepted) the carrier is judged against the window both
// parties agreed (bookedWindow), so: a more demanding change (earlier start or earlier end) is only PROPOSED
// (pickupWindowChange, status pending) until the booked carrier accepts it; a lenient change (start and end both
// not earlier) applies immediately and becomes the new agreed window; re-sending the agreed window withdraws a
// pending proposal. Loads that are not booked-and-awaiting-pickup keep the old direct-edit behaviour.
router.put('/:id/pickup-window', auth, isoWindowDate('start'), isoWindowDate('end'), validate, async (req, res) => {
  try {
    const ns = boundMs(req.body.start), ne = boundMs(req.body.end);
    if (ne < ns) return res.status(400).json({ error: 'end must not be before start' });

    const load = await Load.findById(req.params.id);
    if (!load) return res.status(404).json({ error: 'Load not found' });
    if (!assertWindowEditor(load, req)) return res.status(403).json({ error: 'Forbidden' });

    // Once the truck is on its way (or the load is over) the pickup window is a record that on-time stats,
    // detention and disputes are judged on: it is immutable.
    if (!['open', 'accepted'].includes(load.status)) return res.status(409).json({ error: 'The pickup window cannot be changed once the load is picked up, delivered or closed' });

    const oldW = load.pickupTimeWindow || {};
    const booked = load.status === 'accepted' && load.acceptedBy;
    const agreed = booked && load.bookedWindow && load.bookedWindow.start ? load.bookedWindow : oldW; // legacy bookings: current window
    const as = boundMs(agreed.start), aeRaw = boundMs(agreed.end);
    // Latest agreed arrival exactly as the risk evaluator computes it: window end, else start + fallback.
    const ae = Number.isFinite(aeRaw) && aeRaw >= as ? aeRaw : as + FALLBACK_WINDOW_MS;
    const moved = ns !== as || ne !== aeRaw;

    if (booked) {
      const nowMs = Date.now();
      // A pending proposal that nobody answered within the TTL lapses.
      // Past the agreed latest arrival a verdict (no-show / release) may already exist: no edit may rewrite it.
      if (nowMs > ae) return res.status(409).json({ error: 'The pickup deadline has already passed — release or cancel instead' });
      if (moved && ns < nowMs + MIN_EDIT_LEAD_MS) return res.status(400).json({ error: 'The new pickup window must start at least 2 hours from now' });
    }

    // Fail closed: lenient (no consent needed) only when every agreed bound is known and the new window is not earlier.
    const lenient = Number.isFinite(as) && Number.isFinite(ae) && ns >= as && ne >= ae;
    if (booked && moved && !lenient) {
      const w = await Load.updateOne(loadStateGuard(load), { $set: { pickupWindowChange: { proposedStart: new Date(ns), proposedEnd: new Date(ne), proposedAt: new Date(), proposedBy: req.user.userId, status: 'pending' } } });
      if (!w.matchedCount) return res.status(409).json(WINDOW_CHANGED);
      await notifyUserSafe(load.acceptedBy, {
        type: 'pickup:window_change_proposed',
        title: 'Shipper proposed an earlier pickup time',
        body: `The shipper proposed a new pickup time for "${load.title}". Open the load to see it. It only applies if you accept it; until then you are held to the agreed window.`,
        link: '/dashboard/carrier/my-loads',
        metadata: { loadId: String(load._id) },
      });
      const proposed = await Load.findById(load._id);
      return res.json({ ...proposed.toObject(), windowChangeProposed: true, message: 'Proposed. The agreed pickup window stays in force until the carrier accepts.' });
    }

    const set = { 'pickupTimeWindow.start': new Date(ns), 'pickupTimeWindow.end': new Date(ne) };
    const upd = { $set: set };
    if (booked) {
      set.bookedWindow = { start: new Date(ns), end: new Date(ne) };
      upd.$unset = { pickupWindowChange: 1 }; // a lenient change (or re-sending the agreed window) supersedes/withdraws a pending proposal
    }
    // New pickup time on a booked load = a new risk question. Alerts already sent and an "on my way"
    // given for the OLD time must not suppress the new time, so the whole risk state is cleared (the
    // monitor re-evaluates on its next run and announces afresh).
    const rebook = moved && booked;
    if (rebook) upd.$unset.pickupRisk = 1;
    const w = await Load.updateOne(loadStateGuard(load), upd);
    if (!w.matchedCount) return res.status(409).json(WINDOW_CHANGED);

    if (rebook) {
      await notifyUserSafe(load.acceptedBy, {
        type: 'pickup:window_changed',
        title: 'Pickup time changed',
        body: `The shipper changed the pickup time for "${load.title}". Open the load to see the new time. Please check you can make it.`,
        link: '/dashboard/carrier/my-loads',
        metadata: { loadId: String(load._id) },
      });
    }

    res.json(await Load.findById(load._id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error updating window' });
  }
});

// PUT /api/loads/:id/delivery-window   { start, end }
router.put('/:id/delivery-window', auth, isoWindowDate('start'), isoWindowDate('end'), validate, async (req, res) => {
  try {
    const ns = boundMs(req.body.start), ne = boundMs(req.body.end);
    if (ne < ns) return res.status(400).json({ error: 'end must not be before start' });

    const load = await Load.findById(req.params.id);
    if (!load) return res.status(404).json({ error: 'Load not found' });
    if (!assertWindowEditor(load, req)) return res.status(403).json({ error: 'Forbidden' });

    // Once a carrier holds the load, the delivery window is the standard its on-time stats, delay alerts and
    // trust score are judged on: it cannot be tightened (earlier start or end) or edited after delivery.
    if (load.acceptedBy) {
      const o = load.deliveryTimeWindow || {};
      const os = boundMs(o.start), oe = boundMs(o.end);
      const closed = ['delivered', 'disputed', 'resolved', 'cancelled'].includes(load.status);
      // Fail closed: a comparison against a missing bound is false, so "not earlier" cannot be shown without both.
      if (!Number.isFinite(os) || !Number.isFinite(oe)) {
        return res.status(409).json({ error: 'This booked load has no complete delivery window on file, so a delivery deadline cannot be set after booking without the carrier. Delivery windows have no propose/accept flow yet: ask support, or cancel and re-post.' });
      }
      if (closed || ns < os || ne < oe) {
        return res.status(409).json({ error: 'The delivery window of a booked load cannot be made earlier, or changed after delivery. It may only be extended.' });
      }
    }

    const w = await Load.updateOne(loadStateGuard(load), { $set: { 'deliveryTimeWindow.start': new Date(ns), 'deliveryTimeWindow.end': new Date(ne) } });
    if (!w.matchedCount) return res.status(409).json(WINDOW_CHANGED);

    res.json(await Load.findById(load._id));
  } catch (err) {
    console.error('Error updating delivery window:', err);
    res.status(500).json({ error: 'Server error updating window' });
  }
});

// PUT /api/loads/:id/assign-to-truck — DEPRECATED.
// This route set an invalid "assigned" status (always 500'd) and skipped the booking
// gate. Truck assignment now goes through the gated PUT /api/users/fleet/:truckId/assign-load.
router.put("/:id/assign-to-truck", auth, async (req, res) => {
  return res.status(410).json({
    error: 'Deprecated. Use PUT /api/users/fleet/:truckId/assign-load to assign a load to a truck.',
  });
});



// ── Multi-Stop Endpoints ────────────────────────────────────────────────────

// GET /api/loads/:id/stops
router.get('/:id/stops', auth, async (req, res) => {
  try {
    const load = await Load.findById(req.params.id).select('stops origin destination status postedBy acceptedBy loadVisibility');
    if (!load) return res.status(404).json({ error: 'Load not found' });
    // Stops carry facility contact details — gate the same way as the load itself.
    const denied = await browseDenial(load, req);
    if (denied) return res.status(denied.status).json({ error: denied.error });
    res.json({ stops: load.stops || [], origin: load.origin, destination: load.destination });
  } catch (err) {
    res.status(500).json({ error: 'Server error fetching stops' });
  }
});

// PUT /api/loads/:id/stops — shipper replaces stops array (only allowed before accepted)
router.put('/:id/stops', auth, async (req, res) => {
  try {
    if (req.user.role !== 'shipper') {
      return res.status(403).json({ error: 'Only shippers can update stops' });
    }
    const load = await Load.findById(req.params.id);
    if (!load) return res.status(404).json({ error: 'Load not found' });
    if (String(load.postedBy) !== (req.user.companyOwnerId || req.user.userId)) {
      return res.status(403).json({ error: 'Not your load' });
    }
    if (load.status !== 'open') {
      return res.status(400).json({ error: 'Stops can only be edited while the load is open' });
    }

    const { stops } = req.body;
    if (!Array.isArray(stops)) return res.status(400).json({ error: 'stops must be an array' });

    // Geocode any stops missing coordinates
    const fetch = require('node-fetch');
    const fetchCoords = async (addr) => {
      try {
        const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}`);
        const data = await resp.json();
        if (data.length) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      } catch (_) {}
      return { lat: null, lng: null };
    };

    const enriched = await Promise.all(stops.map(async (s, i) => {
      const coords = (s.lat && s.lng) ? { lat: s.lat, lng: s.lng } : await fetchCoords(s.address);
      return {
        sequence: s.sequence ?? i + 1,
        type: s.type,
        address: s.address,
        lat: coords.lat,
        lng: coords.lng,
        timeWindow: s.timeWindow || {},
        contactName: s.contactName || undefined,
        contactPhone: s.contactPhone || undefined,
        notes: s.notes || undefined,
        status: 'pending',
      };
    }));

    load.stops = enriched;
    // Stored O->D road miles would silently exclude stops.
    if (enriched.length) { load.distanceMiles = null; load.distanceSource = null; }
    else Object.assign(load, await loadDistanceFields(load));
    await load.save();
    res.json({ stops: load.stops });
  } catch (err) {
    console.error('Error updating stops:', err);
    res.status(500).json({ error: 'Server error updating stops' });
  }
});

// PUT /api/loads/:id/stops/:stopIndex/status — carrier updates a stop status
router.put('/:id/stops/:stopIndex/status', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') {
      return res.status(403).json({ error: 'Only carriers can update stop status' });
    }
    const load = await Load.findById(req.params.id);
    if (!load) return res.status(404).json({ error: 'Load not found' });
    if (String(load.acceptedBy) !== (req.user.companyOwnerId || req.user.userId)) {
      return res.status(403).json({ error: 'Not your load' });
    }

    const idx = parseInt(req.params.stopIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= load.stops.length) {
      return res.status(400).json({ error: 'Invalid stop index' });
    }

    const { status } = req.body;
    const allowed = ['arrived', 'departed', 'skipped'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
    }

    const stop = load.stops[idx];
    stop.status = status;
    if (status === 'arrived') stop.arrivedAt = new Date();
    if (status === 'departed') stop.departedAt = new Date();
    load.markModified('stops');
    await load.save();

    // Emit real-time update
    try {
      io.to(`user_${load.postedBy}`).emit('stop:statusUpdated', {
        loadId: load._id,
        stopIndex: idx,
        status,
        address: stop.address,
      });
    } catch (_) {}

    res.json({ stop: load.stops[idx] });
  } catch (err) {
    console.error('Error updating stop status:', err);
    res.status(500).json({ error: 'Server error updating stop status' });
  }
});

// backend/routes/chatbot.js
router.post('/voice-command', auth, async (req, res) => {
  try {
    const command = typeof req.body?.command === 'string' ? req.body.command : '';
    if (!command) return res.status(400).json({ error: 'command is required' });

    if (command.toLowerCase().includes('recommend')) {
      return res.json({ message: 'Here are some recommended loads for you.' });
    }
    return res.json({ message: 'Command not recognized.' });
  } catch (err) {
    console.error('[voice-command] failed:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

  // ========================================================================
  //  LOAD CANCELLATION — Real trucking business logic
  //
  //  Who can cancel and when:
  //    - Shipper can cancel an OPEN load freely (no fee)
  //    - Shipper can cancel an ACCEPTED load → carrier gets TONU fee ($250 default)
  //    - Carrier can cancel an ACCEPTED load → trust score penalty, shipper notified
  //    - Nobody can cancel an IN-TRANSIT load (must file dispute instead)
  //
  //  Financial handling:
  //    - If escrow exists → auto-refund to shipper (minus TONU if applicable)
  //    - TONU fee is transferred to carrier if shipper cancels after acceptance
  //    - Trust score adjusted: carrier cancel = -5 points, shipper late cancel = warning
  // ========================================================================

  router.put('/:id/cancel', auth, async (req, res) => {
    try {
      const load = await Load.findById(req.params.id);
      if (!load) return res.status(404).json({ error: 'Load not found' });

      const { reason } = req.body;
      const userId = req.user.userId;           // the acting person (audit)
      const companyId = req.user.companyOwnerId || userId; // the company (ownership)
      const role   = req.user.role;

      // ── Validate who can cancel (company-level) ───────────────────
      const isShipper = String(load.postedBy) === companyId;
      const isCarrier = String(load.acceptedBy) === companyId;

      if (!isShipper && !isCarrier) {
        return res.status(403).json({ error: 'Only the shipper or assigned carrier can cancel' });
      }

      // Cannot cancel in-transit or delivered loads — must dispute
      if (load.status === 'in-transit') {
        return res.status(409).json({
          error: 'Cannot cancel an in-transit load. File a dispute instead.',
          suggestion: 'POST /api/exceptions with type: "dispute"',
        });
      }
      if (load.status === 'delivered') {
        return res.status(409).json({ error: 'Cannot cancel a delivered load' });
      }
      if (load.status === 'cancelled') {
        return res.status(409).json({ error: 'Load is already cancelled' });
      }

      // Use state machine for atomic transition
      const previousStatus = load.status;
      const result = await transitionLoadStatus(
        load._id,
        previousStatus,
        'cancelled',
        {
          cancelledBy: userId,
          cancelledByRole: role,
          cancelReason: reason || 'No reason provided',
          cancelledAt: new Date(),
        },
        userId,
        `Cancelled by ${role}: ${reason || 'no reason'}`
      );

      if (!result.success) {
        return res.status(409).json({ error: result.error });
      }

      const cancelledLoad = result.load;
      let tonuFeeCents = 0;
      let escrowRefunded = false;

      // Terminate dangling bids / appointments / trip references on the cancelled load.
      await cancelLoadCascade(load._id);

      // ── TONU logic: shipper cancels after carrier already accepted ──
      if (isShipper && previousStatus === 'accepted' && load.acceptedBy) {
        // Carrier was committed — they get TONU fee
        // Check contract for custom TONU rate, otherwise default $250
        let tonuRate = 25000; // $250 in cents
        if (load.contractId) {
          try {
            const Contract = require('../models/Contract');
            const contract = await Contract.findById(load.contractId)
              .select('pricing.accessorialRates.tonuCents');
            if (contract?.pricing?.accessorialRates?.tonuCents) {
              tonuRate = contract.pricing.accessorialRates.tonuCents;
            }
          } catch { /* use default */ }
        }
        tonuFeeCents = tonuRate;

        // Notify carrier about cancellation + TONU
        const { notifyUserSafe } = require('../utils/notifyUser');
        notifyUserSafe(load.acceptedBy, {
          type: 'load_cancelled',
          title: 'Load Cancelled — TONU Fee Owed',
          body: `Shipper cancelled "${load.title}" after you accepted. TONU fee: $${(tonuRate / 100).toFixed(2)} owed to you.`,
          link: '/dashboard/carrier/my-loads',
          metadata: { loadId: load._id, tonuFeeCents: tonuRate },
        });

        // Notify shipper about TONU charge
        notifyUserSafe(load.postedBy, {
          type: 'tonu_charged',
          title: 'TONU Fee Applied',
          body: `You cancelled "${load.title}" after carrier acceptance. TONU fee: $${(tonuRate / 100).toFixed(2)}.`,
          link: '/dashboard/shipper/loads',
          metadata: { loadId: load._id, tonuFeeCents: tonuRate },
        });
      }

      // ── Carrier cancels accepted load → trust penalty ──────────────
      if (isCarrier && previousStatus === 'accepted') {
        const { adjustScore } = require('../services/trustScoreService');
        adjustScore(load.acceptedBy, 'carrier_cancelled_load', -5, load._id).catch(() => {}); // the carrier COMPANY, not the acting dispatcher/driver (userId stays in the audit trail)

        escrowRefunded = await reopenAfterCarrierDrop(load, userId, 'Reopened after carrier cancellation', reason);

        const { notifyUserSafe } = require('../utils/notifyUser');
        notifyUserSafe(load.postedBy, {
          type: 'carrier_cancelled',
          title: 'Carrier Dropped Your Load',
          body: `The carrier cancelled "${load.title}". Reason: ${reason || 'none given'}. Your load has been re-posted.`,
          link: '/dashboard/shipper/loads',
          metadata: { loadId: load._id },
        });

        // Same standby re-check + notify + marker clearing as a shipper release.
        const standbyNotified = await require('../services/standbyService').notifyStandby(load);

        return res.json({
          message: 'Load cancelled. Your trust score has been adjusted (-5 points). Load re-posted for shipper.',
          loadStatus: 'open', // re-opened for shipper
          trustScorePenalty: -5,
          escrowRefunded,
          standbyNotified,
        });
      }

      // ── Shipper cancels open load (free, no penalty) ───────────────
      if (isShipper && previousStatus === 'open') {
        return res.json({
          message: 'Load cancelled successfully. No fees apply.',
          loadStatus: 'cancelled',
          tonuFeeCents: 0,
        });
      }

      // ── Default response (shipper cancelled accepted load) ─────────
      // Release the escrow hold (uncaptured authorization). TONU, when owed, is a
      // separate accessorial and is not netted here.
      try {
        escrowRefunded = await releaseEscrowHold(load._id, reason);
      } catch { /* non-critical */ }

      res.json({
        message: `Load cancelled by ${role}.`,
        loadStatus: 'cancelled',
        previousStatus,
        tonuFeeCents,
        escrowRefunded,
        reason: reason || 'No reason provided',
      });

      // System message in chat thread
      try {
        const Message = require('../models/Message');
        const channelId = `load_${load._id}`;
        await Message.create({
          channelType: 'load_thread',
          channelId,
          sender: null,
          content: `⚠ Load cancelled by ${role}. Reason: ${reason || 'none given'}.${tonuFeeCents > 0 ? ` TONU fee: $${(tonuFeeCents / 100).toFixed(2)}.` : ''}`,
          messageType: 'system',
          readBy: [],
        });
      } catch { /* non-critical */ }

    } catch (err) {
      console.error('Error cancelling load:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ========================================================================
  //  PICKUP NO-SHOW PREDICTION — carrier response + shipper release
  //  Risk state is written by jobs/pickupRiskMonitor. Nothing here cancels or
  //  penalizes automatically: the carrier answers, the shipper decides, and a
  //  suspected no-show goes to an admin (ReviewQueue) — never to the trust score.
  // ========================================================================
  const RELEASE_LABEL = {
    no_show: 'predicted no-show (truck never arrived at pickup)',
    late_certain: 'predicted lateness (truck cannot reach pickup in time)',
    carrier_declined: 'the carrier saying it cannot make the pickup',
  };

  // POST /api/loads/:id/pickup-confirm  { status: 'on_my_way' | 'cannot_make_it' }  — booked carrier company only
  router.post('/:id/pickup-confirm', auth, param('id').isMongoId(), body('status').isIn(['on_my_way', 'cannot_make_it']), validate, async (req, res) => {
    try {
      if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Only the booked carrier can respond' });
      const load = await Load.findById(req.params.id).select('status acceptedBy postedBy title pickupRisk.carrierConfirmation');
      if (!load) return res.status(404).json({ error: 'Load not found' });
      if (String(load.acceptedBy) !== companyOf(req)) return res.status(403).json({ error: 'Only the booked carrier can respond' });
      if (load.status !== 'accepted') return res.status(409).json({ error: 'Pickup confirmation is only possible while the load is booked and awaiting pickup' });

      const { status } = req.body;
      const prev = load.pickupRisk?.carrierConfirmation?.status;
      const w = await Load.updateOne(
        { _id: load._id, status: 'accepted', acceptedBy: load.acceptedBy },
        { $set: { 'pickupRisk.carrierConfirmation': { status, at: new Date(), by: req.user.userId } } }
      );
      if (!w.matchedCount) return res.status(409).json({ error: 'Load is no longer booked to you' });
      StatusHistory.record('load', load._id, 'accepted', 'accepted', req.user.userId,
        status === 'on_my_way' ? 'Carrier confirmed: on the way to pickup' : 'Carrier said it cannot make the pickup',
        { event: 'pickup_confirmation', status }).catch(() => {});

      // Re-evaluate now; the carrier just answered, so never notify them about their own answer.
      const out = await refreshLoad(load._id, { carrier: true });
      if (status === 'cannot_make_it' && prev !== 'cannot_make_it' && !(out && out.notified)) {
        // The at-risk level was already announced earlier, so refreshLoad stayed quiet: tell the shipper explicitly.
        const full = await Load.findById(load._id).select('title origin pickupFacilityName pickupAddress pickupTimeWindow bookedWindow');
        const m = pickupRiskMessages(full, { level: 'at_risk', reason: 'carrier_declined', detail: {} });
        await notifyUserSafe(load.postedBy, { ...m.shipper, link: '/dashboard/shipper/loads', metadata: { loadId: String(load._id), level: 'at_risk', reason: 'carrier_declined' } });
      }
      const fresh = await Load.findById(load._id).select('pickupRisk').lean();
      res.json({ success: true, pickupRisk: fresh?.pickupRisk || null });
    } catch (err) {
      console.error('[pickup-confirm] failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // POST /api/loads/:id/pickup-window-response  { accept: boolean } — booked carrier company only (owner/dispatcher/driver)
  // Accepting makes the shipper's proposed window the new agreed window (and resets pickup risk state); declining
  // leaves the agreed window untouched. Both sides are notified.
  router.post('/:id/pickup-window-response', auth, param('id').isMongoId(), body('accept').isBoolean().toBoolean(), validate, async (req, res) => {
    try {
      if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Only the booked carrier can respond' });
      const load = await Load.findById(req.params.id).select('status acceptedBy postedBy title pickupWindowChange');
      if (!load) return res.status(404).json({ error: 'Load not found' });
      if (String(load.acceptedBy) !== companyOf(req)) return res.status(403).json({ error: 'Only the booked carrier can respond' });
      const ch = load.pickupWindowChange;
      if (load.status !== 'accepted' || ch?.status !== 'pending') return res.status(409).json({ error: 'There is no pending pickup time change for this load' });

      const accept = req.body.accept === true;
      const now = new Date();
      // Re-validate at acceptance: a stale proposal, or one whose start is now past / inside the lead time, expires.
      if (accept && (now.getTime() - new Date(ch.proposedAt).getTime() > PROPOSAL_TTL_MS || new Date(ch.proposedStart).getTime() < now.getTime() + MIN_EDIT_LEAD_MS)) {
        await Load.updateOne({ _id: load._id, 'pickupWindowChange.status': 'pending' }, { $set: { 'pickupWindowChange.status': 'expired', 'pickupWindowChange.respondedAt': now } });
        return res.status(409).json({ error: 'This proposal has expired. Ask the shipper to send a new pickup time.' });
      }
      const set = { 'pickupWindowChange.status': accept ? 'accepted' : 'declined', 'pickupWindowChange.respondedAt': now, 'pickupWindowChange.respondedBy': req.user.userId };
      const upd = { $set: set };
      if (accept) {
        set['pickupTimeWindow.start'] = ch.proposedStart; set['pickupTimeWindow.end'] = ch.proposedEnd;
        set.bookedWindow = { start: ch.proposedStart, end: ch.proposedEnd };
        upd.$unset = { pickupRisk: 1 }; // new agreed time = new risk question (monitor re-evaluates)
      }
      const w = await Load.updateOne({ _id: load._id, status: 'accepted', acceptedBy: load.acceptedBy, 'pickupWindowChange.status': 'pending',
        'pickupWindowChange.proposedStart': ch.proposedStart, 'pickupWindowChange.proposedEnd': ch.proposedEnd }, upd);
      if (!w.matchedCount) return res.status(409).json({ error: 'The proposal changed or the load is no longer booked to you' });
      StatusHistory.record('load', load._id, 'accepted', 'accepted', req.user.userId,
        accept ? 'Carrier accepted the proposed pickup time' : 'Carrier declined the proposed pickup time', { event: 'pickup_window_response', accept }).catch(() => {});
      await notifyUserSafe(load.postedBy, {
        type: accept ? 'pickup:window_change_accepted' : 'pickup:window_change_declined',
        title: accept ? 'Carrier accepted the new pickup time' : 'Carrier declined the new pickup time',
        body: accept ? `The carrier accepted the new pickup time for "${load.title}".` : `The carrier declined the proposed pickup time for "${load.title}". The originally agreed window still applies.`,
        link: '/dashboard/shipper/loads', metadata: { loadId: String(load._id) },
      });
      const fresh = await Load.findById(load._id).select('pickupTimeWindow bookedWindow pickupWindowChange').lean();
      res.json({ success: true, pickupTimeWindow: fresh.pickupTimeWindow, pickupWindowChange: fresh.pickupWindowChange });
    } catch (err) {
      console.error('[pickup-window-response] failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // GET /api/loads/:id/standby — how many standby carriers a release would notify (shipper company or admin)
  router.get('/:id/standby', auth, param('id').isMongoId(), validate, async (req, res) => {
    try {
      const load = await Load.findById(req.params.id);
      if (!load) return res.status(404).json({ error: 'Load not found' });
      if (req.user.role !== 'admin' && !(req.user.role === 'shipper' && String(load.postedBy) === companyOf(req))) return res.status(403).json({ error: 'Forbidden' });
      res.json({ count: (await require('../services/standbyService').currentStandby(load)).length });
    } catch (err) {
      console.error('[standby] count failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // POST /api/loads/:id/release-to-standby  { reason: 'no_show' | 'late_certain' | 'carrier_declined' }
  // Shipper company or admin. Re-evaluates first (the stored state can be minutes old), then reuses the
  // carrier-fault cancel path: transition -> cancelLoadCascade -> reopenAfterCarrierDrop.
  router.post('/:id/release-to-standby', auth, param('id').isMongoId(), body('reason').isIn(Object.keys(RELEASE_LABEL)), validate, async (req, res) => {
    try {
      if (!['shipper', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
      const base = await Load.findById(req.params.id).select('postedBy status');
      if (!base) return res.status(404).json({ error: 'Load not found' });
      if (req.user.role !== 'admin' && String(base.postedBy) !== companyOf(req)) return res.status(403).json({ error: 'Forbidden' });
      if (base.status !== 'accepted') return res.status(409).json({ error: 'Only a booked load awaiting pickup can be released' });

      await refreshLoad(base._id, { all: true }); // fresh truth: an arrival since the last run must cancel the release
      const load = await Load.findById(base._id);
      if (!load || load.status !== 'accepted' || !load.acceptedBy) return res.status(409).json({ error: 'Load is no longer awaiting pickup' });
      const { reason } = req.body;
      if (reason !== 'carrier_declined' && load.pickupWindowChange?.status === 'pending') {
        return res.status(409).json({ error: 'A pickup time change you proposed is waiting for the carrier. Until it is accepted the carrier is judged on the agreed window; withdraw the proposal (re-send the agreed window) to release on it.' });
      }
      const level = load.pickupRisk?.level;
      const allowed = reason === 'carrier_declined' ? load.pickupRisk?.carrierConfirmation?.status === 'cannot_make_it' : level === reason;
      if (!allowed) return res.status(409).json({ error: 'Release is not allowed: the pickup risk does not support this reason right now', level: level || null });

      const carrierId = load.acceptedBy;
      // Snapshot BEFORE the release: un-booking clears the location, window and booking the evidence is read from.
      const snapshot = reason === 'no_show' ? await noShowSnapshot(load._id, { releasedByRole: req.user.role }) : null;
      const lateMin = load.pickupRisk?.detail?.minutesLateEstimate;
      const label = reason === 'late_certain' && lateMin ? `${RELEASE_LABEL[reason]}, est. ${lateMin} min late` : RELEASE_LABEL[reason];
      const userId = req.user.userId;

      const t = await transitionLoadStatus(load._id, 'accepted', 'cancelled',
        { cancelledBy: userId, cancelledByRole: req.user.role, cancelReason: `released_to_standby:${reason}`, cancelledAt: new Date() },
        userId, `Released by ${req.user.role} after ${label}`);
      if (!t.success) return res.status(409).json({ error: t.error });
      await cancelLoadCascade(load._id);
      const escrowRefunded = await reopenAfterCarrierDrop(load, userId, `Released to standby carriers by ${req.user.role} after ${label}`, `released_to_standby:${reason}`);

      // No automatic trust score change, whatever the reason: a person decides. A suspected no-show is filed for
      // admin review with the evidence summary (times and distances only, never coordinates).
      let reviewFiled = false;
      if (snapshot) {
        try { await fileNoShowReview(snapshot, carrierId); reviewFiled = true; } catch (e) { console.error('[release-to-standby] review item failed:', e.message); }
      }
      const CONTEST = `To respond or contest this, email support@freightconnect.com (or use the Contact page) and quote load ${load._id}. Disputes cannot be filed on a load that is open again.`;
      await notifyUserSafe(carrierId, {
        type: 'pickup:released',
        title: 'Load released by the shipper',
        body: `The shipper released "${load.title}" after ${label}. No automatic change was made to your trust score.`
          + (reviewFiled ? ' Because the shipper reported a suspected no-show, this case may be reviewed by FreightConnect staff.' : '')
          + ` ${CONTEST}`,
        link: '/dashboard/carrier/my-loads',
        metadata: { loadId: String(load._id), reason },
      });
      try {
        await require('../models/Message').create({ channelType: 'load_thread', channelId: `load_${load._id}`, sender: null, messageType: 'system', readBy: [],
          content: `Load released to standby carriers by the shipper after ${label}.` });
      } catch { /* non-critical */ }
      const standbyNotified = await require('../services/standbyService').notifyStandby(load);

      res.json({ message: 'Load released and re-posted.', loadStatus: 'open', reason, standbyNotified, reviewFiled, escrowRefunded });
    } catch (err) {
      console.error('[release-to-standby] failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ========================================================================
  //  DISPUTE FLOW — When things go wrong during/after transit
  //
  //  Real-world scenarios:
  //    - Cargo damaged during transit → carrier liable
  //    - Shipper claims short delivery → weigh/count dispute
  //    - Carrier claims incorrect freight description → overweight, hazmat undisclosed
  //    - Payment dispute → shipper won't release escrow
  //
  //  Flow:
  //    1. Either party files dispute → load status = 'disputed', escrow frozen
  //    2. Both parties can add evidence (notes, photos via exceptions)
  //    3. Admin reviews and resolves:
  //       - "carrier_fault" → escrow refunded to shipper (full or partial)
  //       - "shipper_fault" → escrow released to carrier
  //       - "split" → partial refund + partial release
  //       - "dismissed" → escrow released to carrier (no fault found)
  // ========================================================================

  router.put('/:id/dispute', auth, async (req, res) => {
    try {
      const load = await Load.findById(req.params.id);
      if (!load) return res.status(404).json({ error: 'Load not found' });

      const userId = req.user.userId;
      const role   = req.user.role;
      const { reason, type, claimAmountCents, evidence, evidenceUrls } = req.body;

      // Only shipper or carrier on this load can dispute
      const isShipper = String(load.postedBy) === userId;
      const isCarrier = String(load.acceptedBy) === userId;
      if (!isShipper && !isCarrier && role !== 'admin') {
        return res.status(403).json({ error: 'Only parties on this load can file a dispute' });
      }

      // Can only dispute in-transit or delivered loads
      if (!['in-transit', 'delivered'].includes(load.status)) {
        return res.status(409).json({
          error: `Cannot dispute a load in "${load.status}" status. Use cancel for open/accepted loads.`,
        });
      }

      if (!reason) {
        return res.status(400).json({ error: 'Dispute reason is required' });
      }

      // Transition to disputed
      const result = await transitionLoadStatus(
        load._id,
        load.status,
        'disputed',
        {
          disputedBy: userId,
          disputedByRole: role,
          disputeReason: reason,
          disputeType: type || 'general',
          disputeClaimCents: claimAmountCents || 0,
          disputeFiledAt: new Date(),
        },
        userId,
        `Dispute filed by ${role}: ${reason}`
      );

      if (!result.success) {
        return res.status(409).json({ error: result.error });
      }

      // Create an Exception record for admin tracking. Field names + enums must
      // match the Exception model exactly (loadId, filedByRole, title, note
      // shape {content,author}, and a valid `type`) — otherwise this silently
      // failed and disputes never showed up in the admin Exceptions queue.
      let exceptionId = null;
      try {
        const Exception = require('../models/Exception');
        const EX_TYPE = { cargo_damage: 'cargo_damage', overcharge: 'overcharge' };
        const exRole = role === 'admin' ? 'system' : role; // enum: carrier|shipper|system
        const createdException = await Exception.create({
          loadId: load._id,
          filedBy: userId,
          filedByRole: exRole,
          type: EX_TYPE[type] || 'dispute',
          severity: claimAmountCents > 100000 ? 'critical' : claimAmountCents > 25000 ? 'high' : 'medium',
          title: `Dispute: ${type || 'general'}`,
          description: reason,
          claimAmount: claimAmountCents ? claimAmountCents / 100 : undefined,
          // Only accept internal evidence paths (from our upload endpoint).
          // Reject javascript:/data:/external URLs — stored-XSS / phishing vector.
          evidenceUrls: Array.isArray(evidenceUrls)
            ? evidenceUrls.filter((u) => typeof u === 'string' && /^\/documents\/[A-Za-z0-9._/-]+$/.test(u)).slice(0, 20)
            : [],
          status: 'open',
          notes: evidence ? [{ content: evidence, author: userId, authorRole: exRole, createdAt: new Date() }] : [],
        });
        exceptionId = createdException._id;
      } catch (exErr) {
        console.error('Failed to create exception for dispute (non-fatal):', exErr);
      }

      // Freeze escrow — mark payment as disputed
      try {
        const Payment = require('../models/Payment');
        const payment = await Payment.findOne({ loadId: load._id, status: { $in: ['in_escrow', 'released'] } });
        if (payment) {
          payment.status = 'pending'; // revert to pending = frozen
          await payment.save();
        }
      } catch { /* non-critical */ }

      // Notify the other party
      const { notifyUserSafe } = require('../utils/notifyUser');
      const otherParty = isShipper ? load.acceptedBy : load.postedBy;
      if (otherParty) {
        notifyUserSafe(otherParty, {
          type: 'dispute_filed',
          title: 'Dispute Filed on Your Load',
          body: `A ${type || 'general'} dispute has been filed on "${load.title}": ${reason}${claimAmountCents ? ` — Claim: $${(claimAmountCents / 100).toFixed(2)}` : ''}`,
          link: role === 'shipper' ? '/dashboard/carrier/my-loads' : '/dashboard/shipper/loads',
          metadata: { loadId: load._id },
        });
      }

      // System message in chat
      try {
        const Message = require('../models/Message');
        await Message.create({
          channelType: 'load_thread',
          channelId: `load_${load._id}`,
          sender: null,
          content: `⚠ Dispute filed by ${role}: "${reason}". Escrow is frozen until resolution.${claimAmountCents ? ` Claim: $${(claimAmountCents / 100).toFixed(2)}.` : ''}`,
          messageType: 'system',
          readBy: [],
        });
      } catch { /* non-critical */ }

      res.json({
        message: 'Dispute filed successfully. Escrow has been frozen pending resolution.',
        loadStatus: 'disputed',
        disputeType: type || 'general',
        claimAmountCents: claimAmountCents || 0,
        // Lets the client attach evidence files (POST /exceptions/:id/evidence)
        exceptionId,
      });
    } catch (err) {
      console.error('Error filing dispute:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ── PUT /:id/resolve — Admin resolves a dispute ───────────────────────────
  router.put('/:id/resolve', auth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
      }

      const load = await Load.findById(req.params.id);
      if (!load) return res.status(404).json({ error: 'Load not found' });
      if (load.status !== 'disputed') {
        return res.status(409).json({ error: 'Load is not in disputed status' });
      }

      const { resolution, notes, carrierPayoutPercent } = req.body;
      // resolution: 'carrier_fault', 'shipper_fault', 'split', 'dismissed'
      if (!['carrier_fault', 'shipper_fault', 'split', 'dismissed'].includes(resolution)) {
        return res.status(400).json({ error: 'resolution must be: carrier_fault, shipper_fault, split, or dismissed' });
      }

      // Resolve the load status
      const result = await transitionLoadStatus(
        load._id,
        'disputed',
        'resolved',
        {
          disputeResolution: resolution,
          disputeResolvedAt: new Date(),
          disputeResolvedBy: req.user.userId,
          disputeNotes: notes || '',
          disputeCarrierPayoutPercent: carrierPayoutPercent ?? (resolution === 'shipper_fault' || resolution === 'dismissed' ? 100 : resolution === 'carrier_fault' ? 0 : 50),
        },
        req.user.userId,
        `Dispute resolved: ${resolution}`
      );

      if (!result.success) {
        return res.status(409).json({ error: result.error });
      }

      // Handle escrow based on resolution
      const payoutPercent = carrierPayoutPercent ?? (resolution === 'shipper_fault' || resolution === 'dismissed' ? 100 : resolution === 'carrier_fault' ? 0 : 50);

      // Trust score adjustments
      const { adjustScore } = require('../services/trustScoreService');
      if (resolution === 'carrier_fault') {
        adjustScore(load.acceptedBy, 'dispute_carrier_fault', -10).catch(() => {});
      } else if (resolution === 'shipper_fault') {
        adjustScore(load.postedBy, 'dispute_shipper_fault', -5).catch(() => {});
      }
      // Dismissed = no penalty, resolved cleanly
      if (resolution === 'dismissed') {
        adjustScore(load.acceptedBy, 'dispute_dismissed_cleared', 2).catch(() => {});
      }

      // Execute the escrow money movement per the payout split. DORMANT until
      // Stripe is configured AND the load has a funded escrow — otherwise a
      // no-op (the decision + payout% are still recorded above).
      try {
        const escrowService = require('../services/escrowService');
        const settle = await escrowService.settleDisputeResolution(load._id, payoutPercent);
        if (settle && settle.ok === false && !['stripe_unavailable', 'no_escrow'].includes(settle.code)) {
          console.warn('[resolve] escrow settlement:', settle.code, settle.error);
        }
      } catch (e) {
        console.error('[resolve] escrow settlement failed (non-fatal):', e.message);
      }

      // Notify both parties
      const { notifyUserSafe } = require('../utils/notifyUser');
      const resolutionLabel = {
        carrier_fault: 'Carrier at fault — escrow refunded to shipper',
        shipper_fault: 'Shipper at fault — escrow released to carrier',
        split: `Split decision — carrier receives ${payoutPercent}%`,
        dismissed: 'Dispute dismissed — escrow released to carrier',
      };

      [load.postedBy, load.acceptedBy].filter(Boolean).forEach(uid => {
        notifyUserSafe(uid, {
          type: 'dispute_resolved',
          title: 'Dispute Resolved',
          body: `"${load.title}": ${resolutionLabel[resolution]}. ${notes || ''}`,
          link: String(uid) === String(load.postedBy) ? '/dashboard/shipper/loads' : '/dashboard/carrier/my-loads',
          metadata: { loadId: load._id, resolution, payoutPercent },
        });
      });

      res.json({
        message: `Dispute resolved: ${resolution}`,
        resolution,
        carrierPayoutPercent: payoutPercent,
        trustScoreAdjustment: resolution === 'carrier_fault' ? -10 : resolution === 'shipper_fault' ? -5 : resolution === 'dismissed' ? 2 : 0,
      });
    } catch (err) {
      console.error('Error resolving dispute:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ========================================================================
  //  DRIVER ASSIGNMENT — Carrier assigns a fleet driver to an accepted load
  //  Re-checks endorsement eligibility at the driver level (hazmat, etc.)
  // ========================================================================
  router.put('/:id/assign-driver', auth, async (req, res) => {
    try {
      const { driverId } = req.body;
      if (!driverId) return res.status(400).json({ error: 'driverId is required' });

      const load = await Load.findById(req.params.id);
      if (!load) return res.status(404).json({ error: 'Load not found' });

      // Must be the carrier company that accepted this load
      const companyId = req.user.companyOwnerId || req.user.userId;
      if (String(load.acceptedBy) !== companyId) {
        return res.status(403).json({ error: 'Only the carrier who accepted this load can assign a driver' });
      }

      // The driver roster lives on the company owner account.
      const carrier = await User.findById(companyId).select('drivers carrierEndorsements');
      if (!carrier) return res.status(404).json({ error: 'Carrier not found' });

      const driver = (carrier.drivers || []).find(d => d.driverId === driverId);
      if (!driver) return res.status(404).json({ error: 'Driver not found in your roster' });
      if (driver.status !== 'active') {
        return res.status(409).json({ error: `Driver is not active (status: ${driver.status})` });
      }

      // Re-run eligibility with the specific driver's endorsements
      const eligibility = checkLoadEligibility({ load, carrier, driver });
      if (!eligibility.eligible) {
        return res.status(403).json({
          error: 'Driver is not eligible for this load',
          reasons: eligibility.reasons,
        });
      }

      load.assignedDriverId = driver.driverId;
      load.assignedDriverName = driver.name;
      await load.save();

      try {
        io.to(`user_${load.postedBy}`).emit('load:driverAssigned', {
          loadId: load._id,
          driverId: driver.driverId,
          driverName: driver.name,
        });
      } catch (_) {}

      res.json({ message: 'Driver assigned', load });
    } catch (err) {
      console.error('Error assigning driver:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ========================================================================
  //  RECONSIGNMENT — Shipper (or admin) changes delivery destination mid-haul
  //  Allowed only while accepted or in-transit. Shipper-initiated fee is owed
  //  to the carrier and auto-approved.
  // ========================================================================
  router.put('/:id/reconsign', auth, async (req, res) => {
    try {
      const load = await Load.findById(req.params.id);
      if (!load) return res.status(404).json({ error: 'Load not found' });

      const isShipper = String(load.postedBy) === (req.user.companyOwnerId || req.user.userId);
      const isAdmin = req.user.role === 'admin';
      if (!isShipper && !isAdmin) {
        return res.status(403).json({ error: 'Only the shipper or an admin can reconsign a load' });
      }

      if (!['accepted', 'in-transit'].includes(load.status)) {
        return res.status(409).json({ error: `Cannot reconsign a load in "${load.status}" status` });
      }

      const { newDestination, newDestinationLat, newDestinationLng, reason, feeCents } = req.body;
      if (!newDestination) return res.status(400).json({ error: 'newDestination is required' });

      const fee = Number.isInteger(feeCents) && feeCents > 0 ? feeCents : 0;

      load.reconsignment = {
        changed: true,
        originalDestination: load.destination,
        newDestination,
        newDestinationLat: newDestinationLat ?? null,
        newDestinationLng: newDestinationLng ?? null,
        reason: reason || null,
        feeChargedCents: fee,
        changedAt: new Date(),
        changedBy: req.user.userId,
      };

      load.destination = newDestination;
      if (newDestinationLat != null) load.destinationLat = newDestinationLat;
      if (newDestinationLng != null) load.destinationLng = newDestinationLng;
      // Destination changed: recompute road miles (null if unknown) rather than keep a stale one.
      Object.assign(load, newDestinationLat != null && newDestinationLng != null
        ? await loadDistanceFields(load) : { distanceMiles: null, distanceSource: null });

      if (fee > 0) {
        load.accessorialCharges.push({
          type: 'reconsignment',
          description: `Reconsignment: ${reason || 'destination change'}`,
          amountCents: fee,
          status: 'approved',
          requestedBy: load.postedBy,
          approvedBy: load.postedBy,
          approvedAt: new Date(),
        });
      }

      await load.save();

      try {
        const payload = { loadId: load._id, newDestination, feeChargedCents: fee };
        if (load.acceptedBy) io.to(`user_${load.acceptedBy}`).emit('load:reconsigned', payload);
        io.to(`user_${load.postedBy}`).emit('load:reconsigned', payload);
      } catch (_) {}

      res.json({ message: 'Load reconsigned', load });
    } catch (err) {
      console.error('Error reconsigning load:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ========================================================================
  //  REDELIVERY — Receiver closed / missed appointment / refused
  //  Carrier, shipper, or admin can record. Fee (if any) needs shipper approval.
  // ========================================================================
  router.post('/:id/redeliver', auth, async (req, res) => {
    try {
      const load = await Load.findById(req.params.id);
      if (!load) return res.status(404).json({ error: 'Load not found' });

      const isShipper = String(load.postedBy) === (req.user.companyOwnerId || req.user.userId);
      const isCarrier = String(load.acceptedBy) === (req.user.companyOwnerId || req.user.userId);
      const isAdmin = req.user.role === 'admin';
      if (!isShipper && !isCarrier && !isAdmin) {
        return res.status(403).json({ error: 'Only the carrier, shipper, or an admin can record a redelivery' });
      }

      const { reason, rescheduledFor, feeCents } = req.body;
      const allowedReasons = ['receiver_closed', 'missed_appointment', 'refused'];
      if (!allowedReasons.includes(reason)) {
        return res.status(400).json({ error: `reason must be one of: ${allowedReasons.join(', ')}` });
      }

      const fee = Number.isInteger(feeCents) && feeCents > 0 ? feeCents : 0;
      const rescheduled = rescheduledFor ? new Date(rescheduledFor) : null;

      if (!load.redelivery) load.redelivery = {};
      load.redelivery.required = true;
      load.redelivery.reason = reason;
      load.redelivery.originalDeliveryAt = load.deliveredAt || null;
      load.redelivery.rescheduledFor = rescheduled;
      load.redelivery.feeChargedCents = (load.redelivery.feeChargedCents || 0) + fee;
      load.redelivery.count = (load.redelivery.count || 0) + 1;
      load.redelivery.history = load.redelivery.history || [];
      load.redelivery.history.push({ reason, at: new Date(), rescheduledFor: rescheduled });

      if (fee > 0) {
        load.accessorialCharges.push({
          type: 'redelivery',
          description: `Redelivery: ${reason}`,
          amountCents: fee,
          status: 'pending',
          requestedBy: req.user.userId,
        });
      }

      await load.save();

      try {
        const payload = { loadId: load._id, reason, rescheduledFor: rescheduled, feeChargedCents: fee };
        if (load.acceptedBy) io.to(`user_${load.acceptedBy}`).emit('load:redelivery', payload);
        io.to(`user_${load.postedBy}`).emit('load:redelivery', payload);
      } catch (_) {}

      res.json({ message: 'Redelivery recorded', load });
    } catch (err) {
      console.error('Error recording redelivery:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // ========================================================================
  //  ACCESSORIAL CHARGES — The settlement loop
  //  Carrier requests → shipper approves (settles payout) or rejects.
  // ========================================================================

  // POST /:id/accessorials — carrier requests an accessorial charge
  router.post('/:id/accessorials', auth, async (req, res) => {
    try {
      const load = await Load.findById(req.params.id);
      if (!load) return res.status(404).json({ error: 'Load not found' });

      const isCarrier = String(load.acceptedBy) === (req.user.companyOwnerId || req.user.userId);
      const isAdmin = req.user.role === 'admin';
      if (!isCarrier && !isAdmin) {
        return res.status(403).json({ error: 'Only the assigned carrier or an admin can request accessorials' });
      }

      const { type, description, amountCents, evidenceUrls } = req.body;

      // Detention charges are system-generated from verified dwell events and are
      // NEVER carrier-creatable — their amount is server-authoritative
      // (see services/detentionBillingService.js). Block manual creation.
      if (type === 'detention') {
        return res.status(403).json({ error: 'Detention charges are generated automatically from verified dwell events and cannot be created manually.' });
      }

      const allowedTypes = ['lumper', 'tonu', 'layover', 'other'];
      if (!allowedTypes.includes(type)) {
        return res.status(400).json({ error: `type must be one of: ${allowedTypes.join(', ')}` });
      }
      if (!Number.isInteger(amountCents) || amountCents <= 0) {
        return res.status(400).json({ error: 'amountCents must be a positive integer (cents)' });
      }

      load.accessorialCharges.push({
        type,
        description: description || null,
        amountCents,
        status: 'pending',
        requestedBy: req.user.userId,
        requestedAt: new Date(),
        evidenceUrls: Array.isArray(evidenceUrls) ? evidenceUrls : [],
      });
      await load.save();

      const charge = load.accessorialCharges[load.accessorialCharges.length - 1];

      try {
        await notifyUserSafe(load.postedBy, {
          type: 'accessorial_requested',
          title: 'Accessorial Charge Requested',
          body: `Carrier requested a ${type} charge of $${(amountCents / 100).toFixed(2)} on "${load.title}".`,
          link: '/dashboard/shipper/loads',
          metadata: { loadId: load._id, chargeId: charge._id, type, amountCents },
        });
      } catch (_) {}
      try {
        io.to(`user_${load.postedBy}`).emit('load:accessorialRequested', {
          loadId: load._id,
          chargeId: charge._id,
          type,
          amountCents,
        });
      } catch (_) {}

      res.status(201).json({ charge });
    } catch (err) {
      console.error('Error requesting accessorial:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // PUT /:id/accessorials/:chargeId/approve — shipper approves + settles payout
  router.put('/:id/accessorials/:chargeId/approve', auth, async (req, res) => {
    try {
      const load = await Load.findById(req.params.id);
      if (!load) return res.status(404).json({ error: 'Load not found' });

      const isShipper = String(load.postedBy) === (req.user.companyOwnerId || req.user.userId);
      const isAdmin = req.user.role === 'admin';
      if (!isShipper && !isAdmin) {
        return res.status(403).json({ error: 'Only the shipper or an admin can approve accessorials' });
      }

      const charge = load.accessorialCharges.id(req.params.chargeId);
      if (!charge) return res.status(404).json({ error: 'Charge not found' });
      if (charge.status !== 'pending') {
        return res.status(409).json({ error: `Charge is not pending (status: ${charge.status})` });
      }

      // Detention is frozen: the shipper may only approve the exact amount +
      // evidence they were shown. If a recalculation re-proposed a new amount,
      // the stored evidenceHash changed and the stale approval is rejected.
      if (charge.source === 'system_detention') {
        const { evidenceHashShown } = req.body;
        if (!evidenceHashShown || evidenceHashShown !== charge.evidenceHash) {
          return res.status(409).json({
            error: 'This detention charge was updated since you last viewed it. Please re-review the current amount and evidence before approving.',
          });
        }
      }

      // A charge whose dwell event was cancelled, or belongs to an earlier booking, can never be approved.
      if (!(await chargeEventBillable(load, charge))) {
        return res.status(409).json({ error: 'This detention charge belongs to a cancelled or earlier booking and cannot be approved.' });
      }
      // Unverified / legacy (null) location: the approval is recorded but nothing is collected or paid until an
      // admin confirms (PUT .../confirm-unverified). settleAccessorialCharge and the collector enforce this too.
      const heldForReview = !isAutoPayable(charge);

      // Path B — for system detention, COLLECT from the shipper off-session
      // before settling to the carrier. Falls back to accrual (Path A) when
      // Stripe / saved card / mandate aren't available.
      //
      // GATED behind ENABLE_ACCESSORIAL_COLLECTION so that configuring Stripe
      // (e.g. to field-test escrow) does NOT auto-enable off-session shipper
      // collection. Keep it false until the flow has been field-tested; until
      // then approval settles via Path A (accrual) exactly as today.
      const collectionEnabled = process.env.ENABLE_ACCESSORIAL_COLLECTION === 'true';
      let collect = null;
      // A charge whose dwell position was not authenticated (link-token fix / manual check-in) is never auto-collected.
      if (collectionEnabled && charge.source === 'system_detention' && !heldForReview) {
        try {
          const escrow = require('../services/escrowService');
          collect = await escrow.collectAccessorialFromShipper(load._id, charge._id);
        } catch (e) {
          console.error('[accessorial collect] error:', e.message);
          collect = { ok: false, code: 'error', error: e.message };
        }
        // A genuine card failure (declined, etc.) → keep the charge pending and
        // surface to the shipper. Missing Stripe/card/mandate falls back to Path A.
        if (collect && collect.ok === false && !collect.requiresAction &&
            !['stripe_unavailable', 'no_payment_method', 'no_mandate'].includes(collect.code)) {
          return res.status(402).json({ error: collect.error || 'Shipper payment failed', code: collect.code });
        }
      }

      charge.status = 'approved';
      charge.approvedBy = req.user.userId;
      charge.approvedAt = new Date();
      // Tamper-evident approval record — this, not the click, is the chargeback defense.
      if (charge.source === 'system_detention') {
        charge.approvalAudit = {
          approverUserId: req.user.userId,
          approvedAt: charge.approvedAt,
          amountCentsApproved: charge.amountCents,
          evidenceHashShown: charge.evidenceHash,
        };
        if (collect && collect.requiresAction) {
          charge.shipperPaymentStatus = 'requires_action';
          charge.shipperPaymentIntentId = collect.paymentIntentId || null;
        } else if (collect && collect.ok) {
          charge.shipperPaymentStatus = 'collected';
          charge.shipperPaymentIntentId = collect.paymentIntentId || null;
        }
      }
      await load.save();

      if (heldForReview) {
        if (load.acceptedBy) {
          try {
            await notifyUserSafe(load.acceptedBy, {
              type: 'accessorial_review',
              title: 'Detention Awaiting Manual Review',
              body: `The shipper approved your detention charge of $${(charge.amountCents / 100).toFixed(2)} on "${load.title}", but it is awaiting manual review because the arrival or departure location was not verified. It will not be paid until our team confirms it.`,
              link: '/dashboard/carrier/my-loads',
              metadata: { loadId: load._id, chargeId: charge._id },
            });
          } catch (_) {}
        }
        try { await notifyAdmins({ type: 'detention_review', title: 'Unverified detention awaiting confirmation', body: `Load ${load._id}: shipper approved a detention charge whose location was not verified (charge ${charge._id}).`, link: '/dashboard/admin', metadata: { loadId: String(load._id), chargeId: String(charge._id) } }); } catch (_) {}
        return res.json({ charge, awaitingReview: true, message: 'Approved. This charge is awaiting manual review because the location was not verified; it will not be collected or paid until our team confirms it.' });
      }

      // SCA required — do NOT settle yet; the webhook settles once the shipper
      // completes authentication and the collection PI succeeds.
      if (collect && collect.requiresAction) {
        return res.json({ charge, requiresAction: true, clientSecret: collect.clientSecret });
      }

      // Settle the payout to the carrier (Path B: funded by the collection above;
      // Path A fallback: from platform float when collection wasn't possible).
      try {
        const { settleAccessorialCharge } = require('./paymentRoutes');
        if (typeof settleAccessorialCharge === 'function') {
          const r = await settleAccessorialCharge(load._id, req.params.chargeId);
          if (r && r.error) console.warn('[accessorial settle]', r.error);
        }
      } catch (e) { console.warn('[accessorial settle] failed:', e.message); }

      if (load.acceptedBy) {
        try {
          await notifyUserSafe(load.acceptedBy, {
            type: 'accessorial_approved',
            title: 'Accessorial Charge Approved',
            body: `Your ${charge.type} charge of $${(charge.amountCents / 100).toFixed(2)} on "${load.title}" was approved.`,
            link: '/dashboard/carrier/my-loads',
            metadata: { loadId: load._id, chargeId: charge._id },
          });
        } catch (_) {}
        try {
          io.to(`user_${load.acceptedBy}`).emit('load:accessorialApproved', {
            loadId: load._id,
            chargeId: charge._id,
          });
        } catch (_) {}
      }

      res.json({ charge });
    } catch (err) {
      console.error('Error approving accessorial:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // PUT /:id/accessorials/:chargeId/confirm-unverified — ADMIN confirms a shipper-approved detention charge whose
  // dwell location was not verified (or is legacy/null), then collection (if enabled) and payout proceed.
  router.put('/:id/accessorials/:chargeId/confirm-unverified', auth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const load = await Load.findById(req.params.id);
      if (!load) return res.status(404).json({ error: 'Load not found' });
      const charge = load.accessorialCharges.id(req.params.chargeId);
      if (!charge) return res.status(404).json({ error: 'Charge not found' });
      if (charge.source !== 'system_detention' || charge.status !== 'approved' || isAutoPayable(charge)) {
        return res.status(409).json({ error: 'Only a shipper-approved detention charge awaiting location review can be confirmed' });
      }
      if (!(await chargeEventBillable(load, charge))) {
        return res.status(409).json({ error: 'This detention charge belongs to a cancelled or earlier booking' });
      }
      charge.adminConfirmedAt = new Date();
      charge.adminConfirmedBy = req.user.userId;
      await load.save();

      let collect = null;
      if (process.env.ENABLE_ACCESSORIAL_COLLECTION === 'true') {
        try { collect = await require('../services/escrowService').collectAccessorialFromShipper(load._id, charge._id); }
        catch (e) { collect = { ok: false, code: 'error', error: e.message }; }
        if (collect && collect.ok === false && !collect.requiresAction &&
            !['stripe_unavailable', 'no_payment_method', 'no_mandate'].includes(collect.code)) {
          return res.status(402).json({ error: collect.error || 'Shipper payment failed', code: collect.code });
        }
        if (collect && collect.requiresAction) {
          charge.shipperPaymentStatus = 'requires_action';
          charge.shipperPaymentIntentId = collect.paymentIntentId || null;
          await load.save();
          return res.json({ charge, requiresAction: true, clientSecret: collect.clientSecret });
        }
        if (collect && collect.ok) {
          charge.shipperPaymentStatus = 'collected';
          charge.shipperPaymentIntentId = collect.paymentIntentId || null;
          await load.save();
        }
      }
      let settled = null;
      try {
        const { settleAccessorialCharge } = require('./paymentRoutes');
        settled = await settleAccessorialCharge(load._id, charge._id);
      } catch (e) { console.warn('[accessorial confirm] settle failed:', e.message); }
      if (load.acceptedBy) {
        try { await notifyUserSafe(load.acceptedBy, { type: 'accessorial_approved', title: 'Detention Confirmed', body: `Our team confirmed your detention charge of $${(charge.amountCents / 100).toFixed(2)} on "${load.title}".`, link: '/dashboard/carrier/my-loads', metadata: { loadId: load._id, chargeId: charge._id } }); } catch (_) {}
      }
      res.json({ charge, settled });
    } catch (err) {
      console.error('Error confirming unverified accessorial:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // PUT /:id/accessorials/:chargeId/reject — shipper rejects
  router.put('/:id/accessorials/:chargeId/reject', auth, async (req, res) => {
    try {
      const load = await Load.findById(req.params.id);
      if (!load) return res.status(404).json({ error: 'Load not found' });

      const isShipper = String(load.postedBy) === (req.user.companyOwnerId || req.user.userId);
      const isAdmin = req.user.role === 'admin';
      if (!isShipper && !isAdmin) {
        return res.status(403).json({ error: 'Only the shipper or an admin can reject accessorials' });
      }

      const charge = load.accessorialCharges.id(req.params.chargeId);
      if (!charge) return res.status(404).json({ error: 'Charge not found' });
      if (charge.status !== 'pending') {
        return res.status(409).json({ error: `Charge is not pending (status: ${charge.status})` });
      }

      const { reason } = req.body;
      charge.status = 'rejected';
      charge.rejectionReason = reason || null;
      charge.rejectedBy = req.user.userId;
      charge.rejectedAt = new Date();
      await load.save();

      if (load.acceptedBy) {
        try {
          await notifyUserSafe(load.acceptedBy, {
            type: 'accessorial_rejected',
            title: 'Accessorial Charge Rejected',
            body: `Your ${charge.type} charge of $${(charge.amountCents / 100).toFixed(2)} on "${load.title}" was rejected.${reason ? ` Reason: ${reason}` : ''}`,
            link: '/dashboard/carrier/my-loads',
            metadata: { loadId: load._id, chargeId: charge._id },
          });
        } catch (_) {}
      }

      res.json({ charge });
    } catch (err) {
      console.error('Error rejecting accessorial:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  return router;
};
