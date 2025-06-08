// routes/userRoutes.js
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Load = require("../models/Load");
const auth = require("../middlewares/authMiddleware");

const router = express.Router();
const { getIO } = require('../utils/socket');


// ----------------------
// 1) Signup Route
// ----------------------
router.post("/signup", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists with this email" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      role,
    });

    await newUser.save();

    return res.status(201).json({
      message: "User created successfully",
      user: {
        _id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
      },
    });
  } catch (err) {
    console.error("Error in /signup:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ----------------------
// 2) Login Route
// ----------------------
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email }).select('+password'); 
    console.log("==== LOGIN DEBUG ====");
    console.log("Login email from frontend:", email);
    console.log("Login password from frontend:", password);
    if (!user) {
      console.log("No user found with email", email);
      return res.status(401).json({ error: "Invalid email or password" });
    }
    console.log("User found:", user.email);
    console.log("Stored hash:", user.password);

    const isMatch = await bcrypt.compare(password, user.password);
    console.log("Password match result:", isMatch);

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
// ----------------------
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(user);
  } catch (err) {
    console.error("Error in GET /user/profile:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// ----------------------
// 5) Update User Profile
// ----------------------
router.put("/profile", auth, async (req, res) => {
  try {
    const { name, email, phone, companyName } = req.body; // <-- add new fields
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.name = name || user.name;
    user.email = email || user.email;
    user.phone = phone || user.phone;               // <-- add this line
    user.companyName = companyName || user.companyName; // <-- and this line

    const updatedUser = await user.save();
    res.json({ message: "Profile updated successfully", user: updatedUser });
  } catch (err) {
    console.error("Error in /profile PUT:", err);
    res.status(500).json({ error: "Failed to update profile" });
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
    load.deliveredAt = new Date();        // (add this field to your Load model if desired)
    load.completedBy = user._id;          // For audit trail
    load.assignedTruckId = null;

    await user.save();
    await load.save();

    // 5. Optional: trigger invoice or notification logic here

    // 6. Enrich the updated fleet with assigned load details
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

    // 7. Emit live update (socket.io)
    const io = getIO();
    if (io) io.emit("fleetUpdated", { userId: user._id });

    // 8. Respond
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







// Export the router
module.exports = router;
