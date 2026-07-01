/**
 * Exception Routes
 *
 * POST   /api/exceptions            — file a new exception (carrier or shipper)
 * GET    /api/exceptions            — list exceptions (admin: all; user: own)
 * GET    /api/exceptions/:id        — get single exception with notes
 * PUT    /api/exceptions/:id/status — admin: update status (investigating/resolved/dismissed)
 * POST   /api/exceptions/:id/notes  — add note (any participant or admin)
 * GET    /api/exceptions/load/:loadId — all exceptions for a specific load
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const auth = require('../middlewares/authMiddleware');
const Exception = require('../models/Exception');
const Load = require('../models/Load');
const { getIO } = require('../utils/socket');
const { notifyUserSafe } = require('../utils/notifyUser');

function notify(userId, event, payload) {
  try { getIO().to(`user_${userId}`).emit(event, payload); } catch (_) {}
}

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

// ────────────────────────────────────────────────────────────────────────────
// POST /api/exceptions — file a new exception
// ────────────────────────────────────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  try {
    const { loadId, type, severity, title, description, claimAmount } = req.body;
    if (!loadId || !type || !title || !description) {
      return res.status(400).json({ error: 'loadId, type, title, and description are required' });
    }

    const load = await Load.findById(loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });

    // Only carrier or shipper on this load can file
    const uid = req.user.userId;
    const role = req.user.role;
    if (role === 'admin') return res.status(403).json({ error: 'Admins cannot file exceptions — use the admin panel' });
    if (load.postedBy?.toString() !== uid && load.acceptedBy?.toString() !== uid) {
      return res.status(403).json({ error: 'You are not a participant on this load' });
    }

    const exception = await Exception.create({
      loadId,
      filedBy: uid,
      filedByRole: role,
      type,
      severity: severity || 'medium',
      title,
      description,
      claimAmount: claimAmount || null,
      notes: [{
        author: uid,
        authorRole: role,
        content: description,
      }],
    });

    // Notify the other party + admins via socket
    const otherPartyId = load.postedBy?.toString() === uid
      ? load.acceptedBy?.toString()
      : load.postedBy?.toString();
    if (otherPartyId) {
      notify(otherPartyId, 'exception:new', {
        exceptionId: exception._id,
        loadId,
        title,
        type,
        severity: exception.severity,
      });
      notifyUserSafe(otherPartyId, {
        type: 'exception:new',
        title: 'Exception filed on your load',
        body: `${type.replace('_', ' ')} — "${title}"`,
        link: '/dashboard/carrier/my-loads',
        metadata: { exceptionId: exception._id, loadId, severity: exception.severity },
      });
    }

    res.status(201).json(exception);
  } catch (err) {
    console.error('File exception error:', err);
    res.status(500).json({ error: 'Failed to file exception' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/exceptions — list exceptions
// Admin: all (with optional status/type filters + pagination)
// Carrier/Shipper: own exceptions only
// ────────────────────────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, type } = req.query;
    const uid = req.user.userId;
    const role = req.user.role;

    let filter = {};
    if (role !== 'admin') {
      filter.filedBy = uid;
    } else {
      // Admin can filter by status and type
      if (status && status !== 'all') filter.status = status;
      if (type   && type   !== 'all') filter.type   = type;
    }

    const [exceptions, total] = await Promise.all([
      Exception.find(filter)
        .populate('loadId', 'title origin destination status')
        .populate('filedBy', 'name email companyName')
        .populate('assignedTo', 'name email')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit)),
      Exception.countDocuments(filter),
    ]);

    res.json({ exceptions, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch exceptions' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/exceptions/load/:loadId — all exceptions for a load
// ────────────────────────────────────────────────────────────────────────────
router.get('/load/:loadId', auth, async (req, res) => {
  try {
    const load = await Load.findById(req.params.loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });

    const uid = req.user.userId;
    if (
      req.user.role !== 'admin' &&
      load.postedBy?.toString() !== uid &&
      load.acceptedBy?.toString() !== uid
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const exceptions = await Exception.find({ loadId: req.params.loadId })
      .populate('filedBy', 'name email role')
      .sort({ createdAt: -1 });

    res.json(exceptions);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch load exceptions' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/exceptions/:id — get single exception with full notes
// ────────────────────────────────────────────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    const exception = await Exception.findById(req.params.id)
      .populate('loadId', 'title origin destination status rate postedBy acceptedBy')
      .populate('filedBy', 'name email companyName')
      .populate('assignedTo', 'name email')
      .populate('resolvedBy', 'name email')
      .populate('notes.author', 'name email role');

    if (!exception) return res.status(404).json({ error: 'Exception not found' });

    const uid = req.user.userId;
    const load = exception.loadId;
    if (
      req.user.role !== 'admin' &&
      exception.filedBy?._id?.toString() !== uid &&
      load?.postedBy?.toString() !== uid &&
      load?.acceptedBy?.toString() !== uid
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(exception);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch exception' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// PUT /api/exceptions/:id/status — admin updates status + resolution note
// ────────────────────────────────────────────────────────────────────────────
router.put('/:id/status', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });

    const { status, resolution, assignedTo, severity } = req.body;
    const validStatuses = ['open', 'investigating', 'resolved', 'dismissed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const exception = await Exception.findById(req.params.id)
      .populate('loadId', 'postedBy acceptedBy title');
    if (!exception) return res.status(404).json({ error: 'Exception not found' });

    exception.status = status;
    if (resolution) exception.resolution = resolution;
    if (assignedTo) exception.assignedTo = assignedTo;
    if (severity)   exception.severity = severity;

    if (status === 'resolved' || status === 'dismissed') {
      exception.resolvedAt = new Date();
      exception.resolvedBy = req.user.userId;
    }

    // Add system note about status change
    exception.notes.push({
      author: req.user.userId,
      authorRole: 'admin',
      content: `Status changed to "${status}"${resolution ? ': ' + resolution : ''}.`,
    });

    await exception.save();

    // Notify both parties
    const load = exception.loadId;
    const notifyIds = [
      load?.postedBy?.toString(),
      load?.acceptedBy?.toString(),
      exception.filedBy?.toString(),
    ].filter(Boolean);
    const uniqueIds = [...new Set(notifyIds)];
    uniqueIds.forEach(id => {
      notify(id, 'exception:updated', {
        exceptionId: exception._id,
        status,
        title: exception.title,
      });
      notifyUserSafe(id, {
        type: 'exception:updated',
        title: `Exception ${status}`,
        body: `"${exception.title}" — status changed to ${status}`,
        link: '/dashboard/carrier/my-loads',
        metadata: { exceptionId: exception._id, status },
      });
    });

    res.json(exception);
  } catch (err) {
    console.error('Update exception status error:', err);
    res.status(500).json({ error: 'Failed to update exception' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/exceptions/:id/notes — add a note to the exception thread
// ────────────────────────────────────────────────────────────────────────────
router.post('/:id/notes', auth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Note content is required' });

    const exception = await Exception.findById(req.params.id)
      .populate('loadId', 'postedBy acceptedBy');
    if (!exception) return res.status(404).json({ error: 'Exception not found' });

    const uid = req.user.userId;
    const load = exception.loadId;
    const role = req.user.role;
    if (
      role !== 'admin' &&
      load?.postedBy?.toString() !== uid &&
      load?.acceptedBy?.toString() !== uid
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const note = {
      author: uid,
      authorRole: role,
      content: content.trim(),
    };
    exception.notes.push(note);
    await exception.save();

    // Notify the other participants
    const participantIds = [
      load?.postedBy?.toString(),
      load?.acceptedBy?.toString(),
    ].filter(id => id && id !== uid);
    participantIds.forEach(id => {
      notify(id, 'exception:note', {
        exceptionId: exception._id,
        title: exception.title,
        preview: content.slice(0, 80),
      });
      notifyUserSafe(id, {
        type: 'exception:note',
        title: 'New note on an exception',
        body: content.slice(0, 100),
        link: '/dashboard/carrier/my-loads',
        metadata: { exceptionId: exception._id },
      });
    });

    res.status(201).json(exception.notes[exception.notes.length - 1]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/exceptions/:id/evidence — attach evidence files (party or admin)
// ────────────────────────────────────────────────────────────────────────────
// Wrap multer so a rejected file (bad type / too large) returns a clean 400.
function uploadEvidence(req, res, next) {
  evidenceUpload.array('files', 5)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload rejected' });
    next();
  });
}

router.post('/:id/evidence', auth, uploadEvidence, async (req, res) => {
  try {
    const ex = await Exception.findById(req.params.id).populate('loadId', 'postedBy acceptedBy');
    if (!ex) return res.status(404).json({ error: 'Exception not found' });

    const uid = req.user.userId;
    const load = ex.loadId;
    const isParty = load && (String(load.postedBy) === uid || String(load.acceptedBy) === uid);
    if (!isParty && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to attach evidence to this exception' });
    }

    const urls = (req.files || []).map((f) => `/documents/evidence/${f.filename}`);
    ex.evidenceUrls = [...(ex.evidenceUrls || []), ...urls];
    await ex.save();
    res.json({ evidenceUrls: ex.evidenceUrls, added: urls });
  } catch (err) {
    console.error('[exceptions evidence] failed:', err.message);
    res.status(500).json({ error: 'Failed to attach evidence' });
  }
});

module.exports = router;
