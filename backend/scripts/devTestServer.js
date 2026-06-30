/**
 * devTestServer.js — self-contained running instance for E2E/Playwright testing.
 * Starts an in-memory MongoDB, seeds a shipper + carrier (both ready to use),
 * then boots the real app on :5000. No real database touched, no Stripe.
 *
 * Run:  node scripts/devTestServer.js     (keep it running)
 *
 * Logins created:
 *   Shipper: shipper@pilot.test / Pilot1234!
 *   Carrier: driver@pilot.test  / Pilot1234!
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

async function seed() {
  const User = require('../models/User');
  const Company = require('../models/Company');
  const Load = require('../models/Load');

  const yearFromNow = new Date(Date.now() + 365 * 86400000);
  const hashed = await bcrypt.hash('Pilot1234!', 10);
  const tos = { tosAccepted: true, tosAcceptedAt: new Date(), tosVersion: '1.0', tosIpAddress: '127.0.0.1' };

  const shipperCo = await new Company({ name: 'Pilot Shipper Co', type: 'shipper', status: 'active' }).save();
  const carrierCo = await new Company({ name: 'Pilot Carrier LLC', type: 'carrier', status: 'active' }).save();

  const shipper = await User.create({
    name: 'Pilot Shipper', email: 'shipper@pilot.test', password: hashed, role: 'shipper',
    companyName: 'Pilot Shipper Co', companyId: shipperCo._id,
    emailVerified: true, onboardingComplete: true, mfa: { enabled: false },
    shipperVerification: { status: 'verified', businessName: 'Pilot Shipper Co', paymentMethodVerified: true, verifiedAt: new Date() },
    ...tos,
  });

  const carrier = await User.create({
    name: 'Pilot Driver', email: 'driver@pilot.test', password: hashed, role: 'carrier',
    companyName: 'Pilot Carrier LLC', companyId: carrierCo._id, mcNumber: 'MC-PILOT', dotNumber: 'DOT-PILOT',
    emailVerified: true, onboardingComplete: true, mfa: { enabled: false },
    fleet: [{ truckId: 'TRK-PILOT-1', status: 'Available', available: true }],
    verification: {
      status: 'verified', mcNumber: 'MC-PILOT', dotNumber: 'DOT-PILOT',
      fmcsaData: { legalName: 'Pilot Carrier LLC', operatingStatus: 'AUTHORIZED FOR PROPERTY', lastChecked: new Date() },
      insurance: {
        cargoLiability: { amount: 100000, policyNumber: 'PILOT-CARGO', expiry: yearFromNow, underwriter: 'Pilot Insurer' },
        autoLiability: { amount: 1000000, policyNumber: 'PILOT-AUTO', expiry: yearFromNow, underwriter: 'Pilot Insurer' },
        status: 'valid', lastChecked: new Date(),
      },
      identityVerified: true, verifiedAt: new Date(),
    },
    ...tos,
  });

  // Admin user (to test admin pages)
  await User.create({
    name: 'Pilot Admin', email: 'admin@pilot.test', password: hashed, role: 'admin',
    emailVerified: true, onboardingComplete: true, mfa: { enabled: false }, ...tos,
  });

  const now = Date.now();
  // 1) An OPEN load (for the load board / accept flow)
  await Load.create({
    title: '[SEED] Houston, TX → Dallas, TX', origin: 'Houston, TX', originLat: 29.7589, originLng: -95.3677,
    destination: 'Dallas, TX', destinationLat: 32.7767, destinationLng: -96.7970,
    rate: 1200, equipmentType: 'Dry Van', loadWeight: 35000, commodityType: 'General Freight',
    status: 'open', postedBy: shipper._id,
    pickupTimeWindow: { start: new Date(now + 2 * 3600000), end: new Date(now + 4 * 3600000) },
    deliveryTimeWindow: { start: new Date(now + 24 * 3600000), end: new Date(now + 28 * 3600000) },
    hazardousMaterial: false, requiredEndorsements: [],
  });

  // 2) An ACCEPTED load assigned to the carrier (so My Loads / Documents / Payments have content)
  await Load.create({
    title: '[SEED] Memphis, TN → Nashville, TN', origin: 'Memphis, TN', originLat: 35.1495, originLng: -90.0490,
    destination: 'Nashville, TN', destinationLat: 36.1627, destinationLng: -86.7816,
    rate: 850, equipmentType: 'Dry Van', loadWeight: 28000, commodityType: 'General Freight',
    status: 'accepted', postedBy: shipper._id, acceptedBy: carrier._id, assignedTruckId: 'TRK-PILOT-1',
    pickupTimeWindow: { start: new Date(now - 6 * 3600000), end: new Date(now - 4 * 3600000) },
    deliveryTimeWindow: { start: new Date(now + 6 * 3600000), end: new Date(now + 10 * 3600000) },
    acceptanceFingerprint: { carrierId: carrier._id, ip: '127.0.0.1', userAgent: 'seed', at: new Date() },
    hazardousMaterial: false, requiredEndorsements: [],
  });

  console.log('[devTestServer] Seeded shipper + driver + admin + 1 open + 1 accepted load');
}

(async () => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  process.env.JWT_SECRET = 'dev-test-server-secret-key-long-enough-0123456789abcdef';
  process.env.PORT = '5000';
  process.env.NODE_ENV = 'development';
  process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
  process.env.ESCROW_FUND_DEADLINE_HOURS = '999';

  await mongoose.connect(process.env.MONGO_URI);
  await seed();
  require('../app'); // boots the real server on :5000 (reuses the existing mongoose connection)
  console.log('[devTestServer] App booting on http://localhost:5000 — keep this process running');
})().catch((err) => {
  console.error('[devTestServer] FAILED:', err);
  process.exit(1);
});
