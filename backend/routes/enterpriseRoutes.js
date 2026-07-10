const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const validate = require('../middlewares/validate');
const auth = require('../middlewares/authMiddleware');
const { apiKeyAuth, requirePermission } = require('../middlewares/apiKeyAuth');

const ApiKey = require('../models/ApiKey');
const Webhook = require('../models/Webhook');
const Load = require('../models/Load');
const webhookDelivery = require('../services/webhookDelivery');
const loadParser = require('../services/loadParserService');

// All enterprise routes require authentication (API key or JWT)
router.use(apiKeyAuth);
router.use((req, res, next) => {
  // If apiKeyAuth already authenticated, skip JWT
  if (req.user) return next();
  return auth(req, res, next);
});

// ════════════════════════════════════════════════════════════════════════════════
// API KEY MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════════

const VALID_PERMISSIONS = [
  'loads:read', 'loads:write',
  'tracking:read', 'tracking:write',
  'documents:read', 'documents:write',
  'rates:read',
  'analytics:read',
  'webhooks:manage',
];

/**
 * POST /api/enterprise/api-keys — Create a new API key
 * Returns the raw key ONCE; after this it cannot be retrieved.
 */
router.post(
  '/api-keys',
  [
    body('name').isString().trim().notEmpty().withMessage('Name is required'),
    body('permissions')
      .isArray({ min: 1 })
      .withMessage('At least one permission is required'),
    body('permissions.*')
      .isIn(VALID_PERMISSIONS)
      .withMessage(`Permission must be one of: ${VALID_PERMISSIONS.join(', ')}`),
    body('rateLimit')
      .optional()
      .isInt({ min: 10, max: 10000 })
      .withMessage('Rate limit must be between 10 and 10000'),
    body('expiresAt')
      .optional()
      .isISO8601()
      .withMessage('expiresAt must be a valid ISO 8601 date'),
  ],
  validate,
  async (req, res) => {
    try {
      const { name, permissions, rateLimit, expiresAt } = req.body;

      // Limit keys per user
      const existingCount = await ApiKey.countDocuments({ userId: req.user.userId });
      if (existingCount >= 20) {
        return res.status(400).json({ error: 'Maximum of 20 API keys per user' });
      }

      const rawKey = ApiKey.generateKey();
      const hashedKey = ApiKey.hashKey(rawKey);
      const prefix = rawKey.substring(0, 16); // fc_live_ + 8 hex chars

      const apiKey = await ApiKey.create({
        userId: req.user.userId,
        name,
        key: hashedKey,
        prefix,
        permissions,
        rateLimit: rateLimit || 1000,
        expiresAt: expiresAt || undefined,
      });

      res.status(201).json({
        success: true,
        data: {
          id: apiKey._id,
          name: apiKey.name,
          key: rawKey, // Only time raw key is returned
          prefix: apiKey.prefix,
          permissions: apiKey.permissions,
          rateLimit: apiKey.rateLimit,
          expiresAt: apiKey.expiresAt,
          createdAt: apiKey.createdAt,
        },
        warning: 'Save this API key now. It cannot be retrieved again.',
      });
    } catch (err) {
      console.error('[enterprise/api-keys POST] Error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

/**
 * GET /api/enterprise/api-keys — List user's API keys (no raw keys)
 */
router.get('/api-keys', async (req, res) => {
  try {
    const keys = await ApiKey.find({ userId: req.user.userId })
      .select('-key')
      .sort({ createdAt: -1 });

    res.json({ data: keys });
  } catch (err) {
    console.error('[enterprise/api-keys GET] Error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/enterprise/api-keys/:id — Revoke an API key
 */
router.delete(
  '/api-keys/:id',
  [param('id').isMongoId().withMessage('Invalid API key ID')],
  validate,
  async (req, res) => {
    try {
      const key = await ApiKey.findOneAndDelete({
        _id: req.params.id,
        userId: req.user.userId,
      });
      if (!key) {
        return res.status(404).json({ error: 'API key not found' });
      }
      res.json({ success: true, message: 'API key revoked' });
    } catch (err) {
      console.error('[enterprise/api-keys DELETE] Error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

/**
 * PATCH /api/enterprise/api-keys/:id — Update permissions or name
 */
router.patch(
  '/api-keys/:id',
  [
    param('id').isMongoId().withMessage('Invalid API key ID'),
    body('name').optional().isString().trim().notEmpty(),
    body('permissions')
      .optional()
      .isArray({ min: 1 })
      .withMessage('At least one permission is required'),
    body('permissions.*')
      .optional()
      .isIn(VALID_PERMISSIONS),
    body('isActive').optional().isBoolean(),
  ],
  validate,
  async (req, res) => {
    try {
      const updates = {};
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.permissions !== undefined) updates.permissions = req.body.permissions;
      if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const key = await ApiKey.findOneAndUpdate(
        { _id: req.params.id, userId: req.user.userId },
        { $set: updates },
        { new: true }
      ).select('-key');

      if (!key) {
        return res.status(404).json({ error: 'API key not found' });
      }

      res.json({ success: true, data: key });
    } catch (err) {
      console.error('[enterprise/api-keys PATCH] Error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// WEBHOOK MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════════

const VALID_EVENTS = [
  'load.created', 'load.accepted', 'load.in_transit', 'load.delivered', 'load.cancelled',
  'bid.new', 'bid.accepted', 'bid.rejected', 'bid.countered',
  'payment.released', 'payment.received',
  'document.generated', 'document.uploaded',
  'exception.filed', 'exception.resolved',
];

/**
 * POST /api/enterprise/webhooks — Register a webhook endpoint
 */
router.post(
  '/webhooks',
  [
    body('url')
      .isURL({ protocols: ['https'], require_protocol: true })
      .withMessage('Webhook URL must be a valid HTTPS URL'),
    body('events')
      .isArray({ min: 1 })
      .withMessage('At least one event is required'),
    body('events.*')
      .isIn(VALID_EVENTS)
      .withMessage(`Event must be one of: ${VALID_EVENTS.join(', ')}`),
  ],
  validate,
  async (req, res) => {
    try {
      const { url, events } = req.body;

      // Limit webhooks per user
      const count = await Webhook.countDocuments({ userId: req.user.userId });
      if (count >= 10) {
        return res.status(400).json({ error: 'Maximum of 10 webhooks per user' });
      }

      const webhook = await Webhook.create({
        userId: req.user.userId,
        url,
        events,
      });

      res.status(201).json({
        success: true,
        data: {
          id: webhook._id,
          url: webhook.url,
          events: webhook.events,
          secret: webhook.secret, // Show secret once on creation
          isActive: webhook.isActive,
          createdAt: webhook.createdAt,
        },
        warning: 'Save the webhook secret now. It cannot be retrieved again.',
      });
    } catch (err) {
      console.error('[enterprise/webhooks POST] Error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

/**
 * GET /api/enterprise/webhooks — List user's webhooks
 */
router.get('/webhooks', async (req, res) => {
  try {
    const webhooks = await Webhook.find({ userId: req.user.userId })
      .select('-secret')
      .sort({ createdAt: -1 });

    res.json({ data: webhooks });
  } catch (err) {
    console.error('[enterprise/webhooks GET] Error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/enterprise/webhooks/:id — Remove a webhook
 */
router.delete(
  '/webhooks/:id',
  [param('id').isMongoId().withMessage('Invalid webhook ID')],
  validate,
  async (req, res) => {
    try {
      const webhook = await Webhook.findOneAndDelete({
        _id: req.params.id,
        userId: req.user.userId,
      });
      if (!webhook) {
        return res.status(404).json({ error: 'Webhook not found' });
      }
      res.json({ success: true, message: 'Webhook removed' });
    } catch (err) {
      console.error('[enterprise/webhooks DELETE] Error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

/**
 * PATCH /api/enterprise/webhooks/:id — Update URL or events
 */
router.patch(
  '/webhooks/:id',
  [
    param('id').isMongoId().withMessage('Invalid webhook ID'),
    body('url')
      .optional()
      .isURL({ protocols: ['https'], require_protocol: true })
      .withMessage('Webhook URL must be a valid HTTPS URL'),
    body('events')
      .optional()
      .isArray({ min: 1 }),
    body('events.*')
      .optional()
      .isIn(VALID_EVENTS),
    body('isActive').optional().isBoolean(),
  ],
  validate,
  async (req, res) => {
    try {
      const updates = {};
      if (req.body.url !== undefined) updates.url = req.body.url;
      if (req.body.events !== undefined) updates.events = req.body.events;
      if (req.body.isActive !== undefined) {
        updates.isActive = req.body.isActive;
        if (req.body.isActive) updates.failureCount = 0; // Reset on re-enable
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const webhook = await Webhook.findOneAndUpdate(
        { _id: req.params.id, userId: req.user.userId },
        { $set: updates },
        { new: true }
      ).select('-secret');

      if (!webhook) {
        return res.status(404).json({ error: 'Webhook not found' });
      }

      res.json({ success: true, data: webhook });
    } catch (err) {
      console.error('[enterprise/webhooks PATCH] Error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

/**
 * POST /api/enterprise/webhooks/:id/test — Send a test event
 */
router.post(
  '/webhooks/:id/test',
  [param('id').isMongoId().withMessage('Invalid webhook ID')],
  validate,
  async (req, res) => {
    try {
      const webhook = await Webhook.findOne({
        _id: req.params.id,
        userId: req.user.userId,
      });
      if (!webhook) {
        return res.status(404).json({ error: 'Webhook not found' });
      }

      try {
        await webhookDelivery.sendTest(webhook);
        res.json({ success: true, message: 'Test event delivered successfully' });
      } catch (deliveryErr) {
        res.status(502).json({
          success: false,
          error: 'Test delivery failed',
          reason: deliveryErr.message,
        });
      }
    } catch (err) {
      console.error('[enterprise/webhooks test] Error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// BULK OPERATIONS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/enterprise/loads/bulk — Bulk create loads (max 100)
 * Requires 'loads:write' permission for API key auth.
 */
router.post(
  '/loads/bulk',
  requirePermission('loads:write'),
  [
    body('loads')
      .isArray({ min: 1, max: 100 })
      .withMessage('loads must be an array of 1-100 items'),
    body('loads.*.title').isString().trim().notEmpty().withMessage('Each load requires a title'),
    body('loads.*.origin').isString().trim().notEmpty().withMessage('Each load requires an origin'),
    body('loads.*.destination').isString().trim().notEmpty().withMessage('Each load requires a destination'),
    body('loads.*.rate').isNumeric().withMessage('Each load requires a numeric rate'),
    body('loads.*.equipmentType').isString().trim().notEmpty().withMessage('Each load requires an equipmentType'),
  ],
  validate,
  async (req, res) => {
    try {
      if (req.user.role !== 'shipper' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only shippers and admins can create loads' });
      }

      const { loads } = req.body;
      const created = [];
      const errors = [];

      for (let i = 0; i < loads.length; i++) {
        const loadData = loads[i];
        try {
          const load = await Load.create({
            title: loadData.title,
            origin: loadData.origin,
            originLat: loadData.originLat,
            originLng: loadData.originLng,
            destination: loadData.destination,
            destinationLat: loadData.destinationLat,
            destinationLng: loadData.destinationLng,
            rate: loadData.rate,
            equipmentType: loadData.equipmentType,
            loadWeight: loadData.loadWeight,
            commodityType: loadData.commodityType,
            specialInstructions: loadData.specialInstructions,
            hazardousMaterial: loadData.hazardousMaterial || false,
            pickupTimeWindow: loadData.pickupTimeWindow,
            deliveryTimeWindow: loadData.deliveryTimeWindow,
            paymentTerms: loadData.paymentTerms,
            postedBy: req.user.userId,
            status: 'open',
          });

          created.push({ index: i, id: load._id, title: load.title });

          // Fire webhook (non-blocking)
          webhookDelivery.deliver('load.created', {
            loadId: load._id,
            title: load.title,
            origin: load.origin,
            destination: load.destination,
            rate: load.rate,
            equipmentType: load.equipmentType,
          }).catch(() => {});
        } catch (loadErr) {
          errors.push({ index: i, title: loadData.title, error: loadErr.message });
        }
      }

      res.status(created.length > 0 ? 201 : 400).json({
        success: created.length > 0,
        created,
        errors,
        summary: {
          total: loads.length,
          created: created.length,
          failed: errors.length,
        },
      });
    } catch (err) {
      console.error('[enterprise/loads/bulk] Error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

/**
 * POST /api/enterprise/loads/parse — Parse free-text load offers into structured loads.
 *
 * Turns a forwarded broker/shipper email, a pasted load list, or an OCR'd rate
 * sheet into structured load objects. Review-first by default: it returns the
 * parsed loads for confirmation and does NOT publish them. Pass `create: true`
 * to also publish the loads that have all required fields (origin, destination,
 * rate, equipment) — loads missing any are returned in `skipped` for manual
 * completion, never silently dropped.
 *
 * Uses Claude when ANTHROPIC_API_KEY is configured; otherwise a deterministic
 * heuristic parser (works with no key). Requires 'loads:write'.
 */
router.post(
  '/loads/parse',
  requirePermission('loads:write'),
  [
    body('text').isString().trim().notEmpty().withMessage('text is required')
      .isLength({ max: 20000 }).withMessage('text must be 20000 characters or fewer'),
    body('create').optional().isBoolean().withMessage('create must be a boolean'),
    body('engine').optional().isIn(['auto', 'heuristic', 'llm'])
      .withMessage('engine must be auto, heuristic, or llm'),
  ],
  validate,
  async (req, res) => {
    try {
      const { text, create = false, engine = 'auto' } = req.body;

      let result;
      try {
        result = await loadParser.parseLoads(text, { engine });
      } catch (parseErr) {
        // Only reachable when engine === 'llm' was explicitly demanded and failed.
        return res.status(502).json({ error: 'AI parser failed', reason: parseErr.message });
      }

      // Review-only (default): return what we found, publish nothing.
      if (!create) {
        return res.json({
          success: true,
          data: {
            source: result.source,
            model: result.model,
            loads: result.loads,
            warnings: result.warnings,
            counts: { parsed: result.loads.length },
          },
        });
      }

      // create=true → publish complete loads.
      if (req.user.role !== 'shipper' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only shippers and admins can create loads' });
      }

      const posterId = req.user.companyOwnerId || req.user.userId;
      const created = [];
      const skipped = [];

      for (const l of result.loads) {
        // Require the fields Load create enforces.
        const missing = [];
        if (!l.origin) missing.push('origin');
        if (!l.destination) missing.push('destination');
        if (l.rate == null) missing.push('rate');
        if (!l.equipmentType) missing.push('equipmentType');
        if (missing.length) {
          skipped.push({ title: l.title, reason: `missing ${missing.join(', ')}`, load: l });
          continue;
        }

        // Dedup on (poster, externalRef) when the source provided a ref.
        if (l.externalRef) {
          const dup = await Load.findOne({ postedBy: posterId, externalRef: l.externalRef }).select('_id');
          if (dup) {
            skipped.push({ title: l.title, reason: `duplicate of load ${dup._id} (externalRef ${l.externalRef})` });
            continue;
          }
        }

        try {
          const load = await Load.create({
            title: l.title,
            origin: l.origin,
            destination: l.destination,
            rate: l.rate,
            equipmentType: l.equipmentType,
            loadWeight: l.loadWeight || undefined,
            commodityType: l.commodityType || undefined,
            source: 'email',
            externalRef: l.externalRef || undefined,
            postedBy: posterId,
            status: 'open',
          });
          created.push({ id: load._id, title: load.title });

          webhookDelivery.deliver('load.created', {
            loadId: load._id,
            title: load.title,
            origin: load.origin,
            destination: load.destination,
            rate: load.rate,
            equipmentType: load.equipmentType,
          }).catch(() => {});
        } catch (loadErr) {
          skipped.push({ title: l.title, reason: loadErr.message });
        }
      }

      res.status(created.length > 0 ? 201 : 200).json({
        success: created.length > 0,
        data: {
          source: result.source,
          model: result.model,
          warnings: result.warnings,
          created,
          skipped,
          counts: {
            parsed: result.loads.length,
            created: created.length,
            skipped: skipped.length,
          },
        },
      });
    } catch (err) {
      console.error('[enterprise/loads/parse] Error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

/**
 * GET /api/enterprise/loads/export — Export loads with filters
 * Supports ?format=json (default) or ?format=csv
 * Cursor-based pagination with ?cursor=<lastId>&limit=<n>
 */
router.get(
  '/loads/export',
  requirePermission('loads:read'),
  [
    query('status').optional().isIn(['open', 'accepted', 'in-transit', 'delivered', 'cancelled', 'disputed']),
    query('from').optional().isISO8601().withMessage('from must be ISO 8601 date'),
    query('to').optional().isISO8601().withMessage('to must be ISO 8601 date'),
    query('format').optional().isIn(['json', 'csv']).withMessage('format must be json or csv'),
    query('limit').optional().isInt({ min: 1, max: 500 }).withMessage('limit must be 1-500'),
    query('cursor').optional().isMongoId().withMessage('cursor must be a valid ID'),
  ],
  validate,
  async (req, res) => {
    try {
      const { status, from, to, format = 'json', limit = 100, cursor } = req.query;
      const filter = {};

      // Scope to user's loads
      if (req.user.role === 'shipper') {
        filter.postedBy = req.user.userId;
      } else if (req.user.role === 'carrier') {
        filter.acceptedBy = req.user.userId;
      }
      // Admin sees all

      if (status) filter.status = status;
      if (from || to) {
        filter.createdAt = {};
        if (from) filter.createdAt.$gte = new Date(from);
        if (to) filter.createdAt.$lte = new Date(to);
      }
      if (cursor) {
        filter._id = { $gt: cursor };
      }

      const pageLimit = Math.min(parseInt(limit, 10) || 100, 500);
      const loads = await Load.find(filter)
        .sort({ _id: 1 })
        .limit(pageLimit)
        .lean();

      const nextCursor = loads.length === pageLimit ? loads[loads.length - 1]._id : null;

      if (format === 'csv') {
        const csvHeader = 'id,title,origin,destination,rate,equipmentType,status,postedBy,acceptedBy,createdAt\n';
        const csvRows = loads.map((l) =>
          [
            l._id,
            `"${(l.title || '').replace(/"/g, '""')}"`,
            `"${(l.origin || '').replace(/"/g, '""')}"`,
            `"${(l.destination || '').replace(/"/g, '""')}"`,
            l.rate,
            l.equipmentType,
            l.status,
            l.postedBy || '',
            l.acceptedBy || '',
            l.createdAt ? new Date(l.createdAt).toISOString() : '',
          ].join(',')
        ).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=loads_export.csv');
        return res.send(csvHeader + csvRows);
      }

      res.json({
        data: loads,
        pagination: {
          count: loads.length,
          limit: pageLimit,
          nextCursor,
          hasMore: nextCursor !== null,
        },
      });
    } catch (err) {
      console.error('[enterprise/loads/export] Error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// RATE & MARKET DATA
// ════════════════════════════════════════════════════════════════════════════════

// Baseline CPM (cents per mile) by equipment type
const BASE_CPM = {
  'Dry Van': 285,
  'Reefer': 340,
  'Flatbed': 310,
  'Step Deck': 300,
  'Lowboy': 360,
  'Tanker': 320,
  'Box Truck': 250,
  'Power Only': 220,
  'Conestoga': 315,
  'RGN': 380,
};
const DEFAULT_CPM = 290;

/**
 * GET /api/enterprise/rates — Market rate data for a lane
 * Query params: origin, destination, equipment (optional)
 */
router.get(
  '/rates',
  requirePermission('rates:read'),
  [
    query('origin').isString().trim().notEmpty().withMessage('origin is required'),
    query('destination').isString().trim().notEmpty().withMessage('destination is required'),
    query('equipment').optional().isString().trim(),
  ],
  validate,
  async (req, res) => {
    try {
      const { origin, destination, equipment } = req.query;
      // Escape user input before using it as a $regex to prevent ReDoS / regex injection.
      const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const originLC = escapeRegex(origin.toLowerCase());
      const destLC = escapeRegex(destination.toLowerCase());

      // Find historical loads on this lane
      const filter = {
        status: { $in: ['accepted', 'delivered'] },
        origin: { $regex: originLC, $options: 'i' },
        destination: { $regex: destLC, $options: 'i' },
      };
      if (equipment) {
        filter.equipmentType = { $regex: escapeRegex(equipment), $options: 'i' };
      }

      const historical = await Load.find(filter)
        .select('rate equipmentType createdAt')
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();

      if (historical.length === 0) {
        // Fallback to CPM-based estimate
        const cpm = BASE_CPM[equipment] || DEFAULT_CPM;
        return res.json({
          data: {
            origin,
            destination,
            equipment: equipment || 'all',
            sampleSize: 0,
            basis: 'industry_average',
            avgRate: null,
            minRate: null,
            maxRate: null,
            cpmEstimate: cpm,
            message: 'No historical data for this lane. CPM estimate provided.',
          },
        });
      }

      const rates = historical.map((l) => l.rate);
      rates.sort((a, b) => a - b);
      const avg = Math.round(rates.reduce((s, r) => s + r, 0) / rates.length);
      const p25 = rates[Math.floor(rates.length * 0.25)];
      const p75 = rates[Math.floor(rates.length * 0.75)];

      res.json({
        data: {
          origin,
          destination,
          equipment: equipment || 'all',
          sampleSize: historical.length,
          basis: 'historical',
          avgRate: avg,
          minRate: rates[0],
          maxRate: rates[rates.length - 1],
          p25Rate: p25,
          p75Rate: p75,
          recentRates: historical.slice(0, 10).map((l) => ({
            rate: l.rate,
            equipment: l.equipmentType,
            date: l.createdAt,
          })),
        },
      });
    } catch (err) {
      console.error('[enterprise/rates] Error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

/**
 * GET /api/enterprise/lanes/analytics — Lane-level analytics
 * Aggregates volume, avg rates, and transit times by lane.
 */
router.get(
  '/lanes/analytics',
  requirePermission('analytics:read'),
  [
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be 1-100'),
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
  ],
  validate,
  async (req, res) => {
    try {
      const { limit = 20, from, to } = req.query;
      const match = { status: { $in: ['accepted', 'in-transit', 'delivered'] } };

      if (from || to) {
        match.createdAt = {};
        if (from) match.createdAt.$gte = new Date(from);
        if (to) match.createdAt.$lte = new Date(to);
      }

      const lanes = await Load.aggregate([
        { $match: match },
        {
          $group: {
            _id: { origin: '$origin', destination: '$destination' },
            totalLoads: { $sum: 1 },
            avgRate: { $avg: '$rate' },
            minRate: { $min: '$rate' },
            maxRate: { $max: '$rate' },
            equipmentTypes: { $addToSet: '$equipmentType' },
            lastLoadDate: { $max: '$createdAt' },
          },
        },
        { $sort: { totalLoads: -1 } },
        { $limit: parseInt(limit, 10) || 20 },
        {
          $project: {
            _id: 0,
            origin: '$_id.origin',
            destination: '$_id.destination',
            totalLoads: 1,
            avgRate: { $round: ['$avgRate', 0] },
            minRate: 1,
            maxRate: 1,
            equipmentTypes: 1,
            lastLoadDate: 1,
          },
        },
      ]);

      res.json({
        data: lanes,
        count: lanes.length,
      });
    } catch (err) {
      console.error('[enterprise/lanes/analytics] Error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

module.exports = router;
