const { encrypt, decrypt, maskTin } = require('../utils/fieldCrypto');

describe('fieldCrypto', () => {
  test('round-trips a value', () => {
    const enc = encrypt('12-3456789');
    expect(enc.startsWith('enc:v1:')).toBe(true);
    expect(enc).not.toContain('3456789');       // ciphertext hides the TIN
    expect(decrypt(enc)).toBe('12-3456789');
  });

  test('ciphertext differs each call (random IV) but decrypts the same', () => {
    const a = encrypt('987654321');
    const b = encrypt('987654321');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('987654321');
    expect(decrypt(b)).toBe('987654321');
  });

  test('does not double-encrypt', () => {
    const once = encrypt('11-1111111');
    expect(encrypt(once)).toBe(once);
  });

  test('decrypt is backward-compatible with legacy plaintext', () => {
    expect(decrypt('12-3456789')).toBe('12-3456789'); // not enc: prefixed → as-is
    expect(decrypt(null)).toBeNull();
    expect(decrypt(undefined)).toBeUndefined();
  });

  test('empty / nullish values pass through encrypt', () => {
    expect(encrypt('')).toBe('');
    expect(encrypt(null)).toBeNull();
    expect(encrypt(undefined)).toBeUndefined();
  });

  test('maskTin shows only the last 4, decrypting first', () => {
    expect(maskTin('12-3456789')).toBe('**-***6789');       // plaintext
    expect(maskTin(encrypt('12-3456789'))).toBe('**-***6789'); // encrypted
  });

  test('tampered ciphertext fails auth and returns the raw value (no crash)', () => {
    const enc = encrypt('55-5555555');
    const tampered = enc.slice(0, -3) + 'xyz';
    expect(decrypt(tampered)).toBe(tampered); // GCM auth fails → returned as-is
  });
});
