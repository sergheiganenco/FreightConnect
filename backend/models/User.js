const mongoose = require('mongoose');

// Individual truck schema (for fleets)
const TruckSchema = new mongoose.Schema({
  truckId: {
    type: String,
    required: true
  },
  driverName: String,        // Optional: or driverId for advanced setups
  status: {
    type: String,
    enum: [
      'Available', 'Assigned', 'At Pickup', 'Loading', 'In Transit', 'At Delivery',
      'Delivered', 'Maintenance', 'Offline', 'Unavailable'
    ],
    default: 'Available',
  },
  available: {  // Manual toggle by user (true = available for loads)
    type: Boolean,
    default: true,
  },
  lastStatusUpdate: { // When status or availability was last changed
    type: Date,
    default: Date.now,
  },
  location: {
    latitude: Number,
    longitude: Number,
    updatedAt: Date,
  },
  currentLoadId: {
    type: String,            // Reference to load, or null if idle
    default: null,
  },
  assignedLoadId: { type: String, default: null }, 
  // Add more truck fields as needed
}, { _id: false });           // no separate _id for trucks


const UserSchema = new mongoose.Schema({
  // -- Basic User Profile --
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true, select: false }, // never expose password!
  role: { type: String, enum: ['carrier', 'shipper'], required: true },
  phone: String,
  companyName: String,

  // -- For Carrier Accounts Only --
  fleet: [TruckSchema], // Array of trucks (empty if single-truck owner-operator)

  // -- For Shipper Accounts --
  // (add shipper-specific fields here if needed)

  // -- Universal/Optional Fields --
  location: {
    latitude: Number,
    longitude: Number,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  // Add additional fields as your business grows
});

// Export the model
module.exports = mongoose.model('User', UserSchema);
