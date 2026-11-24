/**
 * /api/compliance-docs: the company's document wallet (truck, trailer, driver and company papers).
 * Every login of the company can read (a driver has to show these at the roadside);
 * only managers add or remove. Files are private: the only way to read one is GET /:id/file.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { body, param } = require('express-validator');
const auth = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validate');
const { managerOnly } = require('../middlewares/companyRoles');
const { makeLimiter } = require('../middlewares/rateLimiter');
const ComplianceDoc = require('../models/ComplianceDoc');
const User = require('../models/User');

const router = express.Router();
const PRIVATE_DIR = path.join(__dirname, '..', 'public', 'documents', 'compliance');
try { fs.mkdirSync(PRIVATE_DIR, { recursive: true }); } catch (_) {}

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DOCS = 500; // per company
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };
const companyOf = (req) => String(req.user.companyOwnerId || req.user.userId);
const clean = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, ' ').trim() : v);
const carrierOnly = (req, res, next) => (req.user.role === 'carrier' ? next() : res.status(403).json({ error: 'Carriers only' }));

const uploadLimiter = makeLimiter({
  windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many uploads, please try again later' },
}, 'rl:compliance:');

// Memory storage: nothing touches disk until size and the real file type pass.
const mem = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });
function uploadOne(req, res, next) {
  mem.single('file')(req, res, (err) => {
    if (!err) return next();
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'File is larger than 10 MB' : 'Upload rejected' });
  });
}
/** Real type from the leading bytes; the declared type and file name are not trusted. */
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

const view = (d) => ({
  _id: d._id, subjectType: d.subjectType, subjectId: d.subjectId, kind: d.kind, label: d.label, number: d.number,
  expiresAt: d.expiresAt, hasFile: !!d.file, mimeType: d.mimeType, createdAt: d.createdAt,
});

router.get('/', auth, carrierOnly, async (req, res) => {
  try {
    const docs = await ComplianceDoc.find({ company: companyOf(req) }).sort({ subjectType: 1, subjectId: 1, kind: 1 }).limit(MAX_DOCS).lean();
    res.json({ data: docs.map(view) });
  } catch (err) {
    console.error('[compliance-docs list] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', auth, carrierOnly, managerOnly, uploadLimiter, uploadOne,
  body('subjectType').isIn(['company', 'truck', 'trailer', 'driver']).withMessage('Invalid subjectType'),
  body('subjectId').optional({ checkFalsy: true }).customSanitizer(clean).isLength({ max: 60 }),
  body('kind').isIn(ComplianceDoc.KINDS).withMessage('Invalid kind'),
  body('label').optional({ checkFalsy: true }).customSanitizer(clean).isLength({ max: 120 }),
  body('number').optional({ checkFalsy: true }).customSanitizer(clean).isLength({ max: 80 }),
  body('expiresAt').optional({ checkFalsy: true }).isISO8601().withMessage('expiresAt must be a date'),
  validate,
  async (req, res) => {
    try {
      const company = companyOf(req);
      const { subjectType } = req.body;
      const subjectId = subjectType === 'company' ? '' : String(req.body.subjectId || '');
      if (subjectType !== 'company' && !subjectId) return res.status(400).json({ error: 'Say which truck, trailer or driver this document is for' });
      if (subjectType === 'truck' || subjectType === 'driver') {
        const owner = await User.findById(company).select('fleet.truckId drivers.driverId').lean();
        const known = subjectType === 'truck'
          ? (owner?.fleet || []).some((t) => t.truckId === subjectId)
          : (owner?.drivers || []).some((d) => d.driverId === subjectId);
        if (!known) return res.status(400).json({ error: `That ${subjectType} is not in your company` });
      }
      if ((await ComplianceDoc.countDocuments({ company })) >= MAX_DOCS) return res.status(409).json({ error: 'Document limit reached; remove old documents first' });

      let file = null, mimeType = null;
      if (req.file) {
        mimeType = sniff(req.file.buffer);
        if (!mimeType) return res.status(400).json({ error: 'Only JPEG, PNG, WEBP or PDF files are allowed' });
        file = `${crypto.randomBytes(16).toString('hex')}${EXT[mimeType]}`;
        await fs.promises.writeFile(path.join(PRIVATE_DIR, file), req.file.buffer, { flag: 'wx' });
      }
      const doc = await ComplianceDoc.create({
        company, subjectType, subjectId, kind: req.body.kind, label: req.body.label || undefined, number: req.body.number || undefined,
        expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null, file, mimeType, uploadedBy: req.user.userId,
      });
      res.status(201).json({ success: true, data: view(doc) });
    } catch (err) {
      console.error('[compliance-docs create] failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

router.get('/:id/file', auth, carrierOnly, param('id').isMongoId().withMessage('Invalid id'), validate, async (req, res) => {
  try {
    const doc = await ComplianceDoc.findOne({ _id: req.params.id, company: companyOf(req) }).lean();
    if (!doc || !doc.file || !/^[a-f0-9]{32}\.(jpg|png|webp|pdf)$/.test(doc.file)) return res.status(404).json({ error: 'No file' });
    res.set({
      'Content-Type': doc.mimeType, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': doc.mimeType === 'application/pdf' ? 'attachment; filename="document.pdf"' : 'inline',
    });
    fs.createReadStream(path.join(PRIVATE_DIR, doc.file)).on('error', () => res.status(404).end()).pipe(res);
  } catch (err) {
    console.error('[compliance-docs file] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', auth, carrierOnly, managerOnly, param('id').isMongoId().withMessage('Invalid id'), validate, async (req, res) => {
  try {
    const doc = await ComplianceDoc.findOneAndDelete({ _id: req.params.id, company: companyOf(req) });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (doc.file && /^[a-f0-9]{32}\.(jpg|png|webp|pdf)$/.test(doc.file)) fs.promises.unlink(path.join(PRIVATE_DIR, doc.file)).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    console.error('[compliance-docs delete] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
