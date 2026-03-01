
module.exports = (io) => {
  const express = require("express");
  const router = express.Router();
  const fetch = require("node-fetch");
  const { body } = require("express-validator");
  const auth = require("../middlewares/authMiddleware");
  const validate = require("../middlewares/validate");
  const Load = require("../models/Load");
  const axios = require("axios");
  require("dotenv").config();
  const User = require("../models/User");
  const { generateRateConfirmation } = require("../utils/pdfGenerator");

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

  // ----------------------------------------
  // GET /api/loads - Return all loads (open + carrier's accepted)
  // ---------------------------------------
  router.get("/", auth, async (req, res) => {
    try {
      const { status, equipmentType, minRate, maxRate, pickupStart, pickupEnd, sortBy, sortOrder } = req.query;
  
      let filter = {};
  
      // ---- Carrier: open loads and loads accepted by this carrier
      if (req.user.role === "carrier") {
        filter = {
          $or: [
            { status: "open" },
            { acceptedBy: req.user.userId },
          ],
        };
      }
  
      // ---- Shipper: loads posted by this shipper
      else if (req.user.role === "shipper") {
        filter = { postedBy: req.user.userId };
      }
  
      // ---- Admin: see ALL loads (no filter = all docs)
      // You can apply more admin-specific filtering if needed
  
      // --- Shared filters ---
      if (status && status !== "all") {
        if (req.user.role === "carrier") {
          if (status === "open") {
            filter = { status: "open" };
          } else {
            // Show carrier's loads with this status, plus keep open loads visible
            filter.$or = [
              { status, acceptedBy: req.user.userId },
              { status: "open" },
            ];
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
  
      // --- Sorting ---
      const sortCriteria = {};
      if (sortBy) sortCriteria[sortBy] = sortOrder === "desc" ? -1 : 1;
      else sortCriteria.createdAt = -1;
  
      const loads = await Load.find(filter).sort(sortCriteria);
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
    const openLoads = await Load.find({ status: "open", assignedTruckId: null });
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

      const acceptedLoads = await Load.find({ acceptedBy: req.user.userId })
        .skip(skip)
        .limit(parseInt(limit));

      const totalCount = await Load.countDocuments({
        acceptedBy: req.user.userId,
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

      let filters = { postedBy: req.user.userId };
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
      const matches = await findMatchesForCarrier(req.user.userId, limit);
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
];

router.post('/', auth, createLoadValidation, validate, async (req, res) => {
  try {
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
    } = req.body;

    if (!title || !origin || !destination || !rate || !equipmentType) {
      return res.status(400).json({ error: 'Title, origin, destination, rate and equipmentType are required.' });
    }

    if (req.user.role !== 'shipper') {
      return res.status(403).json({ error: 'Only shippers can post loads.' });
    }

    // ---------- geocode -------------
    const fetchCoords = async (location) => {
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}`);
      const data = await resp.json();
      if (!data.length) throw new Error(`Could not geocode ${location}`);
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    };

    const originC      = await fetchCoords(origin);
    const destinationC = await fetchCoords(destination);

    // ---------- build & save ---------
    // Parse array fields that may arrive as JSON strings (FormData uploads)
    const parseArr = (v) => {
      if (Array.isArray(v)) return v;
      if (typeof v === 'string' && v.startsWith('[')) try { return JSON.parse(v); } catch { /* ignore */ }
      return undefined;
    };

    const newLoad = new Load({
      title,
      origin,
      originLat: originC.lat,
      originLng: originC.lng,
      destination,
      destinationLat: destinationC.lat,
      destinationLng: destinationC.lng,
      rate,
      equipmentType,
      postedBy: req.user.userId,
      commodityType: commodityType || undefined,
      commodityCategory: commodityCategory || undefined,
      loadWeight: weight ? Number(weight) : undefined,
      specialInstructions: specialInstructions || undefined,

      // Time windows
      pickupTimeWindow: pickupWindowStart ? { start: new Date(pickupWindowStart), end: pickupWindowEnd ? new Date(pickupWindowEnd) : undefined } : undefined,
      deliveryTimeWindow: deliveryWindowStart ? { start: new Date(deliveryWindowStart), end: deliveryWindowEnd ? new Date(deliveryWindowEnd) : undefined } : undefined,

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
    });

    // Geocode intermediate stops asynchronously — do not block response
    if (Array.isArray(rawStops) && rawStops.length > 0) {
      newLoad.stops = rawStops.map((s, i) => ({
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

    await newLoad.save();
    res.status(201).json(newLoad);

    // Async: notify matched carriers — non-blocking
    const { notifyMatchedCarriers } = require('../services/matchingService');
    notifyMatchedCarriers(newLoad, io);
  } catch (err) {
    console.error('Error saving load:', err);
    res.status(500).json({ error: 'Failed to post load.' });
  }
});

  // ----------------------------------------
  // PUT /api/loads/:id/accept - Accept a Load (atomic — prevents double-accept)
  // ----------------------------------------
  router.put("/:id/accept", auth, async (req, res) => {
    try {
      // Require carrier to be verified before accepting loads
      const carrier = await User.findById(req.user.userId).select('verification');
      if (carrier?.verification?.status !== 'verified') {
        return res.status(403).json({
          error: 'Complete carrier verification before accepting loads',
          verificationStatus: carrier?.verification?.status || 'unverified',
        });
      }

      // Atomic: only succeeds if load is still open and not yet accepted
      const load = await Load.findOneAndUpdate(
        { _id: req.params.id, status: "open", acceptedBy: null },
        { $set: { status: "accepted", acceptedBy: req.user.userId } },
        { new: true }
      );

      if (!load) {
        const exists = await Load.findById(req.params.id);
        if (!exists) return res.status(404).json({ error: "Load not found" });
        return res.status(409).json({ error: "Load is no longer available — already accepted by another carrier" });
      }

      if (!load.originLat || !load.originLng || !load.destinationLat || !load.destinationLng) {
        return res.status(400).json({ error: "Load is missing required location coordinates" });
      }

      // Auto-generate Rate Confirmation (non-blocking)
      autoGenerateRateCon(load._id, req.user.userId, load.postedBy);

      // Auto-create a load_thread channel between carrier and shipper
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
              { user: req.user.userId, role: "carrier" },
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

      const loads = await Load.find({ acceptedBy: req.user.userId });
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
    const loads = await Load.find({ shipperId: req.user.userId });
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

      if (!load.originLat || !load.originLng || !load.destinationLat || !load.destinationLng) {
        return res.status(400).json({
          error: "Load is missing required location coordinates.",
        });
      }

      const apiKey = process.env.ORS_API_KEY;
      if (!apiKey) {
        return res
          .status(500)
          .json({ error: "ORS_API_KEY is not set on the server" });
      }

      const routeUrl = `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${apiKey}&start=${load.originLng},${load.originLat}&end=${load.destinationLng},${load.destinationLat}`;

      const response = await axios.get(routeUrl);
      if (!response.data || !response.data.features) {
        return res.status(400).json({ error: "No valid route found." });
      }

      const route = response.data.features[0].geometry.coordinates || [];
      const distanceMeters =
        response.data.features[0]?.properties?.segments[0]?.distance || 0;
      const timeSeconds =
        response.data.features[0]?.properties?.segments[0]?.duration || 0;

      const distanceMiles = (distanceMeters / 1609).toFixed(2);
      const estimatedHours = (timeSeconds / 3600).toFixed(2);

      res.json({
        route,
        distance: distanceMiles,
        estimatedTime: estimatedHours,
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

    // Ensure that the carrier attempting to update the load is the one assigned to it
    if (String(load.acceptedBy) !== req.user.userId) {
      return res.status(403).json({ error: "You are not authorized to update this load" });
    }

    // Update the status to delivered
    load.status = "delivered";
    await load.save();

    res.json({ message: "Load marked as delivered successfully", load });
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

    const load = await Load.findById(req.params.id);
    if (!load) {
      return res.status(404).json({ error: "Load not found." });
    }

    if (req.user.role !== "carrier" || String(load.acceptedBy) !== req.user.userId) {
      return res.status(403).json({ error: "Unauthorized action." });
    }

    // Enforce valid status transitions
    const VALID_TRANSITIONS = {
      'accepted':   ['in-transit'],
      'in-transit': ['delivered'],
    };
    const allowed = VALID_TRANSITIONS[load.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        error: `Cannot change status from "${load.status}" to "${status}"`,
      });
    }

    load.status = status;
    await load.save();

    // Emit only to the shipper and carrier involved — not all connected users
    io.to(`user_${load.postedBy}`).emit("loadStatusUpdated", {
      loadId: load._id,
      status: load.status,
      acceptedBy: load.acceptedBy,
    });
    io.to(`user_${load.acceptedBy}`).emit("loadStatusUpdated", {
      loadId: load._id,
      status: load.status,
      acceptedBy: load.acceptedBy,
    });

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
    }).limit(5);

    res.json(recommendedLoads);
  } catch (err) {
    console.error("Error fetching recommended loads:", err);
    res.status(500).json({ error: "Server error fetching recommendations." });
  }
});

// PUT /api/loads/:id/pickup-window  { start, end }
router.put('/:id/pickup-window', auth, async (req, res) => {
  try {
    const { start, end } = req.body;
    if (!start || !end) return res.status(400).json({ error: 'start and end are required' });

    const load = await Load.findByIdAndUpdate(
      req.params.id,
      { 'pickupTimeWindow.start': start, 'pickupTimeWindow.end': end },
      { new: true, runValidators: true }
    );
    if (!load) return res.status(404).json({ error: 'Load not found' });

    res.json(load);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error updating window' });
  }
});

// PUT /api/loads/:id/delivery-window   { start, end }
router.put('/:id/delivery-window', auth, async (req, res) => {
  try {
    const { start, end } = req.body;
    if (!start || !end) {
      return res.status(400).json({ error: 'start and end are required' });
    }

    const load = await Load.findByIdAndUpdate(
      req.params.id,
      {
        'deliveryTimeWindow.start': start,
        'deliveryTimeWindow.end':   end,
      },
      { new: true, runValidators: true }
    );

    if (!load) {
      return res.status(404).json({ error: 'Load not found' });
    }

    res.json(load);
  } catch (err) {
    console.error('Error updating delivery window:', err);
    res.status(500).json({ error: 'Server error updating window' });
  }
});

// PUT /api/loads/:id/assign-to-truck
router.put("/:id/assign-to-truck", auth, async (req, res) => {
  try {
    // Carrier only
    if (req.user.role !== "carrier") {
      return res.status(403).json({ error: "Only carriers can assign loads to trucks" });
    }
    const { truckId } = req.body;
    if (!truckId) {
      return res.status(400).json({ error: "truckId is required" });
    }

    const load = await Load.findById(req.params.id);
    if (!load) return res.status(404).json({ error: "Load not found" });

    // Only allow assignment if load is open and not assigned
    if (load.status !== "open" || load.assignedTruckId) {
      return res.status(400).json({ error: "Load is not available for assignment" });
    }

    load.assignedTruckId = truckId;
    load.status = "assigned";
    await load.save();

    res.json({ message: "Load assigned to truck", load });
  } catch (err) {
    console.error("Error assigning load to truck:", err);
    res.status(500).json({ error: "Server error assigning load" });
  }
});



// ── Multi-Stop Endpoints ────────────────────────────────────────────────────

// GET /api/loads/:id/stops
router.get('/:id/stops', auth, async (req, res) => {
  try {
    const load = await Load.findById(req.params.id).select('stops origin destination status postedBy acceptedBy');
    if (!load) return res.status(404).json({ error: 'Load not found' });
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
    if (String(load.postedBy) !== req.user.userId) {
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
    if (String(load.acceptedBy) !== req.user.userId) {
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
  const { command } = req.body;

  if (command.includes('recommend')) {
    res.json({ message: 'Here are some recommended loads for you.' });
  } else {
    res.json({ message: 'Command not recognized.' });
  }
});




  return router;
};
