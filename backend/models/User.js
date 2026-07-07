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

  // ── Company sub-accounts ──────────────────────────────────────────────────
  // Every account belongs to a company. The account that signed up is the
  // 'owner'; owners can create 'dispatcher' and 'driver' sub-accounts that log
  // in with their own credentials but act on behalf of the same company. A
  // sub-account's parentAccountId points at its owner; owners have it null.
  companyRole: { type: String, enum: ['owner', 'dispatcher', 'driver'], default: 'owner' },
  parentAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  // Deactivated accounts cannot log in (used to disable a dispatcher/driver).
  active: { type: Boolean, default: true },

  // -- For Carrier Accounts Only --
  fleet: [TruckSchema],

  // ── Driver roster (embedded, consistent with fleet[] pattern) ─────────────
  drivers: [{
    driverId:        { type: String, required: true },
    name:            { type: String, required: true },
    phone:           String,
    licenseNumber:   String,
    licenseState:    String,
    licenseExpiry:   Date,
    endorsements:    { type: [String], default: [] }, // ['hazmat','tanker','doubles_triples','passenger','school_bus']
    hazmatExpiry:    Date,
    medicalCardExpiry: Date,
    status:          { type: String, enum: ['active','inactive','on_leave'], default: 'active' },
    assignedTruckId: { type: String, default: null },
    createdAt:       { type: Date, default: Date.now },
  }],

  // ── Carrier-level (company authority) endorsements ────────────────────────
  carrierEndorsements: { type: [String], default: [] },

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
    // Shippers: saved payment method for OFF-SESSION (merchant-initiated) charges
    // such as approved accessorials/detention. Captured at escrow funding when the
    // card is saved with setup_future_usage='off_session'.
    defaultPaymentMethodId: String,
    // Mandate the shipper accepted authorizing post-load variable accessorial
    // charges (detention/lumper/layover). Required before any off-session charge.
    accessorialMandate: {
      acceptedAt: { type: Date, default: null },
      version:    { type: String, default: null },
      ip:         { type: String, default: null },
    },
  },

  // ── GPS tracking consent (privacy) ──────────────────────────────
  // Drivers/carriers must explicitly consent before their background location
  // is ingested or geofenced. Purpose-limited to load tracking, detention
  // documentation, and ETA. Consent is revocable.
  tracking: {
    gpsConsent: {
      granted:   { type: Boolean, default: false },
      grantedAt: { type: Date, default: null },
      version:   { type: String, default: null },
      ip:        { type: String, default: null },
      revokedAt: { type: Date, default: null },
    },
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
    autoDispatch: { type: Boolean, default: false }, // shipper opt-in for AI auto-dispatch
  },

  // ── AI Risk Scoring (populated by CarrierRiskAgent) ─────────────
  riskScore: { type: Number, default: null, min: 0, max: 100 },
  riskDetails: { type: mongoose.Schema.Types.Mixed, default: null },

  // ── Carrier Verification ────────────────────────────────────────
  verification: {
    status: {
      type: String,
      enum: ['unverified', 'pending', 'verified', 'suspended', 'rejected'],
      default: 'unverified',
    },
    // Why the account is suspended (set by whichever monitor/actor suspends).
    // Auto-restore paths only reverse their OWN suspensions — e.g. an insurance
    // renewal must never lift a fraud/FMCSA/admin suspension.
    suspensionReason: { type: String, default: null }, // 'insurance' | 'fmcsa_authority' | others
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
    status: {
      type: String,
      enum: ['unverified', 'pending', 'verified', 'suspended', 'rejected'],
      default: 'unverified',
    },
    // Step 1: Business identity
    businessName:     String,
    ein:              String,   // Employer Identification Number (masked: XX-XXX1234)
    einVerified:      { type: Boolean, default: false },
    businessVerified: { type: Boolean, default: false },
    dunsNumber:       String,
    stateOfIncorporation: String,
    businessType:     { type: String, enum: ['llc', 'corporation', 'sole_proprietor', 'partnership', 'other', null], default: null },

    // Step 2: Email domain check
    emailDomainVerified: { type: Boolean, default: false },
    emailDomain:         String,   // extracted from signup email
    isFreeEmail:         { type: Boolean, default: null }, // true if gmail/yahoo/hotmail

    // Step 3: Payment method
    paymentMethodVerified: { type: Boolean, default: false },
    stripeCustomerId:      String,
    paymentMethodLast4:    String,  // last 4 digits of card on file
    paymentMethodType:     String,  // 'card', 'bank_account'

    // Step 4: Credit tier (assessed after first load)
    creditTier: { type: String, enum: ['A', 'B', 'C', 'D', 'unrated'], default: 'unrated' },

    // Step 5: Document uploads (optional but increase tier)
    documentsOnFile: [{
      docType: {
        type: String,
        enum: ['business_license', 'tax_certificate', 'insurance_coi', 'bank_letter'],
      },
      filename: String,
      uploadedAt: { type: Date, default: Date.now },
      verified: { type: Boolean, default: false },
    }],

    // Approval
    verifiedAt:    Date,
    verifiedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // admin who verified
    rejectedAt:    Date,
    rejectionNote: String,

    // First-load escrow requirement
    firstLoadEscrowRequired: { type: Boolean, default: true },
    firstLoadCompleted:      { type: Boolean, default: false },
  },

  // ── Multi-Factor Authentication (TOTP) ──────────────────────────
  mfa: {
    enabled: { type: Boolean, default: false },
    secret:  { type: String, default: null, select: false }, // TOTP secret, hidden by default
    verifiedAt: { type: Date, default: null },
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

  // ── Email Verification & Password Reset ──────────────────────────
  emailVerificationToken: { type: String, default: null, select: false },
  emailVerified: { type: Boolean, default: false },
  passwordResetToken: { type: String, default: null, select: false },
  passwordResetExpires: { type: Date, default: null, select: false },

  // ── First-Run Onboarding ─────────────────────────────────────────
  onboardingComplete: { type: Boolean, default: false },

  // ── Terms of Service Acceptance ──────────────────────────────────
  tosAccepted: { type: Boolean, default: false },
  tosAcceptedAt: { type: Date },
  tosVersion: { type: String },
  tosIpAddress: { type: String },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});



// Indexes for common query patterns (email already unique-indexed via field option)
UserSchema.index({ role: 1 });
UserSchema.index({ 'verification.status': 1 });

// The company an account belongs to, identified by its OWNER's user id.
// Owners resolve to themselves; sub-accounts resolve to their parent.
UserSchema.methods.companyOwnerId = function () {
  return this.parentAccountId || this._id;
};

// Resolve a company owner id from a bare user id without loading the full doc.
// Returns the same id for owners, the parent id for sub-accounts.
UserSchema.statics.companyOwnerIdFor = async function (userId) {
  if (!userId) return null;
  const u = await this.findById(userId).select('parentAccountId').lean();
  if (!u) return String(userId);
  return String(u.parentAccountId || userId);
};

// Export the model
module.exports = mongoose.model('User', UserSchema);
