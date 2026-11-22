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

/** Shipper posting gate (suspended account; payment method on file unless REQUIRE_SHIPPER_PAYMENT_METHOD=false). null = allowed. */
async function shipperPostingGate(shipperCompanyId) {
  const shipper = await User.findById(shipperCompanyId).select('shipperVerification');
  const sv = shipper?.shipperVerification;
  if (sv?.status === 'suspended') {
    return { status: 403, error: 'Your shipper account is suspended. Contact support.', extra: { verificationStatus: 'suspended' } };
  }
  // Pilot switch: the payment-method requirement depends on Stripe being wired. A suspended account is always blocked.
  if (process.env.REQUIRE_SHIPPER_PAYMENT_METHOD !== 'false' && !sv?.paymentMethodVerified) {
    return {
      status: 403,
      error: 'Add a payment method before posting loads. Go to Settings → Verification to add a card or bank account.',
      extra: { verificationStatus: sv?.status || 'unverified', missingStep: 'payment_method' },
    };
  }
  return null;
}

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
    if (!resp.ok) return null;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOMINATIM_SPACING_MS = 1100; // provider policy: at most 1 request per second

/**
 * Shared by the loads of one multi-load request (bulk, email import): repeated places are looked up once, real lookups are
 * spaced to the provider's 1 request/second policy, and once the time budget is spent the remaining places are NOT looked up.
 */
function makeGeocodeBudget(ms = 20000) {
  return { deadline: Date.now() + ms, nextAt: 0, cache: new Map() };
}

async function geocode(place, budget) {
  if (!budget) return fetchCoords(place);
  const key = String(place).trim().toLowerCase();
  if (budget.cache.has(key)) return budget.cache.get(key);
  const at = Math.max(Date.now(), budget.nextAt);
  if (at >= budget.deadline) return { skipped: true };
  if (at > Date.now()) await sleep(at - Date.now());
  budget.nextAt = Date.now() + NOMINATIM_SPACING_MS;
  const r = await fetchCoords(place);
  budget.cache.set(key, r);
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
async function createPostedLoad({ shipperCompanyId, fields, io, options = {} }) {
  const { gate = true, notify = true, windowOpts = {}, geocodeBudget = null } = options;
  try {
    if (gate) {
      const blocked = await shipperPostingGate(shipperCompanyId);
      if (blocked) return blocked;
    }

    const { title, origin, destination, rate, equipmentType } = fields;
    if (!title || !origin || !destination || !rate || !equipmentType) {
      return { status: 400, error: 'Title, origin, destination, rate and equipmentType are required.' };
    }

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

    // Road miles (bounded by the ORS timeout, never throws; null on any failure or multi-stop).
    const distFields = await loadDistanceFields({
      originLat: originC.lat, originLng: originC.lng,
      destinationLat: destinationC.lat, destinationLng: destinationC.lng,
      stops: fields.stops,
    });

    const load = new Load({
      ...fields,
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

module.exports = { createPostedLoad, shipperPostingGate, makeGeocodeBudget };
