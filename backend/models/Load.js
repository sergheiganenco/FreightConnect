const mongoose = require('mongoose');
const crypto = require('crypto');

const LoadSchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 200 },
  origin: { type: String, required: true, maxlength: 200 },
  originLat: Number,
  originLng: Number,
  destination: { type: String, required: true, maxlength: 200 },
  destinationLat: Number,
  destinationLng: Number,
  rate: { type: Number, required: true },
  // Canonical money field (integer cents). `rate` (float dollars) kept for backward-compat.
  rateCents: { type: Number, default: null },
  // Road miles origin->destination (1 decimal). Null for multi-stop loads or when unknown.
  distanceMiles: { type: Number, default: null },
  distanceSource: { type: String, enum: ['ors', null], default: null },
  equipmentType: { type: String, required: true, maxlength: 100 },
  pickupTimeWindow: {
    start: Date,
    end: Date,
  },
  deliveryTimeWindow: {
    start: Date,
    end: Date,
  },
  loadWeight: Number,
  loadDimensions: {
    length: Number,
    width: Number,
    height: Number,
  },
  commodityType: { type: String, maxlength: 200 },
  commodityCategory: { type: String, maxlength: 200 },
  specialInstructions: { type: String, maxlength: 2000 },
  hazardousMaterial: Boolean,
  hazmatClass: { type: String, maxlength: 50 },
  hazmatPackingGroup: { type: String, maxlength: 50 },
  dangerousGoodsUN: { type: String, maxlength: 50 },
  // The two things a hazmat shipping paper must carry besides class / UN number / packing group
  hazmatShippingName: { type: String, maxlength: 200 },   // proper shipping name
  hazmatEmergencyPhone: { type: String, maxlength: 50 },  // 24-hour emergency response number

  // ── What is physically handed over (printed on the bill of lading) ────────
  pieceCount: Number,                                  // handling units
  packageType: { type: String, maxlength: 50 },        // pallets, cartons, drums ...
  sealNumber: { type: String, maxlength: 40 },         // recorded by the carrier at pickup

  // ── Enterprise / extended fields ──────────────────────────────────────────
  paymentTerms: { type: String, maxlength: 200 },
  termsAcceptedAt: Date, // when the shipper ticked the posting terms for this load
  currency: { type: String, default: 'USD', maxlength: 10 },
  specialHandling: [{ type: String, maxlength: 100 }],
  accessorials: [{ type: String, maxlength: 100 }],
  insuranceRequired: Number,
  cargoValue: Number,
  // 'tender': offered to ONE network carrier at a time (services/tenderService). Never accepted from input directly.
  loadVisibility: { type: String, default: 'public', enum: ['public', 'preferred', 'private', 'tender'] },
  // The current offer of a tender load: the only thing about the tender a carrier may read.
  tender: {
    offeredTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    expiresAt: Date,
  },
  // The shipper's side of the tender (who is in line, who declined). Never selected by default, so it cannot reach a carrier.
  tenderPlan: {
    select: false,
    type: new mongoose.Schema({
      queue: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      position: { type: Number, default: -1 }, // index in queue of the carrier currently offered; -1 = not started
      responseMinutes: Number,
      fallback: { type: String, enum: ['public', 'private'] },
      offeredAt: Date,
      history: [{ _id: false, carrier: mongoose.Schema.Types.ObjectId, outcome: { type: String, enum: ['declined', 'expired', 'skipped', 'cancelled'] }, at: Date, reason: String }],
      result: { type: String, enum: ['exhausted', 'stopped'] },
      endedAt: Date,
    }, { _id: false }),
  },
  allowCarrierBidding: { type: Boolean, default: true },
  expirationDateTime: Date,
  notes: { type: String, maxlength: 2000 },
  carrierInstructions: { type: String, maxlength: 2000 },
  documentsRequired: [{ type: String, maxlength: 100 }],

  // ── Reference numbers ─────────────────────────────────────────────────────
  poNumber: { type: String, maxlength: 200 },
  shipperReferenceNumber: { type: String, maxlength: 200 },
  consigneeReference: { type: String, maxlength: 200 },
  pickupNumber: { type: String, maxlength: 100 },      // the number the shipping dock asks the driver for

  // ── Overweight acknowledgment ─────────────────────────────────────────────
  overweightAcknowledged: { type: Boolean, default: false },
  overweightPermitNumber: { type: String, maxlength: 200 },

  // ── Pickup / delivery facility details ────────────────────────────────────
  pickupFacilityName: { type: String, maxlength: 200 },
  pickupAddress: { type: String, maxlength: 300 },
  pickupContactName: { type: String, maxlength: 200 },
  pickupContactPhone: { type: String, maxlength: 50 },
  deliveryFacilityName: { type: String, maxlength: 200 },
  deliveryAddress: { type: String, maxlength: 300 },
  deliveryContactName: { type: String, maxlength: 200 },
  deliveryContactPhone: { type: String, maxlength: 50 },
  deliveryContactEmail: { type: String, maxlength: 200 }, // the receiver, for sending delivery documents ahead
  pickupHours: { type: String, maxlength: 200 },       // e.g. "Mon-Fri 07:00-15:00, closed 12-13"
  deliveryHours: { type: String, maxlength: 200 },

  status: { type: String, default: 'open', enum: ['open', 'accepted', 'in-transit', 'delivered', 'cancelled', 'disputed', 'resolved'] },
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedTruckId: { type: String, default: null },
  deliveredAt: { type: Date, default: null },
  // Predictive-delay alert idempotency: set once the shipper is warned that the
  // projected ETA has slipped past the delivery window.
  delayAlertSentAt: { type: Date, default: null },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

  // ── Cancellation fields ───────────────────────────────────────────────────
  cancelledBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cancelledByRole: { type: String, enum: ['carrier', 'shipper', 'admin', null], default: null },
  cancelReason:    { type: String, default: null },
  cancelledAt:     { type: Date, default: null },

  // ── Dispute fields ────────────────────────────────────────────────────────
  disputedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  disputedByRole:   { type: String, enum: ['carrier', 'shipper', 'admin', null], default: null },
  disputeReason:    { type: String, default: null },
  disputeType:      { type: String, enum: ['general', 'cargo_damage', 'short_delivery', 'overcharge', 'freight_misdescription', 'payment', 'service', null], default: null },
  disputeClaimCents: { type: Number, default: 0 },
  disputeFiledAt:   { type: Date, default: null },
  disputeResolution: { type: String, enum: ['carrier_fault', 'shipper_fault', 'split', 'dismissed', null], default: null },
  disputeResolvedAt: { type: Date, default: null },
  disputeResolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  disputeNotes:      { type: String, default: null },
  disputeCarrierPayoutPercent: { type: Number, default: null },

  // ── Anti-fraud / trust fields ─────────────────────────────────────────────
  acceptanceFingerprint: {
    carrierId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    at: { type: Date, default: null },
  },
  riskFlags: { type: [String], default: [] },
  paymentAssured: { type: Boolean, default: false },

  // ── AI Agent Flags ────────────────────────────────────────────────────────
  matchNotificationSent: { type: Boolean, default: false },
  autoDispatched:        { type: Boolean, default: false },
  autoDispatchedAt:      { type: Date, default: null },
  autoDispatchScore:     { type: Number, default: null },

  // ── Provenance (how the load entered the platform) ────────────────────────
  source:      { type: String, enum: ['app', 'partner_api', 'edi', 'email'], default: 'app' },
  externalRef: { type: String, default: null, maxlength: 200 }, // the partner/source's own load id (for dedup)

  // ── Auto-generated document paths ─────────────────────────────────────────
  // Paths are relative to backend static serving (e.g. /documents/uploads/xxx.pdf)
  documents: {
    rateConfirmation: { type: String, default: null }, // generated on load accept
    bol:              { type: String, default: null }, // generated on delivery
    pod:              { type: String, default: null }, // uploaded by carrier
    podSignerName:    { type: String, default: null }, // consignee signer captured at delivery
  },

  // ── E-signatures (base64 PNG data URLs) captured at pickup and delivery ─────
  // Embedded into the BOL PDF. NEVER indexed; excluded from load list projections
  // to keep the signature bytes out of high-volume queries.
  pickupSignature: {
    dataUrl:     { type: String, default: null },
    signerName:  { type: String, default: null },
    signedByRole:{ type: String, enum: ['carrier', 'shipper', null], default: null },
    signedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    signedAt:    { type: Date, default: null },
  },
  // The shipper's signature at the dock. Usually taken on the driver's device (capturedBy = the driver's login).
  shipperSignature: {
    dataUrl:     { type: String, default: null },
    signerName:  { type: String, default: null },
    capturedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    capturedByRole: { type: String, enum: ['carrier', 'shipper', null], default: null },
    signedAt:    { type: Date, default: null },
  },
  deliverySignature: {
    dataUrl:     { type: String, default: null },
    signerName:  { type: String, default: null },
    // 'receiver' = signed by the receiving company on its own device through the delivery pass link (no account)
    signedByRole:{ type: String, enum: ['carrier', 'shipper', 'receiver', null], default: null },
    note:        { type: String, default: null, maxlength: 1000 }, // shortage / damage noted by the receiver when signing
    signedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    signedAt:    { type: Date, default: null },
  },

  // ── Contract reference ────────────────────────────────────────────────────
  contractId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', default: null, index: true },
  isContractLoad: { type: Boolean, default: false },

  // ── Reefer / Temperature Control ─────────────────────────────────────────
  reefer: {
    enabled:      { type: Boolean, default: false },
    targetMinC:   Number,   // target range in Celsius
    targetMaxC:   Number,
    alertOnDeviation: { type: Boolean, default: true },
    notes:        { type: String, maxlength: 2000 },   // e.g. "Keep frozen, do not stack"
  },

  // ── Live Carrier Location ─────────────────────────────────────────────────
  carrierLocation: {
    latitude:  Number,
    longitude: Number,
    speed:     Number,          // km/h (optional, from GPS)
    heading:   Number,          // degrees 0-360 (optional)
    accuracy:  Number,          // meters (optional)
    source:    { type: String, enum: ['browser', 'mobile_app', 'eld', 'api', 'owntracks', 'traccar'], default: 'browser' },
    // true only when the fix came from the booked carrier company's own authenticated session or ELD
    // connection; false for bearer-link-token ingest (OwnTracks/OsmAnd). Penalties/late_certain need true.
    authenticated: { type: Boolean, default: false },
    updatedAt: { type: Date, default: null },
    // The latest fix that WAS authenticated as the booked carrier. Written only by authenticated pings (never by
    // bearer-token ingest), so a later unauthenticated ping cannot overwrite it. Cleared with carrierLocation.
    lastAuthenticated: {
      latitude:  Number,
      longitude: Number,
      speed:     Number,
      source:    { type: String, enum: ['browser', 'mobile_app', 'eld', 'api', 'owntracks', 'traccar'] },
      updatedAt: Date,
    },
  },

  // ── Multi-Stop Loads ──────────────────────────────────────────────────────
  stops: [{
    sequence:     { type: Number, required: true },
    type:         { type: String, enum: ['pickup', 'delivery'], required: true },
    address:      { type: String, required: true, maxlength: 300 },
    lat:          Number,
    lng:          Number,
    timeWindow:   { start: Date, end: Date },
    contactName:  { type: String, maxlength: 200 },
    contactPhone: { type: String, maxlength: 50 },
    notes:        { type: String, maxlength: 2000 },
    status: {
      type:    String,
      enum:    ['pending', 'arrived', 'departed', 'skipped'],
      default: 'pending',
    },
    arrivedAt:  Date,
    departedAt: Date,
  }],

  // ── Funded escrow at booking ──────────────────────────────────────────────
  escrowFunded:           { type: Boolean, default: false },
  escrowFundedAt:         { type: Date, default: null },
  escrowPaymentIntentId:  { type: String, default: null },

  // ── Driver assignment (fleet carriers) ────────────────────────────────────
  assignedDriverId:   { type: String, default: null },   // matches User.drivers[].driverId
  assignedDriverName: { type: String, default: null },

  // ── Equipment subtype + endorsement requirements ──────────────────────────
  equipmentSubtype:    { type: String, default: null },  // e.g. 'multi_temp','frozen','produce','tarp','chains','power_only','drop_hook','oversize'
  requiredEndorsements:{ type: [String], default: [] },  // e.g. ['hazmat','tanker','doubles_triples']

  // ── Reconsignment (delivery change mid-transit) ───────────────────────────
  reconsignment: {
    changed:             { type: Boolean, default: false },
    originalDestination: { type: String, default: null },
    newDestination:      { type: String, default: null },
    newDestinationLat:   { type: Number, default: null },
    newDestinationLng:   { type: Number, default: null },
    reason:              { type: String, default: null },
    feeChargedCents:     { type: Number, default: 0 },
    changedAt:           { type: Date, default: null },
    changedBy:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },

  // ── Redelivery (receiver closed / missed / refused) ───────────────────────
  redelivery: {
    required:          { type: Boolean, default: false },
    reason:            { type: String, default: null },   // 'receiver_closed','missed_appointment','refused'
    originalDeliveryAt:{ type: Date, default: null },
    rescheduledFor:    { type: Date, default: null },
    feeChargedCents:   { type: Number, default: 0 },
    count:             { type: Number, default: 0 },
    history: [{
      reason:        String,
      at:            { type: Date, default: Date.now },
      rescheduledFor:Date,
    }],
  },

  // ── Accessorial charges (detention, lumper, TONU, layover, reconsign, redelivery) ──
  accessorialCharges: [{
    type:        { type: String, enum: ['detention','lumper','tonu','layover','reconsignment','redelivery','other'], required: true },
    description: { type: String, default: null },
    amountCents: { type: Number, required: true },
    status:      { type: String, enum: ['pending','approved','rejected','paid'], default: 'pending' },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    requestedAt: { type: Date, default: Date.now },
    approvedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt:  { type: Date, default: null },
    paidAt:      { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    evidenceUrls:[String],

    // ── Detention auto-collect (system-generated charges) ────────────────────
    // `source` distinguishes carrier-requested accessorials from server-authored
    // detention charges. Detention charges are NEVER carrier-creatable: their
    // amount comes only from the DwellEvent's server-computed fee (provenance lock).
    source:       { type: String, enum: ['carrier','system_detention','system_tonu'], default: 'carrier' },
    dwellEventId: { type: mongoose.Schema.Types.ObjectId, ref: 'DwellEvent', default: null },
    // false = the dwell's arrival or departure position was not authenticated (link-token fix or manual check-in).
    // Such a charge still goes to the shipper for approval but is NEVER auto-collected off-session.
    locationVerified: { type: Boolean, default: null },
    // Set by an admin to release an unverified (locationVerified !== true) detention charge for collection/payout.
    adminConfirmedAt: { type: Date, default: null },
    adminConfirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    proposedAt:   { type: Date, default: null },
    // Frozen evidence snapshot shown to the shipper at proposal time.
    evidence: {
      arrivedAt:          { type: Date,   default: null },
      dockInAt:           { type: Date,   default: null },
      dockOutAt:          { type: Date,   default: null },
      departedAt:         { type: Date,   default: null },
      dwellMinutes:       { type: Number, default: 0 },
      freeMinutes:        { type: Number, default: 0 },
      detentionMinutes:   { type: Number, default: 0 },
      detentionRateCents: { type: Number, default: 0 },
      facilityName:       { type: String, default: '' },
      source:             { type: String, default: 'auto' },
    },
    // Hash of the (amount + evidence) the shipper is shown; approval must echo it.
    evidenceHash: { type: String, default: null },
    rejectedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rejectedAt:   { type: Date, default: null },
    // Tamper-evident approval record — this, not the click, is the chargeback defense.
    approvalAudit: {
      approverUserId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      approvedAt:          { type: Date,   default: null },
      amountCentsApproved: { type: Number, default: null },
      evidenceHashShown:   { type: String, default: null },
    },
    // Path B — real shipper collection (off-session card-on-file charge).
    shipperPaymentIntentId: { type: String, default: null },
    shipperPaymentStatus:   { type: String, enum: ['none','requires_action','collected','failed'], default: 'none' },
  }],

  // ── Pickup handshake (anti impersonation / double-brokering) ──────────────
  // `code` is issued to the BOOKED carrier only (GET /loads/:id/pickup-code) and
  // is select:false so no list/detail/populate/lean response can leak it.
  pickupVerification: {
    required:       { type: Boolean, default: false },
    code:           { type: String, select: false },
    verifiedAt:     Date,
    verifiedBy:     { type: String, enum: ['dock_link', 'shipper', 'admin'] },
    failedAttempts: { type: Number, default: 0 },
    lockedAt:       Date,
  },

  // ── Photo evidence at pickup/delivery (append-only; no update path) ───────
  // select:false keeps the bounded array out of list/detail responses; read it via
  // GET /loads/:id/evidence. `file` is a bare stored filename in the PRIVATE
  // load-evidence dir (never client-named, never served statically).
  evidenceRequired: {
    pickup:   { type: Boolean, default: false },
    delivery: { type: Boolean, default: false },
  },
  evidence: {
    type: [{
      stage:    { type: String, enum: ['pickup', 'delivery'], required: true },
      kind:     { type: String, enum: ['cargo', 'seal', 'damage', 'paperwork', 'other'], default: 'cargo' },
      file:     { type: String, required: true },
      mimeType: String,
      sizeBytes: Number,
      sha256:   String,
      capturedAt: Date,
      uploadedAt: { type: Date, default: Date.now },
      uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      companyId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      // Set only on a photo added by the receiving dock through the delivery link (no account):
      // the carrier company the delivery was for. uploadedBy/companyId stay empty on those.
      receiverFor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      latitude: Number,
      longitude: Number,
      accuracyMeters: Number,
      facilityDistanceMiles: { type: Number, default: null },
      sealNumber: String,
      note: String,
      // Set when the load is un-booked: the item belongs to the earlier booking. Kept
      // (dispute record), never counted by the gate, never deletable.
      archived:   { type: Boolean, default: false },
      archivedAt: Date,
    }],
    select: false,
  },

  // ── Pickup no-show prediction (written ONLY by jobs/pickupRiskMonitor + pickup-confirm) ──
  // Belongs to the CURRENT booking: wiped whenever the load is booked or un-booked.
  // `notified` = levels already announced for this booking (idempotency for the monitor).
  // When the CURRENT booking began (set by the pickupLifecycle hook on every booking path). Binds pickup
  // arrivals to this booking: a DwellEvent from an earlier booking by the same carrier does not count.
  bookedAt: Date,
  // The pickup window both parties agreed at booking. Risk evaluation, the release gate and the penalty
  // judge the carrier against THIS, never against a shipper-edited pickupTimeWindow. Set/cleared by the hook.
  bookedWindow: { start: Date, end: Date },
  // A shipper's more-demanding window edit on a booked load waits here until the booked carrier accepts it.
  pickupWindowChange: {
    proposedStart: Date,
    proposedEnd:   Date,
    proposedAt:    Date,
    proposedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status:        { type: String, enum: ['pending', 'accepted', 'declined', 'expired'] },
    respondedAt:   Date,
    respondedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  // Per-booking random nonce bound into the tracker-link token, so a link dies when the load is re-booked.
  trackingNonce: { type: String, select: false },
  // Set by jobs/loadLocator when the geocoder answered 'not found' for a place: the load stays hidden and is not retried.
  locationProblem: {
    field: { type: String, enum: ['origin', 'destination'] },
    place: String,
    reason: String,   // 'not_found' | 'unreachable' (geocoder never answered after repeated tries)
    at:    Date,
  },
  // jobs/loadLocator backoff: failed geocode attempts and the earliest time the next one is allowed.
  // Bumped (by services/loadPostingService.updatePostedLoad) whenever the shipper changes a term a carrier priced the load on.
  // PUT /:id/accept can carry the version the carrier saw; a mismatch refuses the booking (no bait-and-switch).
  // Loads from before the field existed have none and count as 1.
  termsVersion: { type: Number, default: 1 },
  locationAttempts: { type: Number, default: 0 },
  locationNextAttemptAt: { type: Date, default: null },
  pickupRisk: {
    level:      { type: String, enum: ['not_evaluated', 'on_track', 'at_risk', 'late_certain', 'no_show'] },
    reason:      String,
    detail:      { type: mongoose.Schema.Types.Mixed },   // small: the numbers behind the estimate, no coordinates
    evaluatedAt: Date,
    notified:    { type: [String], default: undefined },
    carrierConfirmation: {
      status: { type: String, enum: ['on_my_way', 'cannot_make_it'] },
      at:     Date,
      by:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },
  },

  // ── Automatic check calls (written ONLY by jobs/checkCallMonitor + POST /:id/check-call) ──
  // Belongs to the CURRENT booking: wiped on booking and un-booking (never shown to the next carrier).
  // Writers cap it to the latest 50 ($push + $slice -50).
  checkCalls: {
    type: [{
      type: { type: String, enum: ['en_route_to_pickup', 'at_pickup', 'departed_pickup', 'at_delivery', 'halfway', 'one_hour_out',
        'position_update', 'ask_driver', 'no_response', 'driver_update'], required: true },
      at: { type: Date, required: true },
      message: { type: String, maxlength: 600 },
      etaAt: { type: Date, default: null },
      distanceRemainingMiles: { type: Number, default: null },
      positionAgeMinutes: { type: Number, default: null },
      positionConfirmed: { type: Boolean, default: false },
      source: { type: String, enum: ['auto', 'driver'], default: 'auto' },
      driverStatus: { type: String, enum: ['on_schedule', 'delayed', 'at_facility', 'stopped'] },
      driverNote: { type: String, maxlength: 300 },
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      _id: false,
    }],
    default: undefined,
  },
  // Idempotency for the monitor: milestones already announced, last periodic update, the pending driver ask.
  checkCallState: {
    milestones: { type: [String], default: undefined },
    lastPeriodicAt: Date,
    evaluatedAt: Date,   // oldest-evaluated-first ordering for the job
    ask: { askedAt: Date, answeredAt: Date, noResponseSentAt: Date },
  },
}, { timestamps: true });

// Keep rateCents in sync with rate (so existing code that sets `rate` still works)
LoadSchema.pre('save', function(next) {
  if (this.rate != null && (this.rateCents == null || this.isModified('rate'))) {
    this.rateCents = Math.round(this.rate * 100);
  }
  next();
});

// ── Pickup-code lifecycle — the ONE shared hook for every booking path ──────
// Any findOneAndUpdate/updateOne that books a load (status:'accepted' + acceptedBy:
// direct accept, atomicBookLoad for bids/assign-load/auto-dispatch) issues a fresh
// 6-digit code and clears prior verification. Any update that un-books it
// (status open/cancelled, or acceptedBy:null) clears the code. save() covers the
// doc-based unassign. `required` is never touched here.
const PV = 'pickupVerification';
// An update un-books the load when it sets status open/cancelled, nulls acceptedBy, or $unsets acceptedBy.
function isUnbooking(upd) {
  const u = Object.keys(upd).some(k => k.startsWith('$')) ? upd : { $set: upd };
  const set = u.$set || {};
  return set.status === 'open' || set.status === 'cancelled' || set.acceptedBy === null
    || (!!u.$unset && Object.prototype.hasOwnProperty.call(u.$unset, 'acceptedBy'));
}
function pickupLifecycle(update, win) {
  const u = Object.keys(update).some(k => k.startsWith('$')) ? update : { $set: update };
  const set = u.$set || {};
  const booked = set.status === 'accepted' && set.acceptedBy;
  const unbooked = isUnbooking(u);
  if (!booked && !unbooked) return update;
  u.$set = set;
  u.$unset = u.$unset || {};
  set[`${PV}.failedAttempts`] = 0;
  // Risk state and the last GPS fix belong to ONE booking; never carry them to the next carrier.
  u.$unset.pickupRisk = 1;
  u.$unset.checkCalls = 1; u.$unset.checkCallState = 1; // one booking's check calls never reach the next carrier
  u.$unset.carrierLocation = 1;
  for (const f of ['verifiedAt', 'verifiedBy', 'lockedAt']) u.$unset[`${PV}.${f}`] = 1;
  u.$unset.pickupWindowChange = 1;
  if (booked) {
    set[`${PV}.code`] = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); set.bookedAt = new Date();
    set.trackingNonce = crypto.randomBytes(16).toString('hex');
    u.$unset['tender.expiresAt'] = 1; // a tender offer is answered by booking: if the load is given back, that carrier no longer holds it
    if (win && win.start) set.bookedWindow = { start: win.start, end: win.end }; else u.$unset.bookedWindow = 1;
  } else { u.$unset[`${PV}.code`] = 1; u.$unset.trackingNonce = 1; u.$unset.bookedWindow = 1; set.assignedTruckId = null; } // the truck link belongs to the booking
  return u;
}

// The booking is over: close this load's still-open dwell events WITHOUT recalculating (no dwell, no detention
// fee, no billing); the closedReason marker keeps them out of stats and billing. Never throws.
async function closeOpenDwellEvents(loadId) {
  try {
    await require('./DwellEvent').updateMany(
      { load: loadId, departedAt: null, closedReason: null },
      { $set: { departedAt: new Date(), closedReason: 'cancelled' } }
    );
  } catch (err) { console.error('[load] closing dwell events failed:', err.message); }
}
// The load thread belongs to ONE booking. When the load goes back on the board, the thread is set aside under its own id
// (both parties of that booking keep it), so the next carrier starts a fresh thread and never reads the previous one.
// A cancelled load keeps its thread: nobody else will ever be booked on it.
async function archiveThread(loadId) {
  try {
    const l = await mongoose.model('Load').findById(loadId).select('status acceptedBy').lean();
    if (!l || l.acceptedBy || l.status !== 'open') return;
    await require('../services/loadThread').archiveLoadThread(loadId);
  } catch (err) { console.error('[load] thread archive failed:', err.message); }
}
async function onUnbooked(loadId) { await archiveEvidence(loadId); await closeOpenDwellEvents(loadId); await archiveThread(loadId); }

// Un-booking also archives the photos taken under that booking, so a later booking
// (another carrier, or the same one again) must add its own. Done as a follow-up update
// (post hook) because `evidence.$[e]` errors on legacy loads with no evidence array;
// the guard below skips those. Never throws: a failure is logged, not raised.
async function archiveEvidence(loadId) {
  try {
    await mongoose.model('Load').updateOne(
      { _id: loadId, 'evidence.0': { $exists: true } },
      { $set: { 'evidence.$[e].archived': true, 'evidence.$[e].archivedAt': new Date() } },
      { arrayFilters: [{ 'e.archived': { $ne: true } }] }
    );
  } catch (err) { console.error('[load] evidence archive failed:', err.message); }
}
for (const op of ['findOneAndUpdate', 'updateOne']) {
  LoadSchema.pre(op, async function () {
    const upd = this.getUpdate() || {};
    const set = (Object.keys(upd).some(k => k.startsWith('$')) ? upd.$set : upd) || {};
    if (isUnbooking(upd)) {
      try { this._archiveId = (await this.model.findOne(this.getFilter()).select('_id').lean())?._id; } catch (_) {}
    }
    let win = null;
    if (set.status === 'accepted' && set.acceptedBy) {
      try { win = set.pickupTimeWindow || (await this.model.findOne(this.getFilter()).select('pickupTimeWindow').lean())?.pickupTimeWindow; } catch (_) {}
    }
    this.setUpdate(pickupLifecycle(upd, win));
  });
  LoadSchema.post(op, async function (res) {
    if (this._archiveId && res && res.matchedCount !== 0) await onUnbooked(this._archiveId);
  });
}
LoadSchema.pre('save', function (next) {
  if (!this.isNew && ((this.isModified('acceptedBy') && !this.acceptedBy)
    || (this.isModified('status') && ['open', 'cancelled'].includes(this.status)))) this.$locals.archiveEvidence = true;
  if (!this.isNew && this.isModified('acceptedBy') && !this.acceptedBy && this.pickupVerification) {
    this.pickupVerification.code = undefined;
    this.pickupVerification.verifiedAt = undefined;
    this.pickupVerification.verifiedBy = undefined;
    this.pickupVerification.lockedAt = undefined;
    this.pickupVerification.failedAttempts = 0;
  }
  if (!this.isNew && this.isModified('acceptedBy') && !this.acceptedBy) {
    this.pickupRisk = undefined;
    this.carrierLocation = undefined;
    this.checkCalls = undefined;
    this.checkCallState = undefined;
    this.bookedWindow = undefined;
    this.pickupWindowChange = undefined;
    this.trackingNonce = undefined;
    this.assignedTruckId = null;
  }
  next();
});
LoadSchema.post('save', async function () {
  if (this.$locals.archiveEvidence) { this.$locals.archiveEvidence = false; await onUnbooked(this._id); }
});

// Indexes for common query patterns
LoadSchema.index({ status: 1, createdAt: -1 });
LoadSchema.index({ postedBy: 1, status: 1 });
LoadSchema.index({ acceptedBy: 1, status: 1 });
LoadSchema.index({ equipmentType: 1, status: 1 });
LoadSchema.index({ status: 1, equipmentType: 1 });
LoadSchema.index({ 'pickupTimeWindow.start': 1 });
// pickupRiskMonitor: accepted loads whose pickup start falls in a time range.
LoadSchema.index({ status: 1, 'pickupTimeWindow.start': 1 });
LoadSchema.index({ status: 1, 'bookedWindow.start': 1 });
// checkCallMonitor: booked/in-transit loads, oldest-evaluated first.
LoadSchema.index({ status: 1, 'checkCallState.evaluatedAt': 1, _id: 1 });
// tenderMonitor: open tender loads whose offer has run out; carrier board: the load offered to me.
LoadSchema.index({ loadVisibility: 1, status: 1, 'tender.expiresAt': 1 });
LoadSchema.index({ 'tender.offeredTo': 1, status: 1 }, { sparse: true });
LoadSchema.index({ originLat: 1, originLng: 1 });
LoadSchema.index({ destinationLat: 1, destinationLng: 1 });
// Dedup partner/EDI/email-ingested loads per poster+external id (sparse: app loads have none).
LoadSchema.index({ postedBy: 1, externalRef: 1 }, { sparse: true });

module.exports = mongoose.model('Load', LoadSchema);

