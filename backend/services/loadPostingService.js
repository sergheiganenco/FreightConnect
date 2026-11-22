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
const { parseWindow } = require('../utils/windowValidation');
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

    // Same strict ISO + end>=start rule as the dedicated window endpoints; checked before any outside call.
    let pickupTimeWindow, deliveryTimeWindow;
    try {
      pickupTimeWindow = parseWindow(fields.pickupTimeWindow, 'pickupTimeWindow', windowOpts);
      deliveryTimeWindow = parseWindow(fields.deliveryTimeWindow, 'deliveryTimeWindow', windowOpts);
    } catch (e) { return { status: 400, error: e.message }; }

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
    });
    await load.save();

    // Without coordinates the load cannot be booked; carrier lists hide it until it is located.
    const needsLocation = !(hasCoords(originC) && hasCoords(destinationC));
    if (notify) runSideEffects(load, shipperCompanyId, io).catch(() => {}); // non-blocking
    return { load, needsLocation };
  } catch (err) {
    if (err.name === 'ValidationError') return { status: 400, error: err.message };
    console.error('Error saving load:', err);
    return { status: 500, error: 'Failed to post load.' };
  }
}

module.exports = { createPostedLoad, shipperPostingGate, makeGeocodeBudget, geocode, POSTABLE_FIELDS, MAX_UNLOCATED_PER_COMPANY, _spacing: spacing };
