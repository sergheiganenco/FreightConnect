/**
 * EDI Routes — Electronic Data Interchange
 *
 * POST  /api/edi/inbound              — Receive & parse EDI 204 (load tender)
 * GET   /api/edi                      — List EDI documents (shipper: own; admin: all)
 * GET   /api/edi/:id                  — Document detail + parsed data
 * POST  /api/edi/:id/create-load      — Create Load from parsed EDI 204
 * GET   /api/edi/outbound/214/:loadId — Generate & store EDI 214 (status update)
 * GET   /api/edi/outbound/210/:loadId — Generate & store EDI 210 (freight invoice)
 */

const express  = require('express');
const { parseWindow } = require('../utils/windowValidation');
const router   = express.Router();
const auth     = require('../middlewares/authMiddleware');
const EDIDocument = require('../models/EDIDocument');
const Load     = require('../models/Load');
const User     = require('../models/User');
const { createPostedLoad } = require('../services/loadPostingService');
const { getIO } = require('../utils/socket');
const { parseEDI204, edi204ToLoadFields, generateEDI214, generateEDI210 } = require('../utils/ediParser');

// The company an account acts for (owner id); dispatchers/coordinators share it.
const companyOf = (req) => String(req.user.companyOwnerId || req.user.userId);

const SHIPPER_OR_ADMIN = (req, res, next) => {
  if (req.user.role !== 'shipper' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Shippers and admins only' });
  }
  next();
};

// ── POST /inbound — receive EDI 204 ──────────────────────────────────────────
router.post('/inbound', auth, SHIPPER_OR_ADMIN, async (req, res) => {
  try {
    const { rawContent, type = '204' } = req.body;
    if (!rawContent || typeof rawContent !== 'string' || rawContent.trim().length < 50) {
      return res.status(400).json({ error: 'rawContent (EDI text) is required' });
    }
    if (!['204', '214', '210'].includes(type)) {
      return res.status(400).json({ error: 'type must be 204, 214, or 210' });
    }

    let parsedData = null;
    let status = 'received';
    let errorMessage = null;
    let isaFields = {};

    try {
      if (type === '204') {
        parsedData = parseEDI204(rawContent);
        isaFields  = {
          senderISAId:    parsedData.senderISAId,
          receiverISAId:  parsedData.receiverISAId,
          isaControlNum:  parsedData.isaControlNum,
          interchangeDate: parsedData.interchangeDate,
        };
      }
      status = 'parsed';
    } catch (parseErr) {
      errorMessage = `Parse error: ${parseErr.message}`;
      status = 'error';
    }

    const doc = await EDIDocument.create({
      direction:  'inbound',
      type,
      shipper:    req.user.role === 'shipper' ? companyOf(req) : undefined,
      rawContent: rawContent.trim(),
      parsedData,
      status,
      errorMessage,
      ...isaFields,
    });

    res.status(201).json(doc);
  } catch (err) {
    console.error('EDI inbound error:', err);
    res.status(500).json({ error: 'Failed to process EDI document' });
  }
});

// ── GET / — list documents ────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const filter = {};
    if (req.user.role === 'admin') { /* admin sees all */ }
    else if (req.user.role === 'shipper') filter.shipper = companyOf(req);
    else if (req.user.role === 'carrier') filter.carrier = companyOf(req);
    else return res.status(403).json({ error: 'Forbidden' });

    if (req.query.type)   filter.type   = req.query.type;
    if (req.query.status) filter.status = req.query.status;

    const docs = await EDIDocument.find(filter)
      .populate('load',    'title status')
      .populate('shipper', 'name companyName')
      .sort({ createdAt: -1 })
      .limit(100);

    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch EDI documents' });
  }
});

// ── GET /:id — document detail ────────────────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    // Guard: "214" and "210" look like IDs — only treat as ID if valid mongo format
    if (['214', '210', '204'].includes(req.params.id)) {
      return res.status(400).json({ error: 'Use query params to filter by type' });
    }

    const doc = await EDIDocument.findById(req.params.id)
      .populate('load',    'title origin destination status rate')
      .populate('shipper', 'name companyName')
      .populate('carrier', 'name companyName');
    if (!doc) return res.status(404).json({ error: 'Not found' });

    // Access control: only the document's shipper company, its carrier company, or an admin.
    const me = companyOf(req);
    const isParty = String(doc.shipper?._id || '') === me || String(doc.carrier?._id || '') === me;
    if (req.user.role !== 'admin' && !isParty) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch document' });
  }
});

// ── POST /:id/create-load — create Load from EDI 204 ─────────────────────────
router.post('/:id/create-load', auth, SHIPPER_OR_ADMIN, async (req, res) => {
  try {
    const doc = await EDIDocument.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    // Only the shipper company that uploaded the document may turn it into a load
    // (it is posted in that company's name). Admins may act only on a document that
    // has a shipper; a load is never posted in an admin's name.
    const isOwner = doc.shipper && String(doc.shipper) === companyOf(req);
    if (!isOwner && !(req.user.role === 'admin' && doc.shipper)) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (doc.type !== '204') return res.status(400).json({ error: 'Only 204 documents can create loads' });
    if (doc.status === 'load_created') return res.status(409).json({ error: 'Load already created from this document' });
    if (doc.status === 'error') return res.status(400).json({ error: 'Cannot create load from errored document' });
    if (!doc.parsedData) return res.status(400).json({ error: 'Document has no parsed data' });

    // Get base fields from parsed data; allow overrides from req.body
    const baseFields = edi204ToLoadFields(doc.parsedData);
    // The caller may override only these descriptive fields: never status, acceptedBy, postedBy, booking or money state.
    const OVERRIDABLE = ['title', 'origin', 'destination', 'originLat', 'originLng', 'destinationLat', 'destinationLng',
      'rate', 'equipmentType', 'loadWeight', 'commodityType', 'specialInstructions', 'pickupTimeWindow', 'deliveryTimeWindow'];
    const loadFields = { ...baseFields };
    for (const k of OVERRIDABLE) if (req.body[k] !== undefined) loadFields[k] = req.body[k];
    try {
      loadFields.pickupTimeWindow = parseWindow(loadFields.pickupTimeWindow, 'pickupTimeWindow');
      loadFields.deliveryTimeWindow = parseWindow(loadFields.deliveryTimeWindow, 'deliveryTimeWindow');
    } catch (e) { return res.status(400).json({ error: e.message }); }

    // Require minimum fields
    if (!loadFields.origin || !loadFields.destination) {
      return res.status(400).json({ error: 'Could not determine origin/destination from EDI — please provide them' });
    }
    if (!loadFields.rate) {
      return res.status(400).json({ error: 'Rate is required — provide it in the request body or ensure OID segment has freight charges' });
    }

    // Claim the document atomically so two requests cannot create two loads from it.
    const claimed = await EDIDocument.findOneAndUpdate(
      { _id: doc._id, status: doc.status, shipper: doc.shipper },
      { $set: { status: 'load_created' } },
      { new: true }
    );
    if (!claimed) return res.status(409).json({ error: 'Load already created from this document' });

    // Same bar as a form-posted load: shipper posting gate, geocoding, road distance, notifications.
    const r = await createPostedLoad({
      shipperCompanyId: String(doc.shipper),
      io: getIO(),
      fields: {
        ...loadFields,
        specialInstructions: [
          loadFields.specialInstructions,
          `EDI Doc: ${doc._id}`,
          doc.parsedData.bolNumber ? `BOL: ${doc.parsedData.bolNumber}` : null,
        ].filter(Boolean).join(' | '),
      },
    });
    if (!r.load) {
      // Release the claim so the shipper can correct the data (or finish verification) and try again.
      await EDIDocument.updateOne({ _id: doc._id, status: 'load_created', load: null }, { $set: { status: doc.status } });
      return res.status(r.status).json({ error: r.error, ...r.extra });
    }
    const load = r.load;

    claimed.load = load._id;
    await claimed.save();

    res.status(201).json({ load, ediDocument: claimed, ...(r.needsLocation && { needsLocation: true }) });
  } catch (err) {
    console.error('EDI create-load error:', err);
    res.status(500).json({ error: 'Failed to create load from EDI' });
  }
});

// ── GET /outbound/214/:loadId — generate EDI 214 ─────────────────────────────
router.get('/outbound/214/:loadId', auth, async (req, res) => {
  try {
    const load = await Load.findById(req.params.loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });

    // Only carrier assigned to load or admin
    if (req.user.role !== 'admin' && load.acceptedBy?.toString() !== companyOf(req) &&
        load.postedBy?.toString() !== companyOf(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Map load status to EDI 214 status code
    const STATUS_MAP = {
      'accepted':   'X3', // delivery appointment scheduled
      'in-transit': 'X1', // in transit
      'delivered':  'D1', // delivered
    };
    const statusCode = req.query.statusCode || STATUS_MAP[load.status] || 'X1';
    const ediText = generateEDI214(load, statusCode);

    // Store outbound record
    const doc = await EDIDocument.create({
      direction:  'outbound',
      type:       '214',
      load:       load._id,
      shipper:    load.postedBy,
      carrier:    load.acceptedBy || undefined,
      rawContent: ediText,
      status:     'sent',
      statusCode,
    });

    // Return as downloadable text
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="EDI_214_${load._id}.edi"`);
    res.send(ediText);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate EDI 214' });
  }
});

// ── GET /outbound/210/:loadId — generate EDI 210 ─────────────────────────────
router.get('/outbound/210/:loadId', auth, async (req, res) => {
  try {
    const load = await Load.findById(req.params.loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });
    if (load.status !== 'delivered') {
      return res.status(400).json({ error: 'EDI 210 can only be generated for delivered loads' });
    }

    if (req.user.role !== 'admin' && load.acceptedBy?.toString() !== companyOf(req) &&
        load.postedBy?.toString() !== companyOf(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [carrier, shipper] = await Promise.all([
      load.acceptedBy ? User.findById(load.acceptedBy).select('name companyName mcNumber').lean() : Promise.resolve(null),
      User.findById(load.postedBy).select('name companyName').lean(),
    ]);

    const ediText = generateEDI210(load, carrier, shipper);

    await EDIDocument.create({
      direction:  'outbound',
      type:       '210',
      load:       load._id,
      shipper:    load.postedBy,
      carrier:    load.acceptedBy || undefined,
      rawContent: ediText,
      status:     'sent',
    });

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="EDI_210_${load._id}.edi"`);
    res.send(ediText);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate EDI 210' });
  }
});

module.exports = router;
