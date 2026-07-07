/**
 * evidenceUpload — hardened multer config for claim/dispute evidence uploads.
 *
 * Extracted verbatim from exceptionRoutes.js so cargo-claim evidence gets the
 * same protections:
 *   - EVIDENCE_DIR under public/documents/evidence (created recursively)
 *   - strict mimetype→ext allowlist; image/svg+xml is DELIBERATELY excluded
 *     (SVG can carry executable JavaScript → stored XSS when served inline)
 *   - crypto-random stored filename ev-<ts>-<hex><ext> where <ext> is derived
 *     from the mimetype allowlist, NEVER the client-supplied filename
 *   - 15 MB size limit
 *   - fileFilter requires BOTH the mimetype AND the client extension to be
 *     allowlisted before a file is accepted
 *
 * Exports:
 *   evidenceUpload  — the raw multer instance
 *   uploadEvidence  — middleware wrapping .array('files', 5) that turns a
 *                     rejected file (bad type / too large) into a clean 400
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

// ── Dispute-evidence uploads (POD / damage photos / PDFs) ────────────────────
const EVIDENCE_DIR = path.join(__dirname, '..', 'public', 'documents', 'evidence');
try { fs.mkdirSync(EVIDENCE_DIR, { recursive: true }); } catch (_) {}
// Strict allowlist. NOTE: image/svg+xml is deliberately excluded — SVG can
// carry executable JavaScript (stored XSS when served inline). The stored
// extension is derived from THIS map, never from the client filename, so a
// spoofed name like "evil.html" can never land as an HTML file.
const ALLOWED_EVIDENCE = {
  'image/jpeg': '.jpg',
  'image/png':  '.png',
  'image/gif':  '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};
const ALLOWED_EVIDENCE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf']);

// Accept only when BOTH the mimetype AND the client extension are allowlisted.
function evidenceAllowed(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mimeOk = Object.prototype.hasOwnProperty.call(ALLOWED_EVIDENCE, file.mimetype || '');
  return mimeOk && ALLOWED_EVIDENCE_EXT.has(ext);
}

const evidenceUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, EVIDENCE_DIR),
    filename: (req, file, cb) => {
      // Stored extension comes from the mimetype allowlist, never the client
      // filename; random (crypto) name so paths aren't guessable.
      const ext = ALLOWED_EVIDENCE[file.mimetype] || '.bin';
      cb(null, `ev-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (req, file, cb) => {
    const ok = evidenceAllowed(file);
    cb(ok ? null : new Error('Only JPG, PNG, GIF, WEBP, or PDF evidence is allowed'), ok);
  },
});

// Wrap multer so a rejected file (bad type / too large) returns a clean 400.
function uploadEvidence(req, res, next) {
  evidenceUpload.array('files', 5)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload rejected' });
    next();
  });
}

module.exports = { evidenceUpload, uploadEvidence };
