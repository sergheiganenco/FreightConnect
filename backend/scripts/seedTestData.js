/**
 * seedTestData.js — Creates test accounts + sample loads for local testing
 *
 * Usage: cd backend && node scripts/seedTestData.js
 *
 * Creates:
 *   - 1 verified carrier (MC/DOT, insurance, W-9 all good)
 *   - 1 verified shipper (payment method, EIN, email verified)
 *   - 1 admin
 *   - 5 sample open loads
 *   - 1 accepted load (carrier accepted shipper's load)
 *
 * All passwords: Test1234!
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function seed() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI not set in .env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  const User = require('../models/User');
  const Load = require('../models/Load');

  const password = await bcrypt.hash('Test1234!', 12);

  // ── Clean existing test data ──────────────────────────────────────────────
  await User.deleteMany({ email: { $in: ['carrier@test.com', 'shipper@test.com', 'admin@test.com'] } });
  await Load.deleteMany({ title: { $regex: /^\[TEST\]/ } });
  console.log('Cleaned existing test data');

  // ── Create Carrier ────────────────────────────────────────────────────────
  const carrier = await User.create({
    name: 'Test Carrier',
    email: 'carrier@test.com',
    password,
    role: 'carrier',
    companyName: 'Test Trucking LLC',
    verification: {
      status: 'verified',
      mcNumber: 'MC-123456',
      dotNumber: '1234567',
      fmcsaData: {
        legalName: 'Test Trucking LLC',
        operatingStatus: 'AUTHORIZED FOR PROPERTY',
        lastChecked: new Date(),
      },
      insurance: {
        cargoLiability: { amount: 100000, policyNumber: 'CARGO-001', expiry: new Date(Date.now() + 365 * 86400000), underwriter: 'Test Insurer' },
        autoLiability: { amount: 1000000, policyNumber: 'AUTO-001', expiry: new Date(Date.now() + 365 * 86400000), underwriter: 'Test Insurer' },
        status: 'valid',
        lastChecked: new Date(),
      },
      documentsOnFile: [
        { docType: 'coi', filename: 'test_coi.pdf', verified: true },
        { docType: 'w9', filename: 'test_w9.pdf', verified: true },
      ],
      verifiedAt: new Date(),
    },
    trustScore: {
      score: 75,
      onTimeRate: 96,
      totalLoadsCompleted: 15,
      cancellationRate: 1,
      claimsCount: 0,
    },
    fleet: [
      { truckId: 'TRK-001', make: 'Freightliner', model: 'Cascadia', year: 2022, vin: '1FVHG3DV8N1234567', licensePlate: 'TX-ABC123', equipmentType: 'Dry Van', status: 'available' },
      { truckId: 'TRK-002', make: 'Kenworth', model: 'T680', year: 2023, vin: '2NKHHM6X3P2345678', licensePlate: 'TX-DEF456', equipmentType: 'Reefer', status: 'available' },
    ],
  });
  console.log(`Created carrier: carrier@test.com (ID: ${carrier._id})`);

  // ── Create Shipper ────────────────────────────────────────────────────────
  const shipper = await User.create({
    name: 'Test Shipper',
    email: 'shipper@test.com',
    password,
    role: 'shipper',
    companyName: 'Test Manufacturing Inc',
    shipperVerification: {
      status: 'verified',
      businessName: 'Test Manufacturing Inc',
      ein: '12-***5678',
      einVerified: true,
      businessVerified: true,
      emailDomainVerified: true,
      emailDomain: 'test.com',
      isFreeEmail: false,
      paymentMethodVerified: true,
      stripeCustomerId: 'cus_test_123',
      paymentMethodLast4: '4242',
      paymentMethodType: 'card',
      creditTier: 'A',
      firstLoadEscrowRequired: false,
      firstLoadCompleted: true,
      verifiedAt: new Date(),
    },
    trustScore: {
      score: 70,
      onTimeRate: 100,
      totalLoadsCompleted: 10,
      cancellationRate: 0,
    },
  });
  console.log(`Created shipper: shipper@test.com (ID: ${shipper._id})`);

  // ── Create Admin ──────────────────────────────────────────────────────────
  const admin = await User.create({
    name: 'Admin User',
    email: 'admin@test.com',
    password,
    role: 'admin',
    companyName: 'FreightConnect',
  });
  console.log(`Created admin: admin@test.com (ID: ${admin._id})`);

  // ── Create Sample Loads ───────────────────────────────────────────────────
  const lanes = [
    { origin: 'Houston, TX', dest: 'Dallas, TX', oLat: 29.76, oLng: -95.37, dLat: 32.78, dLng: -96.80, rate: 1200, equip: 'Dry Van' },
    { origin: 'Los Angeles, CA', dest: 'Phoenix, AZ', oLat: 34.05, oLng: -118.24, dLat: 33.45, dLng: -112.07, rate: 1800, equip: 'Reefer' },
    { origin: 'Chicago, IL', dest: 'Memphis, TN', oLat: 41.88, oLng: -87.63, dLat: 35.15, dLng: -90.05, rate: 2200, equip: 'Dry Van' },
    { origin: 'Atlanta, GA', dest: 'Jacksonville, FL', oLat: 33.75, oLng: -84.39, dLat: 30.33, dLng: -81.66, rate: 950, equip: 'Flatbed' },
    { origin: 'Denver, CO', dest: 'Kansas City, MO', oLat: 39.74, oLng: -104.99, dLat: 39.10, dLng: -94.58, rate: 1600, equip: 'Dry Van' },
  ];

  const now = new Date();
  for (const lane of lanes) {
    await Load.create({
      title: `[TEST] ${lane.origin} → ${lane.dest}`,
      origin: lane.origin,
      destination: lane.dest,
      originLat: lane.oLat,
      originLng: lane.oLng,
      destinationLat: lane.dLat,
      destinationLng: lane.dLng,
      rate: lane.rate,
      equipmentType: lane.equip,
      status: 'open',
      postedBy: shipper._id,
      pickupTimeWindow: {
        start: new Date(now.getTime() + 24 * 3600000),
        end: new Date(now.getTime() + 26 * 3600000),
      },
      deliveryTimeWindow: {
        start: new Date(now.getTime() + 48 * 3600000),
        end: new Date(now.getTime() + 72 * 3600000),
      },
      loadWeight: 35000 + Math.floor(Math.random() * 10000),
    });
  }
  console.log('Created 5 open loads');

  // ── Create 1 accepted load ────────────────────────────────────────────────
  await Load.create({
    title: '[TEST] Miami, FL → Nashville, TN (Accepted)',
    origin: 'Miami, FL',
    destination: 'Nashville, TN',
    originLat: 25.76,
    originLng: -80.19,
    destinationLat: 36.16,
    destinationLng: -86.78,
    rate: 2800,
    equipmentType: 'Dry Van',
    status: 'accepted',
    postedBy: shipper._id,
    acceptedBy: carrier._id,
    pickupTimeWindow: {
      start: new Date(now.getTime() + 12 * 3600000),
      end: new Date(now.getTime() + 14 * 3600000),
    },
    deliveryTimeWindow: {
      start: new Date(now.getTime() + 36 * 3600000),
      end: new Date(now.getTime() + 48 * 3600000),
    },
    loadWeight: 42000,
  });
  console.log('Created 1 accepted load');

  console.log('\n=== SEED COMPLETE ===');
  console.log('Test accounts (all passwords: Test1234!):');
  console.log('  Carrier: carrier@test.com');
  console.log('  Shipper: shipper@test.com');
  console.log('  Admin:   admin@test.com');

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
