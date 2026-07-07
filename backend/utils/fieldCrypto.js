/**
 * fieldCrypto — authenticated field-level encryption for PII at rest (EIN/TIN).
 *
 * AES-256-GCM. The key comes from PII_ENCRYPTION_KEY when set, otherwise it is
 * derived from JWT_SECRET so encryption works in the current environment without
 * a new secret (set a dedicated PII_ENCRYPTION_KEY before storing real TINs).
 *
 * decrypt() and maskTin() are backward-compatible: a value that isn't in the
 * "enc:v1:" format (e.g. legacy plaintext / seed data) is returned/handled as-is,
 * so this can be rolled out without a migration.
 */

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

function getKey() {
  const raw = process.env.PII_ENCRYPTION_KEY || process.env.JWT_SECRET || 'dev-fallback-key';
  // Stable 32-byte key from whatever secret is available.
  return crypto.createHash('sha256').update(String(raw)).digest();
}

function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return plaintext;
  const s = String(plaintext);
  if (s.startsWith(PREFIX)) return s; // already encrypted — don't double-encrypt
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(s, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

function decrypt(value) {
  if (value == null || typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  try {
    const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (_) {
    return value; // undecryptable → return as-is rather than crash a read
  }
}

/** Mask a TIN/EIN to its last 4 digits, decrypting first if needed: "**-***6789". */
function maskTin(value) {
  const plain = decrypt(value);
  if (!plain) return plain;
  const digits = String(plain).replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `**-***${digits.slice(-4)}`;
}

module.exports = { encrypt, decrypt, maskTin };
