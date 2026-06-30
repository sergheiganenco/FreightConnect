/**
 * seedPilotLoad.js — No-money golden-path pilot seeder
 * ----------------------------------------------------
 * Creates everything a real driver needs to test the FULL operational flow
 * (see load → accept → in-transit → live GPS tracking → POD → delivered)
 * WITHOUT any money/escrow involved.
 *
 * It creates / updates (idempotent — safe to re-run):
 *   1. A SHIPPER company + user  (this is YOU, who posted the load)
 *   2. A CARRIER company + user  (this is the DRIVER — hand them these creds)
 *      - pre-verified, with 1 truck, ToS accepted → can accept loads immediately
 *   3. One OPEN load             (mimics the driver's real current load)
 *
 * HOW TO USE:
 *   1. Edit the CONFIG block below with the driver's real load + a login for them.
 *   2. From the backend folder:   node scripts/seedPilotLoad.js
 *   3. It prints the login credentials + load id + next steps.
 *
 * IMPORTANT for a multi-day test — disable the auto-reopen job so the accepted
 * load isn't released after 24h of "unfunded escrow":
 *   set ESCROW_FUND_DEADLINE_HOURS=999 in backend/.env before starting the server.
 *
 * Payments are OFF automatically when STRIPE_SECRET_KEY is not set — ignore any
 * "Stripe not configured" logs; they do not affect tracking or the golden path.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const User = require('../models/User');
const Company = require('../models/Company');
const Load = require('../models/Load');
const companyNormalize = require('../utils/companyNormalize');

// ════════════════════════════════════════════════════════════════════════
// CONFIG — edit this with the driver's real current load + their login
// ════════════════════════════════════════════════════════════════════════
const CONFIG = {
  // --- The DRIVER's login (give these to the driver for the mobile/web app) ---
  driver: {
    name:        'Pilot Driver',
    email:       'driver@pilot.test',
    password:    'Pilot1234!',          // they log in with this
    companyName: 'Pilot Carrier LLC',
  },

  // --- The SHIPPER login (this is YOU, watching the load) ---
  shipper: {
    name:        'Pilot Shipper',
    email:       'shipper@pilot.test',
    password:    'Pilot1234!',
    companyName: 'Pilot Shipper Co',
  },

  // --- The LOAD (mimic the driver's real current load) ---
  load: {
    origin:        'Houston, TX',
    destination:   'Dallas, TX',
    equipmentType: 'Dry Van',           // Dry Van | Reefer | Flatbed | ...
    rate:          1200,                // dollars (display only — no money moves)
    loadWeight:    35000,               // lbs
    commodityType: 'General Freight',
    // Coordinates: leave null to auto-geocode from the city names (needs internet),
    // or fill them in (look up at https://www.latlong.net or Google Maps right-click).
    originLat:        null,
    originLng:        null,
    destinationLat:   null,
    destinationLng:   null,
    // Pickup/delivery windows (hours from now)
    pickupInHours:   2,
    deliveryInHours: 24,
  },
};
// ════════════════════════════════════════════════════════════════════════

async function geocode(place) {
  // Free OpenStreetMap Nominatim (no key). Best-effort; returns {lat,lng} or null.
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'FreightConnect-Pilot-Seeder' } });
    const data = await res.json();
    if (Array.isArray(data) && data[0]) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
  } catch (_) { /* fall through */ }
  return null;
}

async function upsertCompany(name, type) {
  const normalized = companyNormalize(name);
  let company = await Company.findOne({ normalized });
  if (!company) {
    company = new Company({ name, type, status: 'active' }); // pre-save hook sets `normalized`
    await company.save();
  }
  return company;
}

async function upsertUser(spec, companyId, extra) {
  const hashed = await bcrypt.hash(spec.password, 10);
  const base = {
    name: spec.name,
    password: hashed,
    companyName: spec.companyName,
    companyId,
    emailVerified: true,
    // ToS guard: must match CURRENT_TOS_VERSION ('1.0') or every /api call is 403
    tosAccepted: true,
    tosAcceptedAt: new Date(),
    tosVersion: '1.0',
    tosIpAddress: '127.0.0.1',
    mfa: { enabled: false, secret: null, verifiedAt: null },
    ...extra,
  };
  let user = await User.findOne({ email: spec.email });
  if (user) {
    Object.assign(user, base);
    await user.save();
  } else {
    user = await User.create({ email: spec.email, ...base });
  }
  return user;
}

async function run() {
  if (!process.env.MONGO_URI) {
    console.error('✗ MONGO_URI not set (backend/.env). Aborting.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log('• Connected to MongoDB');

  // 1) Companies
  const shipperCompany = await upsertCompany(CONFIG.shipper.companyName, 'shipper');
  const carrierCompany = await upsertCompany(CONFIG.driver.companyName, 'carrier');

  // 2) Shipper user (verified shipper, payment method "on file" is irrelevant — no money)
  const shipper = await upsertUser(CONFIG.shipper, shipperCompany._id, {
    role: 'shipper',
    shipperVerification: {
      status: 'verified',
      businessName: CONFIG.shipper.companyName,
      // Set true so the shipper can POST loads in a no-money pilot. The app blocks
      // posting without a payment method on file (a real "Payment Assured" trust gate).
      paymentMethodVerified: true,
      creditTier: 'unrated',
      verifiedAt: new Date(),
    },
  });

  // 3) Carrier user (DRIVER) — pre-verified + 1 truck so they can accept immediately.
  //    Truck status MUST be one of the capitalized enum values ('Available').
  const yearFromNow = new Date(Date.now() + 365 * 86400000);
  const carrier = await upsertUser(CONFIG.driver, carrierCompany._id, {
    role: 'carrier',
    mcNumber: 'MC-PILOT',
    dotNumber: 'DOT-PILOT',
    fleet: [{ truckId: 'TRK-PILOT-1', status: 'Available', available: true }],
    verification: {
      status: 'verified',
      mcNumber: 'MC-PILOT',
      dotNumber: 'DOT-PILOT',
      fmcsaData: { legalName: CONFIG.driver.companyName, operatingStatus: 'AUTHORIZED FOR PROPERTY', lastChecked: new Date() },
      insurance: {
        cargoLiability: { amount: 100000, policyNumber: 'PILOT-CARGO', expiry: yearFromNow, underwriter: 'Pilot Insurer' },
        autoLiability:  { amount: 1000000, policyNumber: 'PILOT-AUTO', expiry: yearFromNow, underwriter: 'Pilot Insurer' },
        status: 'valid',
        lastChecked: new Date(),
      },
      identityVerified: true,
      verifiedAt: new Date(),
    },
  });

  // 4) Resolve coordinates (needed for the map + tracking)
  const L = CONFIG.load;
  let o = (L.originLat != null && L.originLng != null) ? { lat: L.originLat, lng: L.originLng } : await geocode(L.origin);
  let d = (L.destinationLat != null && L.destinationLng != null) ? { lat: L.destinationLat, lng: L.destinationLng } : await geocode(L.destination);
  if (!o) { console.warn(`⚠ Could not geocode origin "${L.origin}". Fill originLat/originLng in CONFIG.`); o = { lat: 0, lng: 0 }; }
  if (!d) { console.warn(`⚠ Could not geocode destination "${L.destination}". Fill destinationLat/destinationLng in CONFIG.`); d = { lat: 0, lng: 0 }; }

  // 5) Replace any prior pilot load for this shipper, then create a fresh OPEN load
  await Load.deleteMany({ postedBy: shipper._id, title: { $regex: /^\[PILOT\]/ } });
  const now = Date.now();
  const load = await Load.create({
    title: `[PILOT] ${L.origin} → ${L.destination}`,
    origin: L.origin,
    originLat: o.lat,
    originLng: o.lng,
    destination: L.destination,
    destinationLat: d.lat,
    destinationLng: d.lng,
    rate: L.rate,
    equipmentType: L.equipmentType,
    loadWeight: L.loadWeight,
    commodityType: L.commodityType,
    status: 'open',
    postedBy: shipper._id,
    pickupTimeWindow:   { start: new Date(now + L.pickupInHours * 3600000),   end: new Date(now + (L.pickupInHours + 2) * 3600000) },
    deliveryTimeWindow: { start: new Date(now + L.deliveryInHours * 3600000), end: new Date(now + (L.deliveryInHours + 4) * 3600000) },
    hazardousMaterial: false,
    requiredEndorsements: [],
  });

  // Done — print the cheat sheet
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  ✓ PILOT DATA READY (no money — golden-path test)');
  console.log('══════════════════════════════════════════════════════════');
  console.log('\n  DRIVER login (give to the driver — mobile or web):');
  console.log(`    email:    ${CONFIG.driver.email}`);
  console.log(`    password: ${CONFIG.driver.password}`);
  console.log('\n  SHIPPER login (you — watch the load):');
  console.log(`    email:    ${CONFIG.shipper.email}`);
  console.log(`    password: ${CONFIG.shipper.password}`);
  console.log('\n  LOAD:');
  console.log(`    id:     ${load._id}`);
  console.log(`    lane:   ${L.origin}  →  ${L.destination}`);
  console.log(`    coords: (${o.lat}, ${o.lng}) → (${d.lat}, ${d.lng})`);
  console.log(`    status: open  (driver accepts it to begin)`);
  console.log('\n  NEXT: follow PILOT_GUIDE.md.');
  console.log('  TIP: set ESCROW_FUND_DEADLINE_HOURS=999 in backend/.env so the');
  console.log('       accepted load is not auto-reopened during a multi-day test.\n');

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error('✗ Seed failed:', err.message);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
