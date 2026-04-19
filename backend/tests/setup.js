/**
 * Test Setup — mongodb-memory-server for isolated in-memory testing.
 *
 * Provides:
 *   - In-memory MongoDB via MongoMemoryServer (no real DB needed)
 *   - Mongoose connect before all tests, disconnect after all
 *   - Collection cleanup between tests for isolation
 *   - Helper functions: createTestUser, generateToken, createTestLoad
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Load = require('../models/Load');

let mongoServer;

// ── Lifecycle hooks ─────────────────────────────────────────────────────────

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();

  // Set required env vars for auth middleware and routes
  process.env.JWT_SECRET = 'test-jwt-secret-64-chars-long-for-testing-purposes-abcdef1234567890';
  process.env.NODE_ENV = 'test';
  process.env.MONGO_URI = uri;

  await mongoose.connect(uri);
});

afterEach(async () => {
  // Clean all collections between tests for full isolation
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

// ── Helper Functions ────────────────────────────────────────────────────────

/**
 * Create a test user with sensible defaults. Overrides merge with defaults.
 *
 * @param {Object} overrides - Fields to override (e.g. { role: 'shipper', email: '...' })
 * @returns {Promise<Document>} - Saved User document
 */
async function createTestUser(overrides = {}) {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const defaults = {
    name: 'Test User',
    email: `test-${uniqueSuffix}@example.com`,
    password: await bcrypt.hash('TestPassword123!', 10),
    role: 'carrier',
    companyName: 'Test Company LLC',
  };
  const userData = { ...defaults, ...overrides };
  const user = await User.create(userData);
  return user;
}

/**
 * Create a verified carrier (verification.status = 'verified').
 */
async function createVerifiedCarrier(overrides = {}) {
  return createTestUser({
    role: 'carrier',
    verification: {
      status: 'verified',
      insurance: { status: 'valid' },
    },
    ...overrides,
  });
}

/**
 * Create a verified shipper (shipperVerification.paymentMethodVerified = true).
 */
async function createVerifiedShipper(overrides = {}) {
  return createTestUser({
    role: 'shipper',
    shipperVerification: {
      status: 'verified',
      paymentMethodVerified: true,
      emailDomainVerified: true,
    },
    ...overrides,
  });
}

/**
 * Generate a valid JWT token for a user.
 */
function generateToken(user) {
  return jwt.sign(
    { userId: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );
}

/**
 * Generate an expired JWT token (for negative tests).
 */
function generateExpiredToken(user) {
  return jwt.sign(
    { userId: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '0s' }
  );
}

/**
 * Create a test load in the DB. Avoids external geocoding by providing lat/lng directly.
 *
 * @param {ObjectId} shipperId - The shipper who posted the load
 * @param {Object}   overrides - Fields to override
 * @returns {Promise<Document>} - Saved Load document
 */
async function createTestLoad(shipperId, overrides = {}) {
  const defaults = {
    title: 'Test Load - Chicago to Dallas',
    origin: 'Chicago, IL',
    destination: 'Dallas, TX',
    originLat: 41.8781,
    originLng: -87.6298,
    destinationLat: 32.7767,
    destinationLng: -96.797,
    rate: 2500,
    equipmentType: 'Dry Van',
    loadWeight: 40000,
    postedBy: shipperId,
    status: 'open',
    pickupTimeWindow: {
      start: new Date(),
      end: new Date(Date.now() + 86400000),
    },
    deliveryTimeWindow: {
      start: new Date(Date.now() + 86400000),
      end: new Date(Date.now() + 172800000),
    },
  };
  return Load.create({ ...defaults, ...overrides });
}

/**
 * Build a minimal Express app for testing auth-protected endpoints
 * without importing the full app.js (which has Socket.IO, DB connect, cron jobs, etc.).
 */
function createAuthTestApp() {
  const express = require('express');
  const auth = require('../middlewares/authMiddleware');
  const app = express();
  app.use(express.json());

  // Minimal protected route for auth testing
  app.get('/api/users/me', auth, async (req, res) => {
    try {
      const user = await User.findById(req.user.userId).select('-password');
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(user);
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  return app;
}

/**
 * Build a minimal Express app with load routes for testing.
 * Mounts GET /api/loads and PUT /api/loads/:id/accept without Socket.IO.
 */
function createLoadTestApp() {
  const express = require('express');
  const auth = require('../middlewares/authMiddleware');
  const { transitionLoadStatus } = require('../services/loadStateMachine');
  const app = express();
  app.use(express.json());

  // GET /api/loads - simplified (no preferred carriers, no socket)
  app.get('/api/loads', auth, async (req, res) => {
    try {
      const { status, equipmentType } = req.query;
      let filter = {};

      if (req.user.role === 'carrier') {
        filter = {
          $or: [{ status: 'open' }, { acceptedBy: req.user.userId }],
        };
      } else if (req.user.role === 'shipper') {
        filter = { postedBy: req.user.userId };
      }

      if (status && status !== 'all') filter.status = status;
      if (equipmentType) filter.equipmentType = equipmentType;

      const loads = await Load.find(filter).sort({ createdAt: -1 });
      res.json(loads);
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  // POST /api/loads - create load (simplified: no geocoding)
  app.post('/api/loads', auth, async (req, res) => {
    try {
      if (req.user.role !== 'shipper') {
        return res.status(403).json({ error: 'Only shippers can post loads.' });
      }

      // Shipper verification guard
      const shipper = await User.findById(req.user.userId).select('shipperVerification');
      const sv = shipper?.shipperVerification;
      if (sv?.status === 'suspended') {
        return res.status(403).json({ error: 'Your shipper account is suspended.', verificationStatus: 'suspended' });
      }
      if (!sv?.paymentMethodVerified) {
        return res.status(403).json({
          error: 'Add a payment method before posting loads.',
          verificationStatus: sv?.status || 'unverified',
          missingStep: 'payment_method',
        });
      }

      const { title, origin, destination, rate, equipmentType } = req.body;
      if (!title || !origin || !destination || !rate || !equipmentType) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const load = await Load.create({
        title, origin, destination, rate, equipmentType,
        originLat: 41.8781, originLng: -87.6298,
        destinationLat: 32.7767, destinationLng: -96.797,
        postedBy: req.user.userId,
      });
      res.status(201).json(load);
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  // PUT /api/loads/:id/accept
  app.put('/api/loads/:id/accept', auth, async (req, res) => {
    try {
      const carrier = await User.findById(req.user.userId).select('verification');
      if (carrier?.verification?.status !== 'verified') {
        return res.status(403).json({
          error: 'Complete carrier verification before accepting loads',
          verificationStatus: carrier?.verification?.status || 'unverified',
        });
      }
      if (carrier?.verification?.insurance?.status === 'lapsed') {
        return res.status(403).json({ error: 'Insurance lapsed' });
      }

      const load = await Load.findOneAndUpdate(
        { _id: req.params.id, status: 'open', acceptedBy: null },
        { $set: { status: 'accepted', acceptedBy: req.user.userId } },
        { new: true }
      );

      if (!load) {
        const exists = await Load.findById(req.params.id);
        if (!exists) return res.status(404).json({ error: 'Load not found' });
        return res.status(409).json({ error: 'Load is no longer available' });
      }

      res.json({ message: 'Load accepted successfully', load });
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  // PUT /api/loads/:id/cancel
  app.put('/api/loads/:id/cancel', auth, async (req, res) => {
    try {
      const load = await Load.findById(req.params.id);
      if (!load) return res.status(404).json({ error: 'Load not found' });

      const { reason } = req.body;
      const userId = req.user.userId;
      const role = req.user.role;

      const isShipper = String(load.postedBy) === userId;
      const isCarrier = String(load.acceptedBy) === userId;

      if (!isShipper && !isCarrier) {
        return res.status(403).json({ error: 'Only the shipper or assigned carrier can cancel' });
      }

      if (load.status === 'in-transit') {
        return res.status(409).json({ error: 'Cannot cancel an in-transit load. File a dispute instead.' });
      }
      if (load.status === 'delivered') {
        return res.status(409).json({ error: 'Cannot cancel a delivered load' });
      }
      if (load.status === 'cancelled') {
        return res.status(409).json({ error: 'Load is already cancelled' });
      }

      const previousStatus = load.status;
      const result = await transitionLoadStatus(
        load._id, previousStatus, 'cancelled',
        { cancelledBy: userId, cancelledByRole: role, cancelReason: reason || 'No reason', cancelledAt: new Date() },
        userId
      );

      if (!result.success) {
        return res.status(409).json({ error: result.error });
      }

      // Shipper cancels open load: no fee
      if (isShipper && previousStatus === 'open') {
        return res.json({ message: 'Load cancelled successfully. No fees apply.', loadStatus: 'cancelled', tonuFeeCents: 0 });
      }

      // Shipper cancels accepted load: TONU fee
      if (isShipper && previousStatus === 'accepted' && load.acceptedBy) {
        const tonuFeeCents = 25000;
        return res.json({ message: 'Load cancelled. TONU fee applies.', loadStatus: 'cancelled', tonuFeeCents });
      }

      // Carrier cancels accepted load: trust penalty, re-open
      if (isCarrier && previousStatus === 'accepted') {
        await Load.findByIdAndUpdate(load._id, { $set: { status: 'open', acceptedBy: null, assignedTruckId: null } });
        return res.json({ message: 'Load cancelled. Trust score penalty applied.', loadStatus: 'open', trustScorePenalty: -5 });
      }

      res.json({ message: `Load cancelled by ${role}.`, loadStatus: 'cancelled', previousStatus });
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  // PUT /api/loads/:id/dispute
  app.put('/api/loads/:id/dispute', auth, async (req, res) => {
    try {
      const load = await Load.findById(req.params.id);
      if (!load) return res.status(404).json({ error: 'Load not found' });

      const userId = req.user.userId;
      const role = req.user.role;
      const { reason, type } = req.body;

      const isShipper = String(load.postedBy) === userId;
      const isCarrier = String(load.acceptedBy) === userId;
      if (!isShipper && !isCarrier && role !== 'admin') {
        return res.status(403).json({ error: 'Only parties on this load can file a dispute' });
      }

      if (!['in-transit', 'delivered'].includes(load.status)) {
        return res.status(409).json({ error: `Cannot dispute a load in "${load.status}" status.` });
      }

      if (!reason) {
        return res.status(400).json({ error: 'Dispute reason is required' });
      }

      const result = await transitionLoadStatus(
        load._id, load.status, 'disputed',
        { disputedBy: userId, disputedByRole: role, disputeReason: reason, disputeType: type || 'general', disputeFiledAt: new Date() },
        userId
      );

      if (!result.success) {
        return res.status(409).json({ error: result.error });
      }

      res.json({ message: 'Dispute filed successfully.', loadStatus: 'disputed', disputeType: type || 'general' });
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  // PUT /api/loads/:id/resolve (admin only)
  app.put('/api/loads/:id/resolve', auth, async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
      }

      const load = await Load.findById(req.params.id);
      if (!load) return res.status(404).json({ error: 'Load not found' });
      if (load.status !== 'disputed') {
        return res.status(409).json({ error: 'Load is not in disputed status' });
      }

      const { resolution, notes } = req.body;
      if (!['carrier_fault', 'shipper_fault', 'split', 'dismissed'].includes(resolution)) {
        return res.status(400).json({ error: 'Invalid resolution' });
      }

      const result = await transitionLoadStatus(
        load._id, 'disputed', 'resolved',
        { disputeResolution: resolution, disputeResolvedAt: new Date(), disputeResolvedBy: req.user.userId, disputeNotes: notes || '' },
        req.user.userId
      );

      if (!result.success) {
        return res.status(409).json({ error: result.error });
      }

      res.json({ message: 'Dispute resolved.', loadStatus: 'resolved', resolution });
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  return app;
}

module.exports = {
  createTestUser,
  createVerifiedCarrier,
  createVerifiedShipper,
  generateToken,
  generateExpiredToken,
  createTestLoad,
  createAuthTestApp,
  createLoadTestApp,
};
