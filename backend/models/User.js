const mongoose = require('mongoose');
const { Schema } = mongoose;

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

const DocumentInfoSchema = new Schema({
  url: String,        // Location of uploaded file
  uploaded: Boolean,  // Was the file uploaded?
  name: String        // Original filename
}, { _id: false });

const UserSchema = new mongoose.Schema({
  // -- Basic User Profile --
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ['carrier', 'shipper', 'admin'], required: true },
  phone: String,
  companyName: String,
  mcNumber: String,
  dotNumber: String,

  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },

  // -- For Carrier Accounts Only --
  fleet: [TruckSchema],

  // -- Universal/Optional Fields --
  location: {
    latitude: Number,
    longitude: Number,
  },

  // -- Document Management by Role --
  documents: {
    type: Map,
    of: DocumentInfoSchema,
    default: {}
  },

  // ── Stripe / Payments ───────────────────────────────────────────
  stripe: {
    // Carriers: Stripe Connect Express account for receiving payouts
    connectAccountId:     String,
    connectOnboardingDone:{ type: Boolean, default: false },
    connectPayoutsEnabled:{ type: Boolean, default: false },
    // Shippers: Stripe Customer for card-on-file
    customerId: String,
  },

  // ── Carrier Preferences (for smart matching) ────────────────────
  preferences: {
    equipmentTypes: [{ type: String }],   // e.g. ['Dry Van', 'Flatbed']
    preferredLanes: [{                     // origin → destination pairs
      origin: String,
      destination: String,
    }],
    preferredRegions: [{ type: String }], // e.g. ['Southeast', 'Midwest']
    minRate: { type: Number, default: 0 }, // minimum $ rate willing to accept
    maxMileage: Number,                   // max trip distance in miles
    homeBase: {
      city: String,
      state: String,
      latitude: Number,
      longitude: Number,
    },
  },

  // ── Carrier Verification ────────────────────────────────────────
  verification: {
    status: {
      type: String,
      enum: ['unverified', 'pending', 'verified', 'suspended', 'rejected'],
      default: 'unverified',
    },
    mcNumber: String,
    dotNumber: String,
    fmcsaData: {
      legalName: String,
      dbaName: String,
      entityType: String,
      operatingStatus: String,
      safetyRating: String,
      lastChecked: Date,
    },
    insurance: {
      cargoLiability: { amount: Number, policyNumber: String, expiry: Date, underwriter: String },
      autoLiability: { amount: Number, policyNumber: String, expiry: Date, underwriter: String },
      lastChecked: Date,
      status: { type: String, enum: ['valid', 'expiring', 'lapsed', 'unknown'], default: 'unknown' },
    },
    identityVerified: { type: Boolean, default: false },
    documentsOnFile: [{
      docType: {
        type: String,
        enum: ['w9', 'coi', 'authority_letter', 'equipment_list', 'business_license'],
      },
      filename: String,
      uploadedAt: { type: Date, default: Date.now },
      verified: { type: Boolean, default: false },
      expiresAt: Date,
    }],
    verifiedAt: Date,
  },

  // ── Shipper Verification ────────────────────────────────────────
  shipperVerification: {
    businessVerified: { type: Boolean, default: false },
    dunsNumber: String,
    creditTier: { type: String, enum: ['A', 'B', 'C', 'D', 'unrated'], default: 'unrated' },
    paymentMethodVerified: { type: Boolean, default: false },
    stripeCustomerId: String,
  },

  // ── Trust Score ─────────────────────────────────────────────────
  trustScore: {
    score: { type: Number, default: 50, min: 0, max: 100 },
    onTimeRate: { type: Number, default: 100 },
    cancellationRate: { type: Number, default: 0 },
    claimsCount: { type: Number, default: 0 },
    disputeResolutionRate: { type: Number, default: 100 },
    totalLoadsCompleted: { type: Number, default: 0 },
    lastCalculated: Date,
    history: [{
      score: Number,
      reason: String,
      change: Number,
      date: { type: Date, default: Date.now },
    }],
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});



// Export the model
module.exports = mongoose.model('User', UserSchema);
