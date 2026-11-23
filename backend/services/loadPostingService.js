/**
 * The ONE way to create a posted (open) load from anything other than a trusted internal copy:
 *   gate -> required fields -> windows -> geocode -> road distance -> create -> side effects.
 * Used by POST /loads, EDI create-load, enterprise bulk + email import, and the contract auto-post job,
 * so a load posted from any path meets the same bar as one posted from the form.
 *
 * createPostedLoad never throws for expected problems: it returns { load, needsLocation } or { status, error, extra? }.
 */
const fetch = require('node-fetch');
const Load = require('../models/Load');
const User = require('../models/User');
const PreferredCarrier = require('../models/PreferredCarrier');
const { parseWindow, windowProblem } = require('../utils/windowValidation');
const { loadDistanceFields } = require('./routingService');
const { notifyUserSafe } = require('../utils/notifyUser');

const hasCoords = (o) => Number.isFinite(o?.lat) && Number.isFinite(o?.lng);
const MAX_UNLOCATED_PER_COMPANY = 200;
const missingNum = { $not: { $type: 'number' } };
const UNLOCATED = [{ originLat: missingNum }, { originLng: missingNum }, { destinationLat: missingNum }, { destinationLng: missingNum }];

/** Shipper posting gate (suspended account; payment method on file unless REQUIRE_SHIPPER_PAYMENT_METHOD=false). null = allowed. */
async function shipperPostingGate(shipperCompanyId, { requirePaymentMethod = true } = {}) {
  let shipper = await User.findById(shipperCompanyId).select('shipperVerification parentAccountId active');
  // Defence in depth: if a sub-account id reaches here, judge the company owner.
  if (shipper?.parentAccountId) {
    shipper = await User.findById(shipper.parentAccountId).select('shipperVerification active');
  }
  if (!shipper || shipper.active === false) {
    return { status: 403, error: 'This shipper account is not active.', extra: { verificationStatus: 'inactive' } };
  }
  const sv = shipper.shipperVerification;
  if (sv?.status === 'suspended') {
    return { status: 403, error: 'Your shipper account is suspended. Contact support.', extra: { verificationStatus: 'suspended' } };
  }
  // Pilot switch: the payment-method requirement depends on Stripe being wired. A suspended account is always blocked.
  if (requirePaymentMethod && process.env.REQUIRE_SHIPPER_PAYMENT_METHOD !== 'false' && !sv?.paymentMethodVerified) {
    return {
      status: 403,
      error: 'Add a payment method before posting loads. Go to Settings → Verification to add a card or bank account.',
      extra: { verificationStatus: sv?.status || 'unverified', missingStep: 'payment_method' },
    };
  }
  return null;
}

const REJECTED_STATUSES = [400, 404, 414, 422];

// Nominatim requires a valid User-Agent or it returns "Access denied".
async function fetchCoords(location) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(location)}`,
      { headers: { 'User-Agent': 'FreightConnect/1.0 (loads@freightconnect.app)' }, signal: ctrl.signal }
    );
    clearTimeout(t);
    // Only statuses about the QUERY STRING mean "this place does not exist" (400, 404, 414, 422). Everything else that is not OK
    // (401/403 blocked agent or IP, 407, 408, 425, 429, 5xx, 3xx...) is about us or the provider: an outage, retried later.
    if (!resp.ok) return REJECTED_STATUSES.includes(resp.status) ? { notFound: true, reason: 'rejected' } : null;
    const data = await resp.json();
    // The geocoder answered and found nothing: the place name is wrong. That is different from an outage.
    if (Array.isArray(data) && !data.length) return { notFound: true };
    if (!Array.isArray(data)) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch (geoErr) {
    console.warn(`[loads] geocode failed for "${location}" (non-fatal):`, geoErr.message);
    return null; // post the load anyway; coordinates can be filled later
  }
}

// Free-text caps. No pre-existing length limits anywhere (express-validator on POST /loads only checks non-empty),
// so these are generous: places/titles 200, short ids/names/phones 200, addresses 300, instructions/notes 2000.
const MAX_PLACE = 200;
const TEXT_CAPS = {
  title: 200, specialInstructions: 2000, notes: 2000, carrierInstructions: 2000,
  equipmentType: 100, commodityType: 200, commodityCategory: 200, paymentTerms: 200, currency: 10,
  hazmatClass: 50, hazmatPackingGroup: 50, dangerousGoodsUN: 50,
  poNumber: 200, shipperReferenceNumber: 200, consigneeReference: 200, externalRef: 200,
  pickupFacilityName: 200, pickupAddress: 300, pickupContactName: 200, pickupContactPhone: 50,
  deliveryFacilityName: 200, deliveryAddress: 300, deliveryContactName: 200, deliveryContactPhone: 50,
  overweightPermitNumber: 200,
};
// Array-of-string fields (form option lists; the longest option is 34 characters) and multi-stop limits.
const ARRAY_FIELDS = ['specialHandling', 'accessorials', 'documentsRequired'];
const MAX_ARRAY_ITEMS = 20;
const MAX_ITEM_LEN = 100;
const MAX_STOPS = 20;
const STOP_TEXT_CAPS = { address: 300, contactName: 200, contactPhone: 50, notes: 2000 };
const STOP_TYPES = ['pickup', 'delivery']; // Load.stops[].type enum
// [min, max]. The form lets weight be 8 digits and cargo value / insurance 12; equipment limits top out at 48,000 lbs and
// heavier loads are allowed with an overweight permit, so weight is bounded at a superload (500,000 lbs), not at a truck.
const NUM_BOUNDS = { rate: [0, 1000000], loadWeight: [0, 500000], cargoValue: [0, 1e9], insuranceRequired: [0, 1e9] };
const DIMENSION_BOUNDS = [0, 999999]; // the form allows 6 digits per dimension
const REEFER_TEMP_C = [-40, 40];
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// A number, or a non-blank numeric string (bulk/EDI callers pass strings; Mongoose casts them). Anything else is NaN.
const toNum = (v) => (typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN));
const outside = (n, [min, max]) => !Number.isFinite(n) || n < min || n > max;

/** Error message for an unacceptable posted field, or null. */
function badFieldMessage(fields) {
  for (const [key, label] of [['origin', 'Origin'], ['destination', 'Destination']]) {
    const v = fields[key];
    if (typeof v !== 'string' || !v.trim()) return `${label} must be a non-empty text value.`;
    if (v.length > MAX_PLACE) return `${label} must be ${MAX_PLACE} characters or fewer.`;
    if (CONTROL_CHARS.test(v)) return `${label} contains invalid characters.`;
  }
  for (const [key, max] of Object.entries(TEXT_CAPS)) {
    const v = fields[key];
    if (v == null) continue;
    if (typeof v !== 'string') return `${key} must be text.`;
    if (v.length > max) return `${key} must be ${max} characters or fewer.`;
  }
  for (const key of ARRAY_FIELDS) {
    const v = fields[key];
    if (v == null) continue;
    if (!Array.isArray(v) || v.length > MAX_ARRAY_ITEMS || v.some((x) => typeof x !== 'string' || x.length > MAX_ITEM_LEN)) {
      return `${key} must be a list of at most ${MAX_ARRAY_ITEMS} text items of ${MAX_ITEM_LEN} characters or fewer.`;
    }
  }
  for (const [key, bounds] of Object.entries(NUM_BOUNDS)) {
    const v = fields[key];
    if (v == null || v === '') continue;
    if (outside(toNum(v), bounds)) return `${key} must be a number between ${bounds[0]} and ${bounds[1]}.`;
  }
  const dims = fields.loadDimensions;
  if (dims != null) {
    if (typeof dims !== 'object' || Array.isArray(dims)) return 'loadDimensions must be an object.';
    for (const k of ['length', 'width', 'height']) {
      if (dims[k] != null && dims[k] !== '' && outside(toNum(dims[k]), DIMENSION_BOUNDS)) return `loadDimensions.${k} must be a number between ${DIMENSION_BOUNDS[0]} and ${DIMENSION_BOUNDS[1]}.`;
    }
  }
  const reefer = fields.reefer;
  if (reefer != null) {
    if (typeof reefer !== 'object' || Array.isArray(reefer)) return 'reefer must be an object.';
    if (reefer.notes != null && (typeof reefer.notes !== 'string' || reefer.notes.length > 2000)) return 'reefer.notes must be text of 2000 characters or fewer.';
    for (const k of ['targetMinC', 'targetMaxC']) {
      if (reefer[k] != null && (typeof reefer[k] !== 'number' || outside(reefer[k], REEFER_TEMP_C))) return `reefer.${k} must be a temperature between ${REEFER_TEMP_C[0]} and ${REEFER_TEMP_C[1]} C.`;
    }
  }
  if (fields.stops != null) {
    if (!Array.isArray(fields.stops) || fields.stops.length > MAX_STOPS) return `stops must be a list of at most ${MAX_STOPS} stops.`;
    for (const st of fields.stops) {
      if (!st || typeof st !== 'object' || Array.isArray(st)) return 'Each stop must be an object.';
      if (st.type != null && !STOP_TYPES.includes(st.type)) return `Each stop type must be one of: ${STOP_TYPES.join(', ')}.`;
      for (const [k, max] of Object.entries(STOP_TEXT_CAPS)) {
        if (st[k] == null) continue;
        if (typeof st[k] !== 'string') return `Stop ${k} must be text.`;
        if (st[k].length > max) return `Stop ${k} must be ${max} characters or fewer.`;
      }
    }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOMINATIM_SPACING_MS = 1100; // provider policy: at most 1 request per second

// Process-wide provider slot: EVERY real lookup (single post, bulk, locator job) takes the next free slot, so concurrent
// requests cannot exceed the provider's policy together. A lookup that would wait longer than maxWaitMs is not made (an
// outage: the load posts with needsLocation and the locator job picks it up). Tests inject now/sleep and spacingMs
// (GEOCODE_SPACING_MS=0 in __tests__/env.js keeps the other suites fast).
const spacing = {
  ms: Number(process.env.GEOCODE_SPACING_MS ?? NOMINATIM_SPACING_MS), maxWaitMs: 5000, nextAt: 0,
  now: () => Date.now(), sleep,
};

/**
 * Shared by the loads of one multi-load request (bulk, email import): repeated places are looked up once, real lookups are
 * spaced to the provider's 1 request/second policy, and once the time budget is spent the remaining places are NOT looked up.
 */
function makeGeocodeBudget(ms = 20000) {
  return { deadline: Date.now() + ms, cache: new Map() };
}

async function geocode(place, budget) {
  const key = String(place).trim().toLowerCase();
  if (budget?.cache.has(key)) return budget.cache.get(key);
  const now = spacing.now();
  const at = Math.max(now, spacing.nextAt);
  // Over the request's budget (bulk) or past the longest acceptable wait (single post): do not look it up.
  if (budget ? at >= budget.deadline : at - now > spacing.maxWaitMs) return budget ? { skipped: true } : null;
  spacing.nextAt = at + spacing.ms; // claimed synchronously, so concurrent callers queue behind each other
  if (at > now) await spacing.sleep(at - now);
  const r = await fetchCoords(place);
  if (budget) budget.cache.set(key, r);
  return r;
}

async function runSideEffects(load, shipperCompanyId, io) {
  try {
    const preferred = await PreferredCarrier.find({ shipper: shipperCompanyId, isActive: true }).populate('carrier', 'name email');
    for (const pc of preferred) {
      await notifyUserSafe(pc.carrier._id, {
        type: 'load:preferred',
        title: 'New load from a shipper who prefers you!',
        body: `${load.origin} → ${load.destination} · $${Number(load.rate).toLocaleString()} · ${load.equipmentType}`,
        link: '/dashboard/carrier/loads',
        metadata: { loadId: load._id, tier: pc.tier, firstLookHours: pc.firstLookHours },
      });
    }
  } catch (err) {
    console.error('[PreferredCarrier] Notification failed (non-fatal):', err.message);
  }
  require('./matchingService').notifyMatchedCarriers(load, io); // never throws
}

/**
 * @param {object} p
 * @param {string} p.shipperCompanyId  the posting company (owner id)
 * @param {object} p.fields            Load fields (schema names). pickupTimeWindow/deliveryTimeWindow are raw { start, end }.
 *                                     originLat/originLng/destinationLat/destinationLng are used when given, else geocoded.
 * @param {object} [p.io]              Socket.IO server for match notifications
 * @param {object} [p.options]         gate (default true), notify (default true), windowOpts ({requireZone}), geocodeBudget
 */
// The ONLY fields a caller may set on a new load. Everything about the load's
// lifecycle (status, carrier, booking, risk, location, evidence, signatures,
// charges, documents, payment state) is decided by the server, never accepted
// from input - whatever route or job calls this.
const POSTABLE_FIELDS = [
  'title', 'origin', 'destination', 'rate', 'equipmentType', 'loadWeight', 'loadDimensions',
  'commodityType', 'commodityCategory', 'specialInstructions', 'specialHandling', 'accessorials',
  'hazardousMaterial', 'hazmatClass', 'hazmatPackingGroup', 'dangerousGoodsUN',
  'insuranceRequired', 'cargoValue', 'paymentTerms', 'currency', 'loadVisibility', 'allowCarrierBidding',
  'expirationDateTime', 'notes', 'carrierInstructions', 'documentsRequired',
  'poNumber', 'shipperReferenceNumber', 'consigneeReference', 'externalRef', 'source',
  'pickupFacilityName', 'pickupAddress', 'pickupContactName', 'pickupContactPhone',
  'deliveryFacilityName', 'deliveryAddress', 'deliveryContactName', 'deliveryContactPhone',
  'overweightAcknowledged', 'overweightPermitNumber', 'reefer', 'contractId', 'isContractLoad',
];

function postableFields(fields = {}) {
  const safe = {};
  for (const k of POSTABLE_FIELDS) if (fields[k] !== undefined) safe[k] = fields[k];
  // Requirement flags only - never a code, a verification time or stored evidence.
  safe.pickupVerification = { required: fields.pickupVerification?.required === true };
  safe.evidenceRequired = {
    pickup: fields.evidenceRequired?.pickup === true,
    delivery: fields.evidenceRequired?.delivery === true,
  };
  if (Array.isArray(fields.stops)) {
    safe.stops = fields.stops.map((st, i) => ({
      sequence: st.sequence ?? i + 1,
      type: st.type || 'delivery',
      address: st.address,
      lat: Number.isFinite(Number(st.lat)) && st.lat != null ? Number(st.lat) : undefined,
      lng: Number.isFinite(Number(st.lng)) && st.lng != null ? Number(st.lng) : undefined,
      timeWindow: st.timeWindow || {},
      contactName: st.contactName || undefined,
      contactPhone: st.contactPhone || undefined,
      notes: st.notes || undefined,
      status: 'pending',
    }));
  }
  return safe;
}

async function createPostedLoad({ shipperCompanyId, fields, io, options = {} }) {
  const { gate = true, notify = true, windowOpts = {}, geocodeBudget = null } = options;
  try {
    // `gate: false` (bulk routes that already ran the full gate once, and internal
    // contract posts) skips only the payment-method requirement. A suspended or
    // inactive shipper can never post through any path.
    const blocked = await shipperPostingGate(shipperCompanyId, { requirePaymentMethod: gate });
    if (blocked) return blocked;

    const { title, origin, destination, rate, equipmentType } = fields;
    if (!title || !origin || !destination || !rate || !equipmentType) {
      return { status: 400, error: 'Title, origin, destination, rate and equipmentType are required.' };
    }

    const bad = badFieldMessage(fields);
    if (bad) return { status: 400, error: bad };

    // Auto-tender is asked for through options.tender only (the single-post route); the visibility value is never taken from input.
    if (fields.loadVisibility === 'tender') return { status: 400, error: 'loadVisibility must be public, preferred or private.' };
    let tenderPlan = null;
    if (options.tender != null) {
      const t = await require('./tenderService').buildPlan(shipperCompanyId, options.tender);
      if (t.error) return { status: 400, error: t.error };
      tenderPlan = t.plan;
    }

    // Same strict ISO + end>=start rule as the dedicated window endpoints; checked before any outside call.
    let pickupTimeWindow, deliveryTimeWindow;
    try {
      pickupTimeWindow = parseWindow(fields.pickupTimeWindow, 'pickupTimeWindow', windowOpts);
      deliveryTimeWindow = parseWindow(fields.deliveryTimeWindow, 'deliveryTimeWindow', windowOpts);
    } catch (e) { return { status: 400, error: e.message }; }
    const windowError = windowProblem(pickupTimeWindow, deliveryTimeWindow, { checkPast: true });
    if (windowError) return { status: 400, error: windowError };

    // Prefer supplied coordinates; otherwise best-effort geocode (an outage must NOT block posting).
    const originC = (fields.originLat && fields.originLng)
      ? { lat: Number(fields.originLat), lng: Number(fields.originLng) }
      : (await geocode(origin, geocodeBudget)) || {};
    const destinationC = (fields.destinationLat && fields.destinationLng)
      ? { lat: Number(fields.destinationLat), lng: Number(fields.destinationLng) }
      : (await geocode(destination, geocodeBudget)) || {};
    // The geocoder answered and found nothing: a load with no coordinates can never be accepted, so refuse it.
    for (const [label, place, c] of [['pickup', origin, originC], ['delivery', destination, destinationC]]) {
      if (c.notFound) {
        return { status: 400, error: `We couldn't find the ${label} location "${place}". Enter it as City, ST (for example "Austin, TX").` };
      }
    }

    // A load saved without coordinates waits for the locator job and is hidden from carriers; one company may not pile up
    // unbounded numbers of them (loads that geocode fine are unaffected). Uses the {postedBy, status} index.
    if (!(hasCoords(originC) && hasCoords(destinationC))) {
      const waiting = await Load.countDocuments({ postedBy: shipperCompanyId, status: 'open', $or: UNLOCATED }, { limit: MAX_UNLOCATED_PER_COMPANY });
      if (waiting >= MAX_UNLOCATED_PER_COMPANY) {
        return { status: 429, error: `You already have ${MAX_UNLOCATED_PER_COMPANY} open loads waiting for a location lookup. Cancel loads whose locations were not recognised, or wait for the pending ones to be located, then post again.` };
      }
    }

    // Road miles (bounded by the ORS timeout, never throws; null on any failure or multi-stop).
    // In a budgeted (bulk) request the same deadline covers routing: once it has
    // passed, skip the call and leave road miles to the on-demand backfill.
    const overBudget = geocodeBudget && Date.now() >= geocodeBudget.deadline;
    const distFields = overBudget ? {} : await loadDistanceFields({
      originLat: originC.lat, originLng: originC.lng,
      destinationLat: destinationC.lat, destinationLng: destinationC.lng,
      stops: fields.stops,
    });

    const load = new Load({
      ...postableFields(fields),
      status: 'open',
      originLat: originC.lat, originLng: originC.lng,
      destinationLat: destinationC.lat, destinationLng: destinationC.lng,
      ...distFields,
      pickupTimeWindow, deliveryTimeWindow,
      // Ownership is the company, never a caller-supplied value.
      postedBy: shipperCompanyId,
      ...(tenderPlan ? { loadVisibility: 'tender', tenderPlan } : {}),
    });
    await load.save();

    // Without coordinates the load cannot be booked; carrier lists hide it until it is located.
    const needsLocation = !(hasCoords(originC) && hasCoords(destinationC));
    if (tenderPlan) {
      // Nobody is alerted but the first carrier in line. An unlocated load starts its tender once the locator job places it (jobs/tenderMonitor).
      if (!needsLocation) await require('./tenderService').advance(load._id, { expectPosition: -1 }).catch((e) => console.error('[tender] start failed:', e.message));
      return { load: await Load.findById(load._id), needsLocation };
    }
    if (notify) runSideEffects(load, shipperCompanyId, io).catch(() => {}); // non-blocking
    return { load, needsLocation };
  } catch (err) {
    if (err.name === 'ValidationError') return { status: 400, error: err.message };
    console.error('Error saving load:', err);
    return { status: 500, error: 'Failed to post load.' };
  }
}

// ── Editing an OPEN load ─────────────────────────────────────────────────────────────────────────────────────────
// What a shipper may change after posting: the postable fields minus provenance (source / contract / external ref),
// plus the windows, stops and requirement flags. Anything else in the body is ignored.
const EDIT_EXCLUDED = ['source', 'contractId', 'isContractLoad', 'externalRef'];
const EDITABLE_FIELDS = POSTABLE_FIELDS.filter((k) => !EDIT_EXCLUDED.includes(k));
const WINDOW_FIELDS = ['pickupTimeWindow', 'deliveryTimeWindow'];
const BOOLEAN_FIELDS = ['hazardousMaterial', 'allowCarrierBidding', 'overweightAcknowledged'];
// Everything a shipper can edit is MATERIAL (bumps termsVersion, voids open bids) unless it is listed here:
// labels and contacts that do not change what a carrier priced or planned the load on.
const COSMETIC_FIELDS = [
  'title', 'notes', 'poNumber', 'shipperReferenceNumber', 'consigneeReference',
  'pickupFacilityName', 'pickupContactName', 'pickupContactPhone',
  'deliveryFacilityName', 'deliveryContactName', 'deliveryContactPhone',
];
const REQUIRED_FIELDS = ['title', 'origin', 'destination', 'rate', 'equipmentType'];
const NOT_EDITABLE = { status: 409, error: 'This load can no longer be edited' };
const sidesOf = [
  { key: 'origin', label: 'pickup', lat: 'originLat', lng: 'originLng' },
  { key: 'destination', label: 'delivery', lat: 'destinationLat', lng: 'destinationLng' },
];
const { versionIs } = require('./bookingGuard');

// Stable form of a value for "did it change": dates by time, empty/undefined dropped, stop bookkeeping ignored.
function canon(v) {
  if (v instanceof Date) return v.getTime();
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) {
      if (['_id', 'status', 'arrivedAt', 'departedAt', 'lat', 'lng', 'sequence'].includes(k) && 'address' in v) continue; // stop bookkeeping
      const c = canon(v[k]);
      if (c !== undefined && c !== null && c !== '') o[k] = c; // (false is already canon'd to undefined: false == absent)
    }
    return o;
  }
  return v === '' || v === false ? undefined : v;
}
const sameValue = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/**
 * Edit an OPEN load the shipper company owns. Same bar as posting (gate, field bounds, windows, geocode), one atomic
 * conditional write (a concurrent accept wins cleanly), and a material change bumps termsVersion and voids open bids.
 * Never throws for expected problems: returns { load, needsLocation, materialChange, voidedBids } or { status, error }.
 */
async function updatePostedLoad({ loadId, shipperCompanyId, fields, io }) {
  try {
    const blocked = await shipperPostingGate(shipperCompanyId, { requirePaymentMethod: false });
    if (blocked) return blocked;

    const cur = await Load.findOne({ _id: loadId, postedBy: shipperCompanyId });
    if (!cur) return { status: 404, error: 'Load not found' };
    if (cur.status !== 'open') return NOT_EDITABLE;

    fields = fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {};
    const raw = {};
    for (const k of EDITABLE_FIELDS) if (fields[k] !== undefined) raw[k] = typeof fields[k] === 'string' ? fields[k].trim() : fields[k];
    for (const k of BOOLEAN_FIELDS) if (raw[k] != null && typeof raw[k] !== 'boolean') return { status: 400, error: `${k} must be true or false.` };
    if (fields.stops !== undefined) raw.stops = fields.stops === null ? [] : fields.stops;
    // Hazmat details only mean something on a hazmat load (the posting form drops them the same way).
    if (raw.hazardousMaterial === false) Object.assign(raw, { hazmatClass: null, hazmatPackingGroup: null, dangerousGoodsUN: null });
    for (const k of REQUIRED_FIELDS) if (raw[k] !== undefined && !raw[k]) return { status: 400, error: `${k} is required.` };

    // Validate what changes, plus the two places (always required text).
    const bad = badFieldMessage({ origin: cur.origin, destination: cur.destination, ...raw });
    if (bad) return { status: 400, error: bad };
    // A tender is started only at posting. Choosing another visibility on a tender load ends the tender.
    if (raw.loadVisibility === 'tender' && cur.loadVisibility !== 'tender') return { status: 400, error: 'loadVisibility must be public, preferred or private.' };
    if (raw.rate !== undefined && !(toNum(raw.rate) > 0)) return { status: 400, error: 'Rate must be a positive number.' };
    if ((cur.contractId || cur.isContractLoad) && raw.rate !== undefined && toNum(raw.rate) !== cur.rate) {
      return { status: 400, error: 'The rate of a contract load is set by the contract.' };
    }

    // Time windows: same strict parse as posting. An empty window clears it.
    for (const k of WINDOW_FIELDS) {
      if (fields[k] === undefined) continue;
      try { raw[k] = parseWindow(fields[k], k) ?? null; } catch (e) { return { status: 400, error: e.message }; }
    }
    // The windows as they would be after this edit must still make sense; a pickup time is checked against the clock only when it changes.
    if (WINDOW_FIELDS.some((k) => raw[k] !== undefined)) {
      const after = (k) => (raw[k] !== undefined ? raw[k] : cur[k]);
      // Re-sending the window a load already has (the edit form sends every field) is not a change.
      const ms = (w) => `${w?.start ? new Date(w.start).getTime() : ''}/${w?.end ? new Date(w.end).getTime() : ''}`;
      const pickupMoved = raw.pickupTimeWindow != null && ms(raw.pickupTimeWindow) !== ms(cur.pickupTimeWindow);
      const windowError = windowProblem(after('pickupTimeWindow'), after('deliveryTimeWindow'), { checkPast: pickupMoved });
      if (windowError) return { status: 400, error: windowError };
    }

    // Requirement flags only (never a code or stored evidence); a flag changes only when it is sent.
    const set = {};
    if (fields.pickupVerification && fields.pickupVerification.required !== undefined) set['pickupVerification.required'] = fields.pickupVerification.required === true;
    for (const k of ['pickup', 'delivery']) {
      if (fields.evidenceRequired && fields.evidenceRequired[k] !== undefined) set[`evidenceRequired.${k}`] = fields.evidenceRequired[k] === true;
    }
    if (Array.isArray(raw.stops)) raw.stops = postableFields({ stops: raw.stops }).stops;
    else if (raw.stops !== undefined) return { status: 400, error: 'stops must be a list.' };

    // Cast through the schema once: yields the exact stored values, flags bad types/enums/lengths, and lets us compare like with like.
    const unset = {};
    const toSet = {};
    for (const [k, v] of Object.entries(raw)) (v === null || v === '' ? unset : toSet)[k] = v;
    const probe = new Load(toSet);
    const invalid = probe.validateSync(Object.keys(toSet));
    if (invalid) return { status: 400, error: invalid.message };
    const casted = probe.toObject();
    for (const k of Object.keys(toSet)) set[k] = casted[k];
    for (const k of Object.keys(unset)) unset[k] = 1;
    if (set.rate !== undefined) set.rateCents = Math.round(set.rate * 100);

    const before = cur.toObject();
    const was = (k) => k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), before);
    // Write only real differences: a value a stale client merely echoes back must never overwrite a newer edit.
    for (const k of Object.keys(set)) if (sameValue(was(k), set[k])) delete set[k];
    for (const k of Object.keys(unset)) if (sameValue(was(k), undefined)) delete unset[k];
    const changed = (k) => k in set || k in unset;
    const materialChange = [...Object.keys(set), ...Object.keys(unset)].some((k) => !COSMETIC_FIELDS.includes(k));

    // Location: a side is re-resolved when its text changed, coordinates were supplied (as posting accepts them), or it
    // was flagged as not found. Not found / outage leaves the side unlocated for the locator job, and hides the load.
    const budget = makeGeocodeBudget();
    const finalC = {};
    let geoDirty = changed('stops');
    for (const s of sidesOf) {
      // Supplied coordinates are taken only together with a new place name (a material change) or to fill a side that
      // has none: never to silently move an unchanged, already-located place.
      const supplied = fields[s.lat] != null && fields[s.lng] != null && (changed(s.key) || !hasCoords({ lat: cur[s.lat], lng: cur[s.lng] }));
      const dirty = changed(s.key) || supplied || cur.locationProblem?.field === s.key;
      finalC[s.key] = { lat: cur[s.lat], lng: cur[s.lng] };
      if (!dirty) continue;
      geoDirty = true;
      const c = supplied ? { lat: Number(fields[s.lat]), lng: Number(fields[s.lng]) } : (await geocode(set[s.key] ?? cur[s.key], budget)) || {};
      if (supplied && !(Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180)) return { status: 400, error: `The ${s.label} coordinates are out of range.` };
      if (hasCoords(c)) { set[s.lat] = c.lat; set[s.lng] = c.lng; finalC[s.key] = c; } else { unset[s.lat] = 1; unset[s.lng] = 1; finalC[s.key] = {}; }
      Object.assign(set, { locationAttempts: 0, locationNextAttemptAt: null });
      unset.locationProblem = 1;
    }
    const locatedAfter = hasCoords(finalC.origin) && hasCoords(finalC.destination);
    const locatedBefore = hasCoords({ lat: cur.originLat, lng: cur.originLng }) && hasCoords({ lat: cur.destinationLat, lng: cur.destinationLng });
    if (!locatedAfter && locatedBefore) {
      const waiting = await Load.countDocuments({ postedBy: shipperCompanyId, status: 'open', _id: { $ne: cur._id }, $or: UNLOCATED }, { limit: MAX_UNLOCATED_PER_COMPANY });
      if (waiting >= MAX_UNLOCATED_PER_COMPANY) {
        return { status: 429, error: `You already have ${MAX_UNLOCATED_PER_COMPANY} open loads waiting for a location lookup. Cancel loads whose locations were not recognised, or wait for the pending ones to be located, then try again.` };
      }
    }
    if (geoDirty) {
      const d = locatedAfter
        ? await loadDistanceFields({ originLat: finalC.origin.lat, originLng: finalC.origin.lng, destinationLat: finalC.destination.lat, destinationLng: finalC.destination.lng, stops: set.stops ?? (unset.stops ? [] : before.stops) })
        : { distanceMiles: null, distanceSource: null };
      Object.assign(set, d);
    }
    for (const k of Object.keys(set)) delete unset[k]; // a path is either set or unset

    if (cur.loadVisibility === 'tender' && set.loadVisibility) {
      unset.tender = 1;
      Object.assign(set, { 'tenderPlan.result': 'stopped', 'tenderPlan.endedAt': new Date() });
    }
    const nextVersion = (cur.termsVersion || 1) + 1;
    if (materialChange) set.termsVersion = nextVersion;
    const upd = { $set: set };
    if (Object.keys(unset).length) upd.$unset = unset;
    if (!Object.keys(set).length && !upd.$unset) return { load: cur, needsLocation: !locatedBefore, materialChange: false, voidedBids: 0 };

    // ONE conditional write: still ours, still open (a concurrent accept makes this match nothing) and still on the
    // version we read (no edit is ever applied on top of terms it did not see).
    const filter = { _id: cur._id, postedBy: shipperCompanyId, status: 'open', termsVersion: versionIs(cur.termsVersion || 1) };
    const updated = await Load.findOneAndUpdate(filter, upd, { new: true });
    if (!updated) {
      const again = await Load.findOne({ _id: cur._id, postedBy: shipperCompanyId }).select('status');
      if (again && again.status === 'open') return { status: 409, error: 'This load was just changed. Reload it and try again.' };
      return again ? NOT_EDITABLE : { status: 404, error: 'Load not found' };
    }

    let voidedBids = 0;
    if (materialChange) voidedBids = await voidBidsAfterChange(updated);
    try { io.to(`user_${shipperCompanyId}`).emit('load:updated', { loadId: String(updated._id), termsVersion: updated.termsVersion }); } catch (_) { /* owner room only: the load may be private */ }
    return { load: updated, needsLocation: !locatedAfter, materialChange, voidedBids };
  } catch (err) {
    if (err.name === 'ValidationError' || err.name === 'CastError') return { status: 400, error: err.message };
    console.error('Error updating load:', err);
    return { status: 500, error: 'Failed to update load.' };
  }
}

// The terms changed under open bids: reject them and tell each carrier company to look again.
async function voidBidsAfterChange(load) {
  try {
    const Bid = require('../models/Bid');
    const live = { loadId: load._id, status: { $in: ['pending', 'countered'] } };
    const bids = await Bid.find(live).select('carrierId').lean();
    if (!bids.length) return 0;
    await Bid.updateMany({ _id: { $in: bids.map((b) => b._id) }, status: { $in: ['pending', 'countered'] } }, {
      $set: { status: 'rejected' },
      $push: { history: { actor: 'shipper', action: 'rejected', note: 'Load terms changed' } },
    });
    for (const carrierId of new Set(bids.map((b) => String(b.carrierId)))) {
      await notifyUserSafe(carrierId, {
        type: 'bid:voided',
        title: 'Load terms changed',
        body: `The shipper changed "${load.title}". Your bid was withdrawn: review the new details and bid again.`,
        link: '/dashboard/carrier/loads',
        metadata: { loadId: String(load._id), termsVersion: load.termsVersion },
      });
    }
    return bids.length;
  } catch (err) {
    console.error('[updatePostedLoad] voiding bids failed:', err.message);
    return 0;
  }
}

module.exports = { createPostedLoad, updatePostedLoad, voidBidsAfterChange, shipperPostingGate, makeGeocodeBudget, geocode, POSTABLE_FIELDS, MAX_UNLOCATED_PER_COMPANY, _spacing: spacing };
