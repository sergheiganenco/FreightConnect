/**
 * Verification Tests
 *
 * Tests shipper and carrier verification guards:
 *   - Shipper without payment method cannot post load (403)
 *   - Shipper with payment method can post load (201)
 *   - Carrier without verification cannot accept (403)
 *   - EIN validation: valid format, invalid prefix
 *   - Email domain check: free vs business
 */

require('./setup');
const request = require('supertest');
const {
  createTestUser,
  createVerifiedCarrier,
  createVerifiedShipper,
  generateToken,
  createTestLoad,
  createLoadTestApp,
} = require('./setup');
const {
  validateEIN,
  checkEmailDomain,
} = require('../services/shipperVerificationService');

describe('Verification', () => {
  let app;

  beforeAll(() => {
    app = createLoadTestApp();
  });

  // ─── Shipper verification guards ──────────────────────────────────────────

  describe('Shipper Load Posting', () => {
    test('should reject load post from shipper without payment method (403)', async () => {
      const unverifiedShipper = await createTestUser({
        email: 'nopm@test.com',
        role: 'shipper',
        // shipperVerification.paymentMethodVerified defaults to false
      });
      const token = generateToken(unverifiedShipper);

      const res = await request(app)
        .post('/api/loads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Should fail',
          origin: 'A',
          destination: 'B',
          rate: 1000,
          equipmentType: 'Dry Van',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('payment method');
    });

    test('should allow load post from shipper with payment method (201)', async () => {
      const verifiedShipper = await createVerifiedShipper({ email: 'pm@test.com' });
      const token = generateToken(verifiedShipper);

      const res = await request(app)
        .post('/api/loads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Valid Load',
          origin: 'Chicago, IL',
          destination: 'Dallas, TX',
          rate: 2500,
          equipmentType: 'Dry Van',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('open');
    });

    test('should reject load post from suspended shipper (403)', async () => {
      const suspendedShipper = await createTestUser({
        email: 'suspended@test.com',
        role: 'shipper',
        shipperVerification: {
          status: 'suspended',
          paymentMethodVerified: true,
        },
      });
      const token = generateToken(suspendedShipper);

      const res = await request(app)
        .post('/api/loads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Suspended',
          origin: 'A',
          destination: 'B',
          rate: 1000,
          equipmentType: 'Flatbed',
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('suspended');
    });
  });

  // ─── Carrier verification guards ─────────────────────────────────────────

  describe('Carrier Load Acceptance', () => {
    test('should reject unverified carrier from accepting (403)', async () => {
      const shipper = await createVerifiedShipper({ email: 'sh-cv@test.com' });
      const unverifiedCarrier = await createTestUser({
        email: 'cr-unv@test.com',
        role: 'carrier',
      });
      const load = await createTestLoad(shipper._id);
      const token = generateToken(unverifiedCarrier);

      const res = await request(app)
        .put(`/api/loads/${load._id}/accept`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.verificationStatus).toBe('unverified');
    });

    test('should allow verified carrier to accept (200)', async () => {
      const shipper = await createVerifiedShipper({ email: 'sh-vca@test.com' });
      const verifiedCarrier = await createVerifiedCarrier({ email: 'cr-vca@test.com' });
      const load = await createTestLoad(shipper._id);
      const token = generateToken(verifiedCarrier);

      const res = await request(app)
        .put(`/api/loads/${load._id}/accept`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.load.status).toBe('accepted');
    });

    test('should reject carrier with lapsed insurance (403)', async () => {
      const shipper = await createVerifiedShipper({ email: 'sh-ins@test.com' });
      const lapsedCarrier = await createTestUser({
        email: 'cr-lapsed@test.com',
        role: 'carrier',
        verification: {
          status: 'verified',
          insurance: { status: 'lapsed' },
        },
      });
      const load = await createTestLoad(shipper._id);
      const token = generateToken(lapsedCarrier);

      const res = await request(app)
        .put(`/api/loads/${load._id}/accept`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('lapsed');
    });
  });

  // ─── EIN Validation ───────────────────────────────────────────────────────

  describe('EIN Validation', () => {
    test('should accept valid EIN format (12-3456789)', () => {
      const result = validateEIN('12-3456789');
      expect(result.valid).toBe(true);
      expect(result.masked).toBeDefined();
      expect(result.prefix).toBe('12');
    });

    test('should accept valid EIN without dash (123456789)', () => {
      const result = validateEIN('123456789');
      expect(result.valid).toBe(true);
    });

    test('should reject EIN with invalid prefix 00', () => {
      const result = validateEIN('00-1234567');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid EIN prefix');
    });

    test('should reject EIN with invalid prefix 07', () => {
      const result = validateEIN('07-1234567');
      expect(result.valid).toBe(false);
    });

    test('should reject EIN with invalid prefix 08', () => {
      const result = validateEIN('08-1234567');
      expect(result.valid).toBe(false);
    });

    test('should reject EIN with invalid prefix 09', () => {
      const result = validateEIN('09-1234567');
      expect(result.valid).toBe(false);
    });

    test('should reject EIN with invalid prefix 89', () => {
      const result = validateEIN('89-1234567');
      expect(result.valid).toBe(false);
    });

    test('should reject too-short EIN', () => {
      const result = validateEIN('12-345');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('9 digits');
    });

    test('should reject too-long EIN', () => {
      const result = validateEIN('12-34567890');
      expect(result.valid).toBe(false);
    });

    test('should reject non-numeric EIN', () => {
      const result = validateEIN('AB-CDEFGHI');
      expect(result.valid).toBe(false);
    });

    test('should reject empty/null EIN', () => {
      expect(validateEIN('').valid).toBe(false);
      expect(validateEIN(null).valid).toBe(false);
      expect(validateEIN(undefined).valid).toBe(false);
    });

    test('should mask EIN correctly (show first 2 and last 4)', () => {
      const result = validateEIN('12-3456789');
      expect(result.masked).toBe('12-***6789');
    });
  });

  // ─── Email Domain Check ──────────────────────────────────────────────────

  describe('Email Domain Check', () => {
    test('gmail.com should be flagged as free email', () => {
      const result = checkEmailDomain('john@gmail.com');
      expect(result.domain).toBe('gmail.com');
      expect(result.isFreeEmail).toBe(true);
    });

    test('yahoo.com should be flagged as free email', () => {
      const result = checkEmailDomain('jane@yahoo.com');
      expect(result.isFreeEmail).toBe(true);
    });

    test('hotmail.com should be flagged as free email', () => {
      const result = checkEmailDomain('user@hotmail.com');
      expect(result.isFreeEmail).toBe(true);
    });

    test('outlook.com should be flagged as free email', () => {
      const result = checkEmailDomain('user@outlook.com');
      expect(result.isFreeEmail).toBe(true);
    });

    test('protonmail.com should be flagged as free email', () => {
      const result = checkEmailDomain('user@protonmail.com');
      expect(result.isFreeEmail).toBe(true);
    });

    test('acmefreight.com should be flagged as business email', () => {
      const result = checkEmailDomain('dispatch@acmefreight.com');
      expect(result.domain).toBe('acmefreight.com');
      expect(result.isFreeEmail).toBe(false);
    });

    test('xpologistics.com should be flagged as business email', () => {
      const result = checkEmailDomain('carrier@xpologistics.com');
      expect(result.isFreeEmail).toBe(false);
    });

    test('should handle empty/null email gracefully', () => {
      const result = checkEmailDomain(null);
      expect(result.domain).toBeNull();
      expect(result.isFreeEmail).toBeNull();
    });

    test('should handle email without @ gracefully', () => {
      const result = checkEmailDomain('no-at-sign');
      expect(result.domain).toBeUndefined();
    });
  });
});
