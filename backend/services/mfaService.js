/**
 * TOTP-based MFA. speakeasy/qrcode are optional deps — guarded so the app
 * boots even if they aren't installed (feature returns 'unavailable').
 */
let speakeasy = null, qrcode = null;
try { speakeasy = require('speakeasy'); } catch (_) {}
try { qrcode = require('qrcode'); } catch (_) {}

function isAvailable() { return Boolean(speakeasy); }

function generateSecret(label) {
  if (!speakeasy) throw new Error('MFA library not installed');
  const secret = speakeasy.generateSecret({ name: `FreightConnect (${label})` });
  return { base32: secret.base32, otpauthUrl: secret.otpauth_url };
}

async function qrDataUrl(otpauthUrl) {
  if (!qrcode) return null;
  return qrcode.toDataURL(otpauthUrl);
}

function verifyToken(secretBase32, token) {
  if (!speakeasy) throw new Error('MFA library not installed');
  return speakeasy.totp.verify({ secret: secretBase32, encoding: 'base32', token: String(token), window: 1 });
}

module.exports = { isAvailable, generateSecret, qrDataUrl, verifyToken };
