
module.exports = (io) => {
  const express = require("express");
  const router = express.Router();
  const fetch = require("node-fetch");
  const auth = require("../middlewares/authMiddleware");
  const Load = require("../models/Load");
  const axios = require("axios");
  require("dotenv").config();
  const User = require("../models/User");

  // ----------------------------------------
  // GET /api/loads - Return all loads (open + carrier's accepted)
  // ---------------------------------------
router.get("/", auth, async (req, res) => {
  try {
    if (req.user.role !== "carrier") {
      return res.status(403).json({ error: "Access denied" });
    }

    const { status, equipmentType, minRate, maxRate, pickupStart, pickupEnd, sortBy, sortOrder } = req.query;

    let filter = {
      $or: [
        { status: "open" },
        { acceptedBy: req.user.userId },
      ],
    };

    if (status) filter.status = status;
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

    const sortCriteria = {};
    if (sortBy) sortCriteria[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const loads = await Load.find(filter).sort(sortCriteria);
    res.json(loads);
  } catch (err) {
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
    console.log("SHIPPER DEBUG req.user:", req.user); 
    console.log("SHIPPER DEBUG headers:", req.headers);
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

 // POST /api/loads - Create a New Load
// ----------------------------------------
router.post('/', auth, async (req, res) => {
  try {
    const {
      title,
      origin,
      destination,
      rate,
      equipmentType,

      // NEW optional fields coming from the front-end form
      pickupStart,
      pickupEnd,
      deliveryStart,
      deliveryEnd,
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
      // ✅ store the windows if provided
      pickupTimeWindow: pickupStart && pickupEnd ? { start: pickupStart, end: pickupEnd } : undefined,
      deliveryTimeWindow: deliveryStart && deliveryEnd ? { start: deliveryStart, end: deliveryEnd } : undefined,
    });

    await newLoad.save();
    res.status(201).json(newLoad);
  } catch (err) {
    console.error('Error saving load:', err);
    res.status(500).json({ error: 'Failed to post load.' });
  }
});

  // ----------------------------------------
  // PUT /api/loads/:id/accept - Accept a Load
  // ----------------------------------------
  router.put("/:id/accept", auth, async (req, res) => {
    try {
      const load = await Load.findById(req.params.id);
      if (!load) {
        return res.status(404).json({ error: "Load not found" });
      }
      // If load is missing lat/lng => 400
      if (!load.originLat || !load.originLng || !load.destinationLat || !load.destinationLng) {
        return res.status(400).json({ error: "Load is missing required location coordinates" });
      }
  
      load.acceptedBy = req.user.userId;
      load.status = "accepted";
      await load.save();
  
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
    console.log("GET /my-loads route hit!"); 
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

  // ----------------------------------------
  // GET /api/loads/get-route - Simple route from start->end via ORS
  // (You might not use this if you do /:id/route)
  // ----------------------------------------
  router.get("/get-route", async (req, res) => {
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

      console.log(`Fetching route from ${start} to ${end}`);
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

  
      console.log("Fetching route:", url);
  
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
      console.log(`Fetching route: ${routeUrl}`);

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

    load.status = status;
    await load.save();

    // ✅ Emit real-time update event to notify connected clients using io directly
    io.emit("loadStatusUpdated", { 
      loadId: load._id, 
      status: load.status, 
      acceptedBy: load.acceptedBy 
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



// backend/routes/chatbot.js
router.post('/voice-command', auth, async (req, res) => {
  const { command } = req.body;
  console.log("Voice command received:", command);

  if (command.includes('recommend')) {
    res.json({ message: 'Here are some recommended loads for you.' });
  } else {
    res.json({ message: 'Command not recognized.' });
  }
});




  return router;
};
