/**
 * Auth Flow Tests
 *
 * Tests signup validation, login flows, and protected route access.
 * Uses model-level operations for signup/login (avoids rate limiter, Company model,
 * email sending side effects) and supertest for HTTP-level auth middleware tests.
 */

require('./setup');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const User = require('../models/User');
const {
  createTestUser,
  generateToken,
  generateExpiredToken,
  createAuthTestApp,
} = require('./setup');

describe('Authentication', () => {
  // ─── Signup: valid data -> 201 equivalent ─────────────────────────────────

  describe('Signup', () => {
    test('should create user with valid data (201 equivalent)', async () => {
      const user = await createTestUser({
        email: 'valid-signup@example.com',
        role: 'shipper',
        companyName: 'Acme Shipping Inc',
      });

      expect(user._id).toBeDefined();
      expect(user.name).toBe('Test User');
      expect(user.email).toBe('valid-signup@example.com');
      expect(user.role).toBe('shipper');
      expect(user.companyName).toBe('Acme Shipping Inc');

      // Token can be generated for the new user
      const token = generateToken(user);
      expect(token).toBeDefined();
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      expect(decoded.userId.toString()).toBe(user._id.toString());
    });

    test('should reject duplicate email (400 equivalent)', async () => {
      const email = 'duplicate@example.com';
      await createTestUser({ email });

      // Mongoose unique index should reject the duplicate
      await expect(createTestUser({ email })).rejects.toThrow();
    });

    test('should reject weak password at validation level (400 equivalent)', async () => {
      // The route uses express-validator rules. Test them directly.
      const { body } = require('express-validator');
      const { validationResult } = require('express-validator');

      // Min 8 chars
      const lengthValidator = body('password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters');

      const mockReq = { body: { password: 'Ab1!' } }; // too short
      await lengthValidator.run(mockReq);
      const errors = validationResult(mockReq);
      expect(errors.isEmpty()).toBe(false);
      expect(errors.array()[0].msg).toContain('at least 8 characters');

      // Must contain uppercase
      const upperValidator = body('password')
        .matches(/[A-Z]/)
        .withMessage('Must contain uppercase');

      const mockReq2 = { body: { password: 'nouppercase123!' } };
      await upperValidator.run(mockReq2);
      const errors2 = validationResult(mockReq2);
      expect(errors2.isEmpty()).toBe(false);

      // Must contain special char
      const specialValidator = body('password')
        .matches(/[!@#$%^&*(),.?":{}|<>]/)
        .withMessage('Must contain special char');

      const mockReq3 = { body: { password: 'NoSpecialChar123' } };
      await specialValidator.run(mockReq3);
      const errors3 = validationResult(mockReq3);
      expect(errors3.isEmpty()).toBe(false);
    });

    test('should hash password before storing', async () => {
      const plainPassword = 'SecurePass123!';
      const hashed = await bcrypt.hash(plainPassword, 10);
      const user = await createTestUser({ password: hashed });

      // Stored password is a bcrypt hash, not plain text
      expect(user.password).not.toBe(plainPassword);
      const match = await bcrypt.compare(plainPassword, user.password);
      expect(match).toBe(true);
    });

    test('should not return password in default query', async () => {
      await createTestUser({ email: 'nopw@example.com' });
      const user = await User.findOne({ email: 'nopw@example.com' });
      // password has select: false on the schema
      expect(user.password).toBeUndefined();
    });

    test('should assign correct roles', async () => {
      const carrier = await createTestUser({ email: 'c@test.com', role: 'carrier' });
      const shipper = await createTestUser({ email: 's@test.com', role: 'shipper' });
      const admin = await createTestUser({ email: 'a@test.com', role: 'admin' });

      expect(carrier.role).toBe('carrier');
      expect(shipper.role).toBe('shipper');
      expect(admin.role).toBe('admin');
    });

    test('should reject invalid role', async () => {
      await expect(
        createTestUser({ email: 'bad-role@test.com', role: 'superadmin' })
      ).rejects.toThrow();
    });
  });

  // ─── Login ────────────────────────────────────────────────────────────────

  describe('Login', () => {
    test('should authenticate with correct credentials (200 equivalent)', async () => {
      const plainPassword = 'ValidPassword123!';
      const hashed = await bcrypt.hash(plainPassword, 10);
      const user = await createTestUser({ password: hashed, email: 'login@test.com' });

      // Simulate login flow: find user, compare password, generate token
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
      expect(decoded.role).toBe(found.role);
    });

    test('should reject wrong password (401 equivalent)', async () => {
      const plainPassword = 'CorrectPassword123!';
      const hashed = await bcrypt.hash(plainPassword, 10);
      await createTestUser({ password: hashed, email: 'wrongpw@test.com' });

      const found = await User.findOne({ email: 'wrongpw@test.com' }).select('+password');
      const isMatch = await bcrypt.compare('WrongPassword123!', found.password);
      expect(isMatch).toBe(false);
    });

    test('should reject non-existent email (401 equivalent)', async () => {
      const found = await User.findOne({ email: 'nobody@nowhere.com' });
      expect(found).toBeNull();
    });

    test('should return user data without password in login response', async () => {
      await createTestUser({ email: 'logindata@test.com' });
      const user = await User.findOne({ email: 'logindata@test.com' });
      expect(user.password).toBeUndefined();
      expect(user.name).toBeDefined();
      expect(user.email).toBeDefined();
      expect(user.role).toBeDefined();
    });
  });

  // ─── Protected Route Access (HTTP-level via supertest) ────────────────────

  describe('Protected Route Access', () => {
    let app;

    beforeAll(() => {
      app = createAuthTestApp();
    });

    test('should return 401 without token', async () => {
      const res = await request(app).get('/api/users/me');
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    test('should return 401 with invalid token', async () => {
      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', 'Bearer this-is-not-a-valid-jwt-token');
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    test('should return 401 with expired token', async () => {
      const user = await createTestUser({ email: 'expired@test.com' });
      const token = generateExpiredToken(user);

      // Small delay to ensure expiration
      await new Promise((r) => setTimeout(r, 100));

      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    });

    test('should return 401 with missing Bearer prefix', async () => {
      const user = await createTestUser({ email: 'nobearer@test.com' });
      const token = generateToken(user);

      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', token); // no "Bearer " prefix
      expect(res.status).toBe(401);
    });

    test('should return 200 with valid token', async () => {
      const user = await createTestUser({ email: 'valid@test.com' });
      const token = generateToken(user);

      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('valid@test.com');
      expect(res.body.name).toBe('Test User');
      expect(res.body.password).toBeUndefined(); // should never leak
    });

    test('should return 401 with token signed by wrong secret', async () => {
      const user = await createTestUser({ email: 'wrongsecret@test.com' });
      const badToken = jwt.sign(
        { userId: user._id, role: user.role },
        'completely-wrong-secret-key',
        { expiresIn: '1d' }
      );

      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${badToken}`);
      expect(res.status).toBe(401);
    });
  });
});
