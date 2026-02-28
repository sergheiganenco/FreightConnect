// routes/userRoutes.js
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { body } = require("express-validator");
const User = require("../models/User");
const Load = require("../models/Load");
const auth = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const { authLimiter } = require("../middlewares/rateLimiter");

const router = express.Router();
const { getIO } = require('../utils/socket');
const { notifyUserSafe } = require('../utils/notifyUser');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const Company = require('../models/Company');
const companyNormalize = require('../utils/companyNormalize');
const { generateBOL } = require('../utils/pdfGenerator');



// ----------------------
// 1) Signup Route

const signupValidation = [
  body("name").trim().notEmpty().withMessage("Name is required"),
  body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
  body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
  body("role").isIn(["carrier", "shipper", "admin"]).withMessage("Role must be carrier, shipper, or admin"),
  body("companyName")
    .if(body("role").isIn(["carrier", "shipper"]))
    .trim()
    .notEmpty()
    .withMessage("Company name is required for carriers and shippers"),
];

router.post("/signup", authLimiter, signupValidation, validate, async (req, res) => {
  try {
    const { name, email, password, role, companyName } = req.body;

    // 1. Input validation
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if ((role === "carrier" || role === "shipper") && !companyName) {
      return res.status(400).json({ error: "Company Name is required" });
    }

    // 2. Check for existing user by email
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists with this email" });
    }

    // 3. Normalize company name, handle company upsert
    let company = null;
    let companyId = null;
    if ((role === "carrier" || role === "shipper") && companyName) {
      const normName = companyNormalize(companyName);
      if (!normName) return res.status(400).json({ error: "Invalid company name" });

      company = await Company.findOneAndUpdate(
        { normalized: normName },
        {
          $setOnInsert: {
            name: companyName,
            normalized: normName,
            type: role,
            status: "active"
          }
        },
        { upsert: true, new: true }
      );
      companyId = company._id;
    }

    // 4. Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 5. Create and save user (linked to company if set)
    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      role,
      companyName: companyName || undefined,
      companyId: companyId || undefined
    });
    await newUser.save();

    // 6. Respond
    return res.status(201).json({
      message: "User created successfully",
      user: {
        _id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        companyName: newUser.companyName,
        companyId: newUser.companyId
      }
    });
  } catch (err) {
    console.error("Error in /signup:", err);
    if (err.code === 11000) {
      return res.status(400).json({ error: "A company with this normalized name already exists." });
    }
    return res.status(500).json({ error: "Server error" });
  }
});
// ----------------------
// 2) Login Route
// ----------------------
const loginValidation = [
  body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
  body("password").notEmpty().withMessage("Password is required"),
];

router.post("/login", authLimiter, loginValidation, validate, async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Error during login:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// ----------------------
// 3) WhoAmI Route
// ----------------------
router.get("/whoami", auth, (req, res) => {
  // Returns the user object from the auth middleware
  res.json({ user: req.user });
});

// ----------------------
// 4) Get User Profile
// GET user profile
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});
// PUT user profile
router.put('/me', auth, async (req, res) => {
  try {
    const { name, email, phone, companyName, mcNumber, dotNumber, type } = req.body;
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.name = name ?? user.name;
    user.email = email ?? user.email;
    user.phone = phone ?? user.phone;
    user.companyName = companyName ?? user.companyName;
    if (typeof mcNumber !== 'undefined') user.mcNumber = mcNumber;
    if (typeof dotNumber !== 'undefined') user.dotNumber = dotNumber;

    let company = null;
    if (companyName) {
      const norm = companyNormalize(companyName);

      // Try to find by normalized name
      company = await Company.findOne({ normalized: norm });

      if (!company) {
        // Create new company if not found
        company = await Company.create({
          name: companyName,
          normalized: norm,
          mcNumber,
          dotNumber,
          type: type || undefined,
          status: 'active'
        });
      } else if (company.name !== companyName) {
        // If name was changed but normalized matches (e.g. LLC added/removed)
        company.name = companyName;
        if (typeof mcNumber !== 'undefined') company.mcNumber = mcNumber;
        if (typeof dotNumber !== 'undefined') company.dotNumber = dotNumber;
        if (typeof type !== 'undefined') company.type = type;
        await company.save();
      }
      user.companyId = company._id;
      user.companyName = company.name;
    }

    const updatedUser = await user.save();
    res.json(updatedUser);
  } catch (err) {
    console.error("PUT /me error:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

router.post('/me/upload-doc', auth, upload.single('file'), async (req, res) => {
  try {
    const docType = req.body.docType; // "insurance", "authority", "business_license", etc.
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    // Save file info to user.documents
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!user.documents) user.documents = {};
    user.documents[docType] = {
      url: `/uploads/${req.file.filename}`, // Or your cloud storage url
      uploaded: true,
      name: req.file.originalname
    };
    await user.save();
    res.json(user.documents[docType]);
  } catch (err) {
    console.error("Upload doc error:", err);
    res.status(500).json({ error: "Failed to upload document" });
  }
});

//Get Fleet (all trucks for logged-in carrier)
router.get('/fleet', auth, async (req, res) => {
  try {
    if (req.user.role !== "carrier") {
      return res.status(403).json({ error: "Only carriers have fleets" });
    }
    const user = await User.findById(req.user.userId).select("fleet");
    if (!user) {
      return res.status(404).json({ error: "Carrier not found" });
    }
    res.json({ fleet: user.fleet });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch fleet" });
  }
});

// Add a Truck to Fleet
router.post('/fleet', auth, async (req, res) => {
  try {
    if (req.user.role !== "carrier") {
      return res.status(403).json({ error: "Only carriers can add trucks" });
    }
    const { truckId, driverName, status } = req.body;
    if (!truckId) return res.status(400).json({ error: "Truck ID is required" });

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: "Carrier not found" });

    // Prevent duplicate truck IDs in the fleet
    if (user.fleet.some(t => t.truckId === truckId)) {
      return res.status(409).json({ error: "Truck ID already exists in your fleet." });
    }

    const newTruck = {
      truckId,
      driverName: driverName || "",
      status: status || "Available",
      location: {},
      assignedLoadId: null
    };

    user.fleet.push(newTruck);
    await user.save();

    res.status(201).json({ message: "Truck added", fleet: user.fleet });
  } catch (err) {
    console.error("Error adding truck:", err);
    res.status(500).json({ error: "Failed to add truck" });
  }
});


//Update a Truck (by truckId)
router.put('/fleet/:truckId', auth, async (req, res) => {
  try {
    if (req.user.role !== "carrier") {
      return res.status(403).json({ error: "Only carriers can update trucks" });
    }
    const { truckId } = req.params;
    const { driverName, status, location, currentLoadId } = req.body;

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: "Carrier not found" });

    const truck = user.fleet.find(t => t.truckId === truckId);
    if (!truck) return res.status(404).json({ error: "Truck not found" });

    if (driverName !== undefined) truck.driverName = driverName;
    if (status !== undefined) truck.status = status;
    if (location !== undefined) truck.location = location;
    if (currentLoadId !== undefined) truck.currentLoadId = currentLoadId;

    await user.save();

    res.json({ message: "Truck updated", fleet: user.fleet });
  } catch (err) {
    res.status(500).json({ error: "Failed to update truck" });
  }
});

//Remove a Truck from Fleet
router.delete('/fleet/:truckId', auth, async (req, res) => {
  try {
    if (req.user.role !== "carrier") {
      return res.status(403).json({ error: "Only carriers can remove trucks" });
    }
    const { truckId } = req.params;
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: "Carrier not found" });

    user.fleet = user.fleet.filter(t => t.truckId !== truckId);
    await user.save();

    res.json({ message: "Truck removed", fleet: user.fleet });
  } catch (err) {
    res.status(500).json({ error: "Failed to remove truck" });
  }
});


// PUT /api/users/fleet/:truckId/assign-load
router.put('/fleet/:truckId/assign-load', auth, async (req, res) => {
  try {
    const { truckId } = req.params;
    const { loadId } = req.body;
    if (!loadId) return res.status(400).json({ error: "Missing loadId." });

    // 1. Validate carrier
    const user = await User.findById(req.user.userId);
    if (!user || user.role !== "carrier") {
      return res.status(403).json({ error: "Only carriers can assign loads to trucks." });
    }

    // 2. Find the truck
    const truck = user.fleet.find(t => t.truckId === truckId);
    if (!truck) return res.status(404).json({ error: "Truck not found in your fleet." });

    // 3. Check if already assigned
    if (truck.assignedLoadId && truck.assignedLoadId !== loadId) {
      return res.status(409).json({ error: "Truck already has an assigned load. Unassign first." });
    }

    // 4. Validate Load
    const Load = require("../models/Load");
    const load = await Load.findById(loadId);
    if (!load) return res.status(404).json({ error: "Load not found." });
    if (load.status !== "open") {
      return res.status(400).json({ error: "Load is not open for assignment." });
    }

    // 5. Assign load to truck and update status, available, and lastStatusUpdate
    truck.assignedLoadId = loadId;
    truck.status = "In Transit";               // Automated status (could be "Assigned" if you prefer)
    truck.available = false;                   // Truck is now busy!
    truck.lastStatusUpdate = new Date();       // Track when the status changed

    load.status = "accepted";
    load.acceptedBy = user._id;
    load.assignedTruckId = truckId;

    await user.save();
    await load.save();

    // Notify shipper that carrier is in transit
    notifyUserSafe(load.postedBy?.toString(), {
      type: 'load:status',
      title: 'Carrier is on the way!',
      body: `"${load.title}" — ${load.origin} → ${load.destination}`,
      link: '/dashboard/shipper/loads',
      metadata: { loadId: load._id, status: 'in-transit' },
    });

    // Post system message to load thread on dispatch
    try {
      const Channel = require("../models/Channel");
      const Message = require("../models/Message");
      const channelId = `load_${load._id}`;
      const channel = await Channel.findOne({ channelId });
      if (channel) {
        const driverInfo = truck.driverName ? ` Driver: ${truck.driverName}.` : "";
        await Message.create({
          channelType: "load_thread",
          channelId,
          sender: null,
          content: `🚚 Carrier dispatched.${driverInfo} Truck ID: ${truck.truckId}.`,
          messageType: "system",
          readBy: [],
        });
        const io = getIO();
        if (io) io.to(channelId).emit("newMessage", {
          channelId,
          content: `🚚 Carrier dispatched.${driverInfo}`,
          messageType: "system",
          createdAt: new Date(),
        });
      }
    } catch (chatErr) {
      console.error("Failed to post dispatch system message (non-fatal):", chatErr);
    }

    // 6. Enrich fleet with assigned load details for frontend
    const updatedUser = await User.findById(req.user.userId);
    const LoadModel = require("../models/Load");
    const fleetWithAssignedLoads = await Promise.all(
      updatedUser.fleet.map(async (t) => {
        let assignedLoad = null;
        if (t.assignedLoadId) {
          assignedLoad = await LoadModel.findById(t.assignedLoadId)
            .select('title origin destination status equipmentType rate');
        }
        return {
          ...t.toObject(),
          assignedLoad,
        };
      })
    );

    // 7. Emit live update (for all connected clients, you can limit to user if needed)
    const io = getIO();
    if (io) io.emit("fleetUpdated", { userId: user._id });

    // 8. Respond
    res.json({
      message: "Load assigned to truck.",
      fleet: fleetWithAssignedLoads,
      truck: {
        truckId: truck.truckId,
        driverName: truck.driverName,
        assignedLoadId: truck.assignedLoadId,
        assignedLoad: fleetWithAssignedLoads.find(f => f.truckId === truck.truckId)?.assignedLoad || null,
        status: truck.status,
        available: truck.available,
        lastStatusUpdate: truck.lastStatusUpdate,
      },
      load: {
        _id: load._id,
        title: load.title,
        status: load.status,
        acceptedBy: load.acceptedBy,
        assignedTruckId: load.assignedTruckId
      }
    });

  } catch (err) {
    console.error("Error assigning load:", err);
    res.status(500).json({ error: "Server error assigning load." });
  }
});



// PUT /api/users/fleet/:truckId/unassign-load
router.put('/fleet/:truckId/unassign-load', auth, async (req, res) => {
  try {
    const { truckId } = req.params;

    // 1. Validate carrier
    const user = await User.findById(req.user.userId);
    if (!user || user.role !== "carrier") {
      return res.status(403).json({ error: "Only carriers can unassign loads from trucks." });
    }

    // 2. Find the truck
    const truck = user.fleet.find(t => t.truckId === truckId);
    if (!truck) return res.status(404).json({ error: "Truck not found in your fleet." });

    if (!truck.assignedLoadId) return res.status(400).json({ error: "No load assigned to this truck." });

    // 3. Unassign the load
    const Load = require("../models/Load");
    const load = await Load.findById(truck.assignedLoadId);

    if (!load) return res.status(404).json({ error: "Assigned load not found." });

    // Defensive: If equipmentType is missing, patch for validation (if needed)
    if (!load.equipmentType) {
      console.warn("Load missing equipmentType. Setting default for recovery.", load);
      load.equipmentType = "Unknown"; // or another sensible default
    }

    // -- AUTOMATED LOGIC ADDED HERE --
    // Unassign from truck and update status/availability/lastStatusUpdate
    truck.assignedLoadId = null;
    truck.status = "Available";           // System auto-sets status
    truck.available = true;               // Allow manual toggle again
    truck.lastStatusUpdate = new Date();  // Track when this changed

    load.status = "open";
    load.acceptedBy = null;
    load.assignedTruckId = null;

    await user.save();
    await load.save();

    // 4. Enrich the updated fleet with assigned load details
    const updatedUser = await User.findById(req.user.userId);
    const LoadModel = require("../models/Load");
    const fleetWithAssignedLoads = await Promise.all(
      updatedUser.fleet.map(async (t) => {
        let assignedLoad = null;
        if (t.assignedLoadId) {
          assignedLoad = await LoadModel.findById(t.assignedLoadId)
            .select('title origin destination status equipmentType rate');
        }
        return {
          ...t.toObject(),
          assignedLoad,
        };
      })
    );

    // 5. Emit live update (socket.io)
    const io = getIO();
    if (io) io.emit("fleetUpdated", { userId: user._id });

    // 6. Respond with the enriched data
    res.json({
      message: "Load unassigned from truck.",
      fleet: fleetWithAssignedLoads,
      truck: {
        truckId: truck.truckId,
        driverName: truck.driverName,
        assignedLoadId: truck.assignedLoadId,
        assignedLoad: null,
        status: truck.status,
        available: truck.available,
        lastStatusUpdate: truck.lastStatusUpdate,
      },
      load: {
        _id: load._id,
        title: load.title,
        status: load.status,
        acceptedBy: load.acceptedBy,
        assignedTruckId: load.assignedTruckId,
      }
    });
  } catch (err) {
    console.error("Error unassigning load:", err);
    res.status(500).json({ error: "Server error unassigning load." });
  }
});


// PUT /api/users/fleet/:truckId/deliver
router.put('/fleet/:truckId/deliver', auth, async (req, res) => {
  try {
    const { truckId } = req.params;

    // 1. Validate carrier
    const user = await User.findById(req.user.userId);
    if (!user || user.role !== "carrier") {
      return res.status(403).json({ error: "Only carriers can mark loads as delivered." });
    }

    // 2. Find the truck
    const truck = user.fleet.find(t => t.truckId === truckId);
    if (!truck) return res.status(404).json({ error: "Truck not found in your fleet." });
    if (!truck.assignedLoadId) return res.status(400).json({ error: "No load assigned to this truck." });

    // 3. Find the load
    const Load = require("../models/Load");
    const load = await Load.findById(truck.assignedLoadId);
    if (!load) return res.status(404).json({ error: "Assigned load not found." });

    // 4. Mark as delivered and free up truck
    truck.status = "Available";           // Truck is free again
    truck.available = true;
    truck.lastStatusUpdate = new Date();
    truck.assignedLoadId = null;

    load.status = "delivered";
    load.deliveredAt = new Date();
    load.completedBy = user._id;
    load.assignedTruckId = null;

    await user.save();
    await load.save();

    // 5. Auto-generate BOL (non-blocking)
    try {
      const shipper = await User.findById(load.postedBy).select('name email companyName');
      const bolPath = await generateBOL(load, user, shipper);
      await Load.findByIdAndUpdate(load._id, { 'documents.bol': bolPath });
      const io = getIO();
      if (io) {
        io.to(`user_${load.acceptedBy}`).emit('doc:generated', { loadId: load._id, type: 'bol', path: bolPath });
        io.to(`user_${load.postedBy}`).emit('doc:generated', { loadId: load._id, type: 'bol', path: bolPath });
      }
    } catch (bolErr) {
      console.error('BOL auto-generate failed (non-fatal):', bolErr.message);
    }

    // 6. Notify shipper of delivery
    notifyUserSafe(load.postedBy?.toString(), {
      type: 'load:status',
      title: 'Your load has been delivered!',
      body: `"${load.title}" — ${load.origin} → ${load.destination}`,
      link: '/dashboard/shipper/loads',
      metadata: { loadId: load._id, status: 'delivered' },
    });

    // 7. Post system message to load thread and lock it after 7 days
    try {
      const Channel = require("../models/Channel");
      const Message = require("../models/Message");
      const channelId = `load_${load._id}`;
      const channel = await Channel.findOne({ channelId });
      if (channel) {
        const archiveAfter = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await Channel.findOneAndUpdate(
          { channelId },
          { archiveAfter, lastMessageAt: new Date(), lastMessagePreview: "Load delivered" }
        );
        await Message.create({
          channelType: "load_thread",
          channelId,
          sender: null,
          content: `✓ Load delivered at ${new Date().toLocaleString()}. This chat will lock in 7 days.`,
          messageType: "system",
          readBy: [],
        });
        const io = getIO();
        if (io) io.to(channelId).emit("newMessage", {
          channelId,
          content: `✓ Load delivered at ${new Date().toLocaleString()}.`,
          messageType: "system",
          createdAt: new Date(),
        });
      }
    } catch (chatErr) {
      console.error("Failed to post delivery system message (non-fatal):", chatErr);
    }

    // 8. Enrich the updated fleet with assigned load details
    const updatedUser = await User.findById(req.user.userId);
    const LoadModel = require("../models/Load");
    const fleetWithAssignedLoads = await Promise.all(
      updatedUser.fleet.map(async (t) => {
        let assignedLoad = null;
        if (t.assignedLoadId) {
          assignedLoad = await LoadModel.findById(t.assignedLoadId)
            .select('title origin destination status equipmentType rate');
        }
        return {
          ...t.toObject(),
          assignedLoad,
        };
      })
    );

    // 7. Auto-release escrow payment (non-blocking)
    try {
      const Payment = require('../models/Payment');
      const Invoice = require('../models/Invoice');
      const payment = await Payment.findOne({ loadId: load._id, status: 'in_escrow' });
      if (payment) {
        payment.status = 'released';
        payment.releasedAt = new Date();
        await payment.save();
        // Generate invoice
        const existing = await Invoice.findOne({ loadId: load._id });
        if (!existing) {
          await Invoice.create({
            loadId: load._id,
            shipperId: payment.shipperId,
            carrierId: payment.carrierId,
            subtotal: payment.amount,
            platformFee: payment.platformFee,
            total: payment.amount,
            status: 'paid',
            paidAt: new Date(),
            issuedAt: new Date(),
            stripePaymentIntentId: payment.stripePaymentIntentId,
            lineItems: [{
              description: `Freight: ${load.title} (${load.origin} → ${load.destination})`,
              quantity: 1,
              unitAmount: payment.amount,
              total: payment.amount,
            }],
          });
        }
        const io = getIO();
        if (io) {
          io.to(`user_${payment.carrierId}`).emit('payment:released', { loadId: load._id, amount: payment.carrierPayout });
          io.to(`user_${payment.shipperId}`).emit('payment:released', { loadId: load._id, amount: payment.amount });
        }
      }
    } catch (payErr) {
      console.error('Auto-release payment error (non-fatal):', payErr.message);
    }

    // 8. Emit live update (socket.io)
    const io = getIO();
    if (io) io.emit("fleetUpdated", { userId: user._id });

    res.json({
      message: "Load marked as delivered.",
      fleet: fleetWithAssignedLoads,
      truck: {
        truckId: truck.truckId,
        driverName: truck.driverName,
        status: truck.status,
        available: truck.available,
        lastStatusUpdate: truck.lastStatusUpdate,
        assignedLoadId: truck.assignedLoadId,
        assignedLoad: null,
      },
      load: {
        _id: load._id,
        title: load.title,
        status: load.status,
        deliveredAt: load.deliveredAt,
        completedBy: load.completedBy,
      }
    });
  } catch (err) {
    console.error("Error marking load as delivered:", err);
    res.status(500).json({ error: "Server error delivering load." });
  }
});




// PUT /api/users/fleet/:truckId/location
router.put('/fleet/:truckId/location', auth, async (req, res) => {
  try {
    const { truckId } = req.params;
    const { latitude, longitude } = req.body;
    const user = await User.findById(req.user.userId);
    if (!user || user.role !== "carrier") return res.status(403).json({ error: "Only carriers can update location." });
    const truck = user.fleet.find(t => t.truckId === truckId);
    if (!truck) return res.status(404).json({ error: "Truck not found." });
    truck.location = { latitude, longitude, updatedAt: new Date() };
    await user.save();
    res.json({ message: "Location updated", truck });
  } catch (err) {
    res.status(500).json({ error: "Error updating location." });
  }
});

//Update Truck Location (for real-time tracking)
router.put('/update-location', auth, async (req, res) => {
  try {
    const { truckId, latitude, longitude } = req.body;
    const user = await User.findById(req.user.userId);
    if (!user || user.role !== "carrier") {
      return res.status(403).json({ error: "Only carriers can update location." });
    }
    const truck = user.fleet.find(t => t.truckId === truckId);
    if (!truck) return res.status(404).json({ error: "Truck not found." });

    truck.location = { latitude, longitude };
    await user.save();

    // Socket update (if using req.io, or global io)
    const io = getIO(); // Always get io
    if (io) io.emit("fleetUpdated", { userId: user._id });

    res.json({ message: "Location updated", truck });
  } catch (err) {
    console.error("Error updating truck location:", err);
    res.status(500).json({ error: "Server error updating location." });
  }
});

// PUT /api/users/fleet/:truckId/availability
router.put("/fleet/:truckId/availability", auth, async (req, res) => {
  try {
    const { available } = req.body;
    const status = available ? "Available" : "Unavailable";
    const truck = await Truck.findOneAndUpdate(
      { truckId: req.params.truckId, owner: req.user.userId },
      { available, status, lastStatusUpdate: new Date() },
      { new: true }
    );
    if (!truck) return res.status(404).json({ error: "Truck not found" });
    res.json(truck);
  } catch (err) {
    res.status(500).json({ error: "Failed to update truck availability" });
  }
});







// ----------------------------------------
// PUT /api/users/me/preferences — save carrier matching preferences
// ----------------------------------------
router.put('/me/preferences', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') {
      return res.status(403).json({ error: 'Only carriers can set matching preferences' });
    }
    const { equipmentTypes, preferredLanes, preferredRegions, minRate, maxMileage, homeBase } = req.body;
    const update = {};
    if (equipmentTypes !== undefined) update['preferences.equipmentTypes'] = equipmentTypes;
    if (preferredLanes !== undefined) update['preferences.preferredLanes'] = preferredLanes;
    if (preferredRegions !== undefined) update['preferences.preferredRegions'] = preferredRegions;
    if (minRate !== undefined) update['preferences.minRate'] = Number(minRate);
    if (maxMileage !== undefined) update['preferences.maxMileage'] = maxMileage ? Number(maxMileage) : null;
    if (homeBase !== undefined) update['preferences.homeBase'] = homeBase;

    const user = await User.findByIdAndUpdate(req.user.userId, { $set: update }, { new: true });
    res.json({ preferences: user.preferences });
  } catch (err) {
    console.error('Error saving preferences:', err);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

// Export the router
module.exports = router;
