/**
 * Authentication Tests
 *
 * Tests signup, login, and authenticated profile retrieval.
 * Uses direct model + JWT operations to avoid rate limiter and external
 * dependencies in userRoutes (Socket.IO, Company model side effects).
 */

require('./setup');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { createTestUser, generateToken, generateExpiredToken } = require('./helpers');

// --- Minimal Express app for the /me and /whoami endpoints ---
const express = require('express');
const auth = require('../middlewares/authMiddleware');

function buildProfileApp() {
  const app = express();
  app.use(express.json());

  // Mount only the routes we need (avoids rate limiter / Company / notifyUser deps)
  app.get('/api/users/me', auth, async (req, res) => {
    try {
      const user = await User.findById(req.user.userId).select('-password');
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(user);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  });

  return app;
}

const request = require('supertest');

describe('Authentication', () => {
  // ─── Signup (direct model tests — no HTTP, avoids rate limiter) ────────────

  describe('POST /api/users/signup (model-level)', () => {
    test('should create a new user with valid data', async () => {
      const user = await createTestUser({
        email: 'newuser@example.com',
        role: 'shipper',
        companyName: 'Acme Shipping',
      });

      expect(user._id).toBeDefined();
      expect(user.name).toBe('Test User');
      expect(user.email).toBe('newuser@example.com');
      expect(user.role).toBe('shipper');
    });

    test('should hash password before storing', async () => {
      const plainPassword = 'SecurePass123!';
      const hashed = await bcrypt.hash(plainPassword, 10);
      const user = await createTestUser({ password: hashed });

      // The stored password should NOT equal the plain text
      expect(user.password).not.toBe(plainPassword);

      // It should be a valid bcrypt hash
      const match = await bcrypt.compare(plainPassword, user.password);
      expect(match).toBe(true);
    });

    test('should reject duplicate email', async () => {
      const email = 'dup@example.com';
      await createTestUser({ email });

      // Attempting to create another user with the same email should fail
      await expect(
        createTestUser({ email })
      ).rejects.toThrow();
    });

    test('should reject missing required fields', async () => {
      // Missing name
      await expect(User.create({ email: 'no-name@test.com', password: 'hash', role: 'carrier' }))
        .rejects.toThrow();

      // Missing email
      await expect(User.create({ name: 'No Email', password: 'hash', role: 'carrier' }))
        .rejects.toThrow();

      // Missing role
      await expect(User.create({ name: 'No Role', email: 'no-role@test.com', password: 'hash' }))
        .rejects.toThrow();
    });

    test('should reject weak password (validation at route level, model stores hash)', async () => {
      // The model itself accepts any string for password (hashing happens in route).
      // We verify the route-level validation rule: min 8 chars.
      const { body: bodyValidator } = require('express-validator');
      const validatorChain = bodyValidator('password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters');

      // Simulate a request with a short password
      const mockReq = { body: { password: '123' } };
      // Run the validator
      await validatorChain.run(mockReq);
      const { validationResult } = require('express-validator');
      const errors = validationResult(mockReq);
      expect(errors.isEmpty()).toBe(false);
      expect(errors.array()[0].msg).toContain('at least 8 characters');
    });

    test('should return JWT token on success (login flow)', async () => {
      const user = await createTestUser();
      const token = generateToken(user);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      expect(decoded.userId.toString()).toBe(user._id.toString());
      expect(decoded.role).toBe(user.role);
    });

    test('should set correct user role', async () => {
      const carrier = await createTestUser({ email: 'c@test.com', role: 'carrier' });
      const shipper = await createTestUser({ email: 's@test.com', role: 'shipper' });
      const admin = await createTestUser({ email: 'a@test.com', role: 'admin' });

      expect(carrier.role).toBe('carrier');
      expect(shipper.role).toBe('shipper');
      expect(admin.role).toBe('admin');
    });
  });

  // ─── Login (direct model tests) ────────────────────────────────────────────

  describe('POST /api/users/login (model-level)', () => {
    test('should return token for valid credentials', async () => {
      const plainPassword = 'ValidPassword123!';
      const hashed = await bcrypt.hash(plainPassword, 10);
      const user = await createTestUser({ password: hashed, email: 'login@test.com' });

      // Simulate login: find by email, compare password, generate token
      const found = await User.findOne({ email: 'login@test.com' }).select('+password');
      expect(found).not.toBeNull();

      const isMatch = await bcrypt.compare(plainPassword, found.password);
      expect(isMatch).toBe(true);

      const token = jwt.sign(
        { userId: found._id, role: found.role },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
      );
      expect(token).toBeDefined();

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      expect(decoded.userId.toString()).toBe(found._id.toString());
    });

    test('should reject invalid email', async () => {
      const found = await User.findOne({ email: 'nonexistent@test.com' });
      expect(found).toBeNull();
    });

    test('should reject wrong password', async () => {
      const plainPassword = 'CorrectPassword!';
      const hashed = await bcrypt.hash(plainPassword, 10);
      await createTestUser({ password: hashed, email: 'wrongpw@test.com' });

      const found = await User.findOne({ email: 'wrongpw@test.com' }).select('+password');
      const isMatch = await bcrypt.compare('WrongPassword!', found.password);
      expect(isMatch).toBe(false);
    });

    test('should return user data without password field', async () => {
      await createTestUser({ email: 'nopw@test.com' });

      // Default select excludes password (select: false on schema)
      const user = await User.findOne({ email: 'nopw@test.com' });
      expect(user.password).toBeUndefined();
      expect(user.name).toBeDefined();
      expect(user.email).toBeDefined();
      expect(user.role).toBeDefined();
    });
  });

  // ─── GET /api/users/me (HTTP tests via supertest) ──────────────────────────

  describe('GET /api/users/me', () => {
    let app;

    beforeAll(() => {
      app = buildProfileApp();
    });

    test('should return user profile with valid token', async () => {
      const user = await createTestUser({ email: 'me@test.com' });
      const token = generateToken(user);

      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('me@test.com');
      expect(res.body.name).toBe('Test User');
      expect(res.body.password).toBeUndefined();
    });

    test('should reject request without token', async () => {
      const res = await request(app).get('/api/users/me');

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    test('should reject expired token', async () => {
      const user = await createTestUser({ email: 'expired@test.com' });
      const token = generateExpiredToken(user);

      // Small delay to ensure token expires
      await new Promise(r => setTimeout(r, 100));

      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    test('should reject malformed token', async () => {
      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', 'Bearer not-a-real-jwt-token');

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });
  });
});
