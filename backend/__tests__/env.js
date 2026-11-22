/**
 * Runs before every test file's modules load (jest `setupFiles`).
 *
 * Some route modules call require('dotenv').config(), which would pull the
 * developer's real backend/.env into the test process: a live routing API key
 * (tests then burn the provider's daily quota), real mail credentials (tests
 * then attempt real SMTP logins) and the real database URI. dotenv never
 * overrides a variable that is already defined, so define them here — empty —
 * and no test can reach a real external account by accident. A test that needs
 * one of these sets its own fake value and mocks the HTTP client.
 */
for (const k of [
  'MONGO_URI', 'ORS_API_KEY', 'EMAIL_USER', 'EMAIL_PASS', 'FMCSA_API_KEY',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'ANTHROPIC_API_KEY',
  'INSURANCE_VENDOR_URL', 'INSURANCE_VENDOR_API_KEY', 'REDIS_URL',
]) {
  process.env[k] = '';
}
process.env.JWT_SECRET = 'test-secret-key-for-testing';
process.env.NODE_ENV = 'test';
// The posting service spaces real geocoder lookups to 1.1 s (provider policy); tests mock the provider and must not wait.
// The spacing tests set it back through services/loadPostingService._spacing with an injected clock.
process.env.GEOCODE_SPACING_MS = '0';
