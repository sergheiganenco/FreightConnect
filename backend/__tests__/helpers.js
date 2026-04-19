const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const Load = require('../models/Load');

async function createTestUser(overrides = {}) {
  const defaults = {
    name: 'Test User',
    email: `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: await bcrypt.hash('TestPassword123!', 10),
    role: 'carrier',
    companyName: 'Test Carrier LLC',
  };
  const user = await User.create({ ...defaults, ...overrides });
  return user;
}

function generateToken(user) {
  return jwt.sign(
    { userId: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );
}

function generateExpiredToken(user) {
  return jwt.sign(
    { userId: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '0s' }
  );
}

async function createTestLoad(shipperId, overrides = {}) {
  const defaults = {
    title: 'Test Load',
    commodity: 'General Freight',
    equipmentType: 'Dry Van',
    loadWeight: 40000,
    rate: 2500,
    origin: 'Chicago, IL',
    destination: 'Dallas, TX',
    originLat: 41.8781,
    originLng: -87.6298,
    destinationLat: 32.7767,
    destinationLng: -96.7970,
    postedBy: shipperId,
    status: 'open',
    pickupTimeWindow: { start: new Date(), end: new Date(Date.now() + 86400000) },
    deliveryTimeWindow: { start: new Date(Date.now() + 86400000), end: new Date(Date.now() + 172800000) },
  };
  return await Load.create({ ...defaults, ...overrides });
}

/**
 * Create a minimal Express app with userRoutes mounted for testing auth endpoints.
 * Avoids importing the full app.js which has side effects (DB connect, Socket.IO, etc.).
 */
function createTestApp() {
  const express = require('express');
  const app = express();
  app.use(express.json());

  // Mount user routes (no socket dependency)
  const userRoutes = require('../routes/userRoutes');
  app.use('/api/users', userRoutes);

  return app;
}

module.exports = { createTestUser, generateToken, generateExpiredToken, createTestLoad, createTestApp };
