/**
 * settlementRoutes.js — Driver Settlements (carrier fleet payroll)
 *
 * A carrier company generates pay statements for its drivers from the delivered
 * loads assigned to them in a period. Every route is carrier-only and scoped to
 * the acting company (companyOwnerId || userId); write routes additionally
 * require a manager (owner/dispatcher) — drivers cannot run payroll.
 *
 * Endpoints (mounted at /api/settlements by the maintainer):
 *   POST  /generate        — build + persist a DRAFT settlement for a driver/period
 *   GET   /preview         — same computation, dry run (no persist)
 *   GET   /                — list company settlements (?driverId, ?status)
 *   GET   /:id/pdf         — render + persist the settlement PDF, return { url }
 *   GET   /:id             — company-scoped fetch
 *   PATCH /:id/finalize    — draft → finalized
 *   PATCH /:id/pay         — finalized → paid
 *   PATCH /:id/void        — draft|finalized → void (frees loads for re-settlement)
 *
 * Money is integer cents throughout.
 */

const express = require('express');
const router  = express.Router();
const { body } = require('express-validator');

const auth     = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validate');
const { managerOnly } = require('../middlewares/companyRoles');

const User       = require('../models/User');
const Load       = require('../models/Load');
const Settlement = require('../models/Settlement');
const { notifyUserSafe } = require('../utils/notifyUser');

const DEDUCTION_TYPES = ['advance', 'fuel', 'insurance', 'escrow', 'lease', 'other'];

// ── Guards ──────────────────────────────────────────────────────────────────
const carrierOnly = (req, res, next) => {
  if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
  next();
};

// ── Pay computation (all integer cents) ─────────────────────────────────────
/**
 * Driver gross for a single load line, per the snapshotted pay model.
 *   percentage → round(loadRevenueCents * pct / 100)
 *   per_mile   → round(miles * perMileCents)
 *   per_load   → perLoadCents
 *   flat       → flatCents
 */
function computeGrossCents(payType, pay, loadRevenueCents, miles) {
  const p = pay || {};
  switch (payType) {
    case 'percentage': return Math.round((Number(loadRevenueCents) || 0) * (Number(p.percentage) || 0) / 100);
    case 'per_mile':   return Math.round((Number(miles) || 0) * (Number(p.perMileCents) || 0));
    case 'per_load':   return Math.round(Number(p.perLoadCents) || 0);
    case 'flat':       return Math.round(Number(p.flatCents) || 0);
    default:           return 0;
  }
}

/** The pay figure recorded per line for auditability. */
function rateValueFor(payType, pay) {
  const p = pay || {};
  switch (payType) {
    case 'percentage': return Number(p.percentage) || 0;
    case 'per_mile':   return Number(p.perMileCents) || 0;
    case 'per_load':   return Number(p.perLoadCents) || 0;
    case 'flat':       return Number(p.flatCents) || 0;
    default:           return 0;
  }
}

/** Great-circle miles between two lat/lng points (0 if any coord is missing). */
function haversineMiles(lat1, lon1, lat2, lon2) {
  const coords = [lat1, lon1, lat2, lon2];
  if (coords.some((v) => v == null || !Number.isFinite(Number(v)))) return 0;
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const R = 3958.7613; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(a))));
}

/** Normalize + validate client-supplied deductions into cents-integer entries. */
function sanitizeDeductions(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((d) => ({
      loadId: d && d.loadId ? d.loadId : null,
      type: d && DEDUCTION_TYPES.includes(d.type) ? d.type : 'other',
      description: d && d.description ? String(d.description) : '',
      amountCents: Math.max(0, Math.round(Number(d && d.amountCents) || 0)),
    }))
    .filter((d) => d.amountCents > 0);
}

/**
 * Build a settlement draft (plain object, not persisted). Shared by /generate
 * (which persists it) and /preview (which returns it as a dry run).
 *
 * NOTE on driver.pay: the owner doc is loaded lean, so `driver.pay` is read
 * straight from the stored subdocument. This works whether or not the User
 * schema has formally declared the `pay` path yet.
 */
async function buildSettlementDraft({ companyId, generatedBy, owner, driver, start, end, bodyDeductions }) {
  const pay = driver.pay || {};
  const payType = pay.type;

  // Exclude loads already carried on this driver's NON-void settlements so a
  // load is never paid twice. Voiding a settlement frees its loads again.
  const prior = await Settlement.find({
    companyOwnerId: companyId,
    driverId: driver.driverId,
    status: { $ne: 'void' },
  }).select('lineItems.loadId').lean();

  const settled = new Set();
  for (const s of prior) {
    for (const li of s.lineItems || []) {
      if (li.loadId) settled.add(String(li.loadId));
    }
  }

  const loadFilter = {
    acceptedBy: companyId,
    status: 'delivered',
    assignedDriverId: driver.driverId,
    deliveredAt: { $gte: start, $lte: end },
  };
  if (settled.size) loadFilter._id = { $nin: Array.from(settled) };

  const loads = await Load.find(loadFilter).sort({ deliveredAt: 1 }).lean();

  // Partition deductions: those tied to a load attach to that line; the rest are
  // company-wide (e.g. weekly lease/insurance) and settle against the statement.
  const deductions = sanitizeDeductions(bodyDeductions);
  const byLoad = new Map();
  const general = [];
  for (const d of deductions) {
    const entry = { type: d.type, description: d.description, amountCents: d.amountCents };
    if (d.loadId) {
      const key = String(d.loadId);
      if (!byLoad.has(key)) byLoad.set(key, []);
      byLoad.get(key).push(entry);
    } else {
      general.push(entry);
    }
  }

  const lineItems = loads.map((load) => {
    const loadRevenueCents = load.rateCents != null ? load.rateCents : Math.round((load.rate || 0) * 100);
    const miles = haversineMiles(load.originLat, load.originLng, load.destinationLat, load.destinationLng);
    const grossCents = computeGrossCents(payType, pay, loadRevenueCents, miles);
    const lineDeductions = byLoad.get(String(load._id)) || [];
    const deductionsCents = lineDeductions.reduce((sum, d) => sum + d.amountCents, 0);
    return {
      loadId: load._id,
      loadTitle: load.title,
      origin: load.origin,
      destination: load.destination,
      deliveredAt: load.deliveredAt,
      loadRevenueCents,
      miles,
      rateType: payType,
      rateValue: rateValueFor(payType, pay),
      grossCents,
      deductions: lineDeductions,
      deductionsCents,
      netCents: grossCents - deductionsCents,
    };
  });

  // Attach company-wide deductions: to the first line if there is one, else a
  // standalone adjustments line (loadId is optional on a line item).
  if (general.length) {
    const genCents = general.reduce((sum, d) => sum + d.amountCents, 0);
    if (lineItems.length) {
      const li = lineItems[0];
      li.deductions = li.deductions.concat(general);
      li.deductionsCents += genCents;
      li.netCents = li.grossCents - li.deductionsCents;
    } else {
      lineItems.push({
        loadTitle: 'Adjustments',
        loadRevenueCents: 0,
        miles: 0,
        rateType: payType,
        rateValue: rateValueFor(payType, pay),
        grossCents: 0,
        deductions: general,
        deductionsCents: genCents,
        netCents: -genCents,
      });
    }
  }

  const grossCents = lineItems.reduce((sum, li) => sum + li.grossCents, 0);
  const deductionsCents = lineItems.reduce((sum, li) => sum + li.deductionsCents, 0);

  return {
    companyOwnerId: companyId,
    driverId: driver.driverId,
    driverName: driver.name,
    periodStart: start,
    periodEnd: end,
    payType,
    lineItems,
    grossCents,
    deductionsCents,
    netCents: grossCents - deductionsCents,
    generatedBy,
  };
}

/** Resolve + validate the period + owner + driver for generate/preview. */
async function resolveContext(req, driverId, periodStart, periodEnd) {
  const companyId = req.user.companyOwnerId || req.user.userId;
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { error: { status: 400, message: 'Invalid period dates' } };
  }
  if (start > end) {
    return { error: { status: 400, message: 'periodStart must be before periodEnd' } };
  }
  const owner = await User.findById(companyId).lean();
  if (!owner) return { error: { status: 404, message: 'Company not found' } };
  const driver = (owner.drivers || []).find((d) => d.driverId === driverId);
  if (!driver) return { error: { status: 404, message: 'Driver not found' } };
  return { companyId, start, end, owner, driver };
}

// ── POST /generate — build + persist a draft settlement ─────────────────────
router.post(
  '/generate',
  auth,
  carrierOnly,
  managerOnly,
  [
    body('driverId').trim().notEmpty().withMessage('driverId is required'),
    body('periodStart').notEmpty().withMessage('periodStart is required'),
    body('periodEnd').notEmpty().withMessage('periodEnd is required'),
  ],
  validate,
  async (req, res) => {
    try {
      const { driverId, periodStart, periodEnd, deductions } = req.body;
      const ctx = await resolveContext(req, driverId, periodStart, periodEnd);
      if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

      const draft = await buildSettlementDraft({
        companyId: ctx.companyId,
        generatedBy: req.user.userId,
        owner: ctx.owner,
        driver: ctx.driver,
        start: ctx.start,
        end: ctx.end,
        bodyDeductions: deductions,
      });

      const settlement = await Settlement.create(draft);
      res.status(201).json(settlement);
    } catch (err) {
      console.error('[settlements generate] failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ── GET /preview — dry run, no persist ──────────────────────────────────────
router.get('/preview', auth, carrierOnly, managerOnly, async (req, res) => {
  try {
    const { driverId, periodStart, periodEnd } = req.query;
    if (!driverId || !periodStart || !periodEnd) {
      return res.status(400).json({ error: 'driverId, periodStart and periodEnd are required' });
    }
    const ctx = await resolveContext(req, driverId, periodStart, periodEnd);
    if (ctx.error) return res.status(ctx.error.status).json({ error: ctx.error.message });

    const draft = await buildSettlementDraft({
      companyId: ctx.companyId,
      generatedBy: req.user.userId,
      owner: ctx.owner,
      driver: ctx.driver,
      start: ctx.start,
      end: ctx.end,
      bodyDeductions: undefined,
    });

    res.json({ ...draft, preview: true });
  } catch (err) {
    console.error('[settlements preview] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET / — list company settlements ────────────────────────────────────────
router.get('/', auth, carrierOnly, managerOnly, async (req, res) => {
  try {
    const companyId = req.user.companyOwnerId || req.user.userId;
    const filter = { companyOwnerId: companyId };
    if (req.query.driverId) filter.driverId = req.query.driverId;
    if (req.query.status) filter.status = req.query.status;

    const settlements = await Settlement.find(filter)
      .sort({ periodStart: -1, createdAt: -1 })
      .lean();
    res.json(settlements);
  } catch (err) {
    console.error('[settlements list] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /:id/pdf — render + persist the statement PDF (before GET /:id) ──────
router.get('/:id/pdf', auth, carrierOnly, managerOnly, async (req, res) => {
  try {
    const companyId = req.user.companyOwnerId || req.user.userId;
    const settlement = await Settlement.findOne({ _id: req.params.id, companyOwnerId: companyId });
    if (!settlement) return res.status(404).json({ error: 'Settlement not found' });

    const pdfGen = require('../utils/pdfGenerator');
    if (typeof pdfGen.generateSettlementStatement !== 'function') {
      return res.status(501).json({ error: 'Settlement PDF generation is not available yet' });
    }

    const owner = await User.findById(companyId).lean();
    const driver = ((owner && owner.drivers) || []).find((d) => d.driverId === settlement.driverId) || null;

    const url = await pdfGen.generateSettlementStatement(settlement, driver, owner);
    settlement.pdfUrl = url;
    await settlement.save();
    res.json({ url });
  } catch (err) {
    console.error('[settlements pdf] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /:id — company-scoped fetch ─────────────────────────────────────────
router.get('/:id', auth, carrierOnly, managerOnly, async (req, res) => {
  try {
    const companyId = req.user.companyOwnerId || req.user.userId;
    const settlement = await Settlement.findOne({ _id: req.params.id, companyOwnerId: companyId }).lean();
    if (!settlement) return res.status(404).json({ error: 'Settlement not found' });
    res.json(settlement);
  } catch (err) {
    console.error('[settlements get] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PATCH /:id/finalize — draft → finalized ─────────────────────────────────
router.patch('/:id/finalize', auth, carrierOnly, managerOnly, async (req, res) => {
  try {
    const companyId = req.user.companyOwnerId || req.user.userId;
    const settlement = await Settlement.findOne({ _id: req.params.id, companyOwnerId: companyId });
    if (!settlement) return res.status(404).json({ error: 'Settlement not found' });
    if (settlement.status !== 'draft') {
      return res.status(400).json({ error: `Only draft settlements can be finalized (current: ${settlement.status})` });
    }

    settlement.status = 'finalized';
    settlement.finalizedAt = new Date();
    await settlement.save();
    res.json(settlement);
  } catch (err) {
    console.error('[settlements finalize] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PATCH /:id/pay — finalized → paid ───────────────────────────────────────
router.patch(
  '/:id/pay',
  auth,
  carrierOnly,
  managerOnly,
  [body('payMethod').optional().isIn(['ach', 'check', 'cash', 'other']).withMessage('Invalid payMethod')],
  validate,
  async (req, res) => {
    try {
      const companyId = req.user.companyOwnerId || req.user.userId;
      const settlement = await Settlement.findOne({ _id: req.params.id, companyOwnerId: companyId });
      if (!settlement) return res.status(404).json({ error: 'Settlement not found' });
      if (settlement.status !== 'finalized') {
        return res.status(400).json({ error: `Only finalized settlements can be paid (current: ${settlement.status})` });
      }

      settlement.status = 'paid';
      settlement.paidAt = new Date();
      if (req.body.payMethod) settlement.payMethod = req.body.payMethod;
      if (req.body.paidReference) settlement.paidReference = String(req.body.paidReference);
      await settlement.save();

      await notifyUserSafe(companyId, {
        type: 'settlement:paid',
        title: 'Driver settlement paid',
        body: `${settlement.settlementNumber} · ${settlement.driverName || 'Driver'} · $${(settlement.netCents / 100).toFixed(2)}`,
        link: '/dashboard/carrier/settlements',
        metadata: {
          settlementId: settlement._id,
          driverId: settlement.driverId,
          netCents: settlement.netCents,
          payMethod: settlement.payMethod || null,
        },
      });

      res.json(settlement);
    } catch (err) {
      console.error('[settlements pay] failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ── PATCH /:id/void — draft|finalized → void (frees loads) ───────────────────
router.patch('/:id/void', auth, carrierOnly, managerOnly, async (req, res) => {
  try {
    const companyId = req.user.companyOwnerId || req.user.userId;
    const settlement = await Settlement.findOne({ _id: req.params.id, companyOwnerId: companyId });
    if (!settlement) return res.status(404).json({ error: 'Settlement not found' });
    if (settlement.status === 'paid') {
      return res.status(400).json({ error: 'Paid settlements cannot be voided' });
    }
    if (settlement.status === 'void') {
      return res.status(400).json({ error: 'Settlement is already void' });
    }

    settlement.status = 'void';
    if (req.body && req.body.notes) settlement.notes = String(req.body.notes);
    await settlement.save();
    res.json(settlement);
  } catch (err) {
    console.error('[settlements void] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
