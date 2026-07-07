/**
 * iftaRoutes.js — IFTA quarterly reporting (manual worksheet, pre-seeded).
 *
 * Fuel receipts:
 *   POST   /api/ifta/fuel                       — log a fuel purchase
 *   GET    /api/ifta/fuel?year&quarter&jurisdiction — list receipts (quarter-filtered)
 *   PUT    /api/ifta/fuel/:id                   — update a receipt (company-scoped)
 *   DELETE /api/ifta/fuel/:id                   — delete a receipt (company-scoped)
 *
 * Worksheet:
 *   GET    /api/ifta/quarters                   — list report summaries
 *   GET    /api/ifta/:year/:quarter             — get-or-build a draft (seed from data)
 *   PUT    /api/ifta/:year/:quarter             — save manual miles / mpg / rates
 *   POST   /api/ifta/:year/:quarter/finalize    — freeze the worksheet
 *   GET    /api/ifta/:year/:quarter/export      — CSV worksheet download
 *
 * Company-scoping: everything is keyed by the acting COMPANY id
 * (companyOwnerId || userId), so dispatchers/drivers roll up under the owner.
 * This is a record-keeping aid, NOT an official filing or tax advice.
 */

const express = require('express');
const router  = express.Router();
const mongoose = require('mongoose');
const { body } = require('express-validator');

const auth     = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validate');
const FuelPurchase = require('../models/FuelPurchase');
const IftaReport   = require('../models/IftaReport');
const Trip         = require('../models/Trip');

const US_JURISDICTIONS = FuelPurchase.US_JURISDICTIONS;
const FUEL_TYPES       = FuelPurchase.FUEL_TYPES;

const DISCLAIMER =
  'This IFTA worksheet is a record-keeping aid, not tax advice or an official filing. ' +
  'Verify all miles, gallons, and jurisdiction tax rates against your ELD / odometer ' +
  'records and your base jurisdiction before filing.';

// ── Guards & helpers ────────────────────────────────────────────────────────

function carrierOnly(req, res, next) {
  if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
  next();
}

/** Acting company id — sub-accounts roll up to the owner. */
function companyId(req) {
  return req.user.companyOwnerId || req.user.userId;
}

/** Round to 3 decimal places (gallons precision). */
function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

function validYearQuarter(year, quarter) {
  const nextYear = new Date().getUTCFullYear() + 1;
  return Number.isInteger(year) && year >= 2000 && year <= nextYear
    && Number.isInteger(quarter) && quarter >= 1 && quarter <= 4;
}

/** UTC [start, end) date range for a calendar quarter. */
function quarterRange(year, quarter) {
  const startMonth = (quarter - 1) * 3; // 0, 3, 6, 9
  const start = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0));
  const end   = new Date(Date.UTC(year, startMonth + 3, 1, 0, 0, 0, 0)); // exclusive
  return { start, end };
}

/** Sum tax-paid gallons per jurisdiction from fuel receipts in the range. */
async function fuelByJurisdiction(carrierObjId, start, end) {
  const rows = await FuelPurchase.aggregate([
    { $match: { carrier: carrierObjId, date: { $gte: start, $lt: end } } },
    { $group: { _id: '$jurisdiction', gallons: { $sum: '$gallons' } } },
  ]);
  const map = {};
  for (const r of rows) map[r._id] = round3(r.gallons);
  return map;
}

/** Distinct jurisdictions travelled + total miles hint from completed trips. */
async function tripSeed(carrierObjId, start, end) {
  const trips = await Trip.find({
    carrier: carrierObjId,
    status: 'completed',
    $or: [
      { actualDepartureAt: { $gte: start, $lt: end } },
      { actualArrivalAt:   { $gte: start, $lt: end } },
      { plannedDepartureAt: { $gte: start, $lt: end } },
      { createdAt: { $gte: start, $lt: end } },
    ],
  }).select('waypoints route.totalDistanceMiles');

  const states = new Set();
  let milesHint = 0;
  for (const t of trips) {
    milesHint += (t.route && t.route.totalDistanceMiles) || 0;
    for (const w of t.waypoints || []) {
      const code = w.state ? String(w.state).toUpperCase() : null;
      if (code && US_JURISDICTIONS.includes(code)) states.add(code);
    }
  }
  return { states, milesHint: round3(milesHint) };
}

/** Recompute the report rollups from its jurisdiction lines + fleetMpg. */
function recomputeRollups(report) {
  const mpg = report.fleetMpg || 6.5;
  let totalMiles = 0, taxPaid = 0, taxable = 0;
  for (const j of report.jurisdictions) {
    totalMiles += j.totalMiles || 0;
    taxPaid    += j.taxPaidGallons || 0;
    taxable    += round3((j.taxableMiles || 0) / mpg);
  }
  report.totalMiles          = round3(totalMiles);
  report.totalTaxPaidGallons = round3(taxPaid);
  report.totalTaxableGallons = round3(taxable);
  report.netTaxableGallons   = round3(taxable - taxPaid);
}

/**
 * Get-or-build the draft worksheet for a company/quarter.
 *
 * - Finalized/filed reports are returned AS-IS (frozen — no recompute).
 * - Drafts are (re)seeded: taxPaidGallons refreshed from fuel, jurisdictions
 *   unioned from fuel + trips, but manually-saved totalMiles / taxableMiles /
 *   taxRateCents are preserved.
 */
async function buildOrGetReport(companyStr, year, quarter) {
  const carrierObjId = new mongoose.Types.ObjectId(String(companyStr));
  const { start, end } = quarterRange(year, quarter);

  let report = await IftaReport.findOne({ carrier: companyStr, year, quarter });

  // Freeze — once finalized/filed the stored figures win.
  if (report && ['finalized', 'filed'].includes(report.status)) {
    return { report, quarterTotalMilesHint: report.totalMiles, fuelByState: {}, frozen: true };
  }

  const [fuelByState, seed] = await Promise.all([
    fuelByJurisdiction(carrierObjId, start, end),
    tripSeed(carrierObjId, start, end),
  ]);

  // Preserve manual per-jurisdiction entries from any existing draft.
  const existing = new Map();
  if (report) {
    for (const j of report.jurisdictions) existing.set(j.jurisdiction, j);
  }

  const codes = new Set([
    ...existing.keys(),
    ...Object.keys(fuelByState),
    ...seed.states,
  ]);

  const fleetMpg = (report && report.fleetMpg) || 6.5;

  const jurisdictions = [...codes].sort().map((code) => {
    const prev = existing.get(code) || {};
    return {
      jurisdiction:   code,
      totalMiles:     prev.totalMiles || 0,        // manual — preserved
      taxableMiles:   prev.taxableMiles || 0,      // manual — preserved
      taxPaidGallons: round3(fuelByState[code] || 0), // derived — refreshed
      taxRateCents:   (prev.taxRateCents === undefined ? null : prev.taxRateCents),
    };
  });

  const set = {
    carrier: companyStr,
    year,
    quarter,
    fleetMpg,
    jurisdictions,
    status: 'draft',
  };
  if (report) {
    if (report.milesSource)       set.milesSource = report.milesSource;
    if (report.iftaLicenseNumber) set.iftaLicenseNumber = report.iftaLicenseNumber;
    if (report.baseJurisdiction)  set.baseJurisdiction = report.baseJurisdiction;
  }

  report = await IftaReport.findOneAndUpdate(
    { carrier: companyStr, year, quarter },
    { $set: set },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Rollups from the freshly-cast subdocs.
  recomputeRollups(report);
  await report.save();

  return { report, quarterTotalMilesHint: seed.milesHint, fuelByState, frozen: false };
}

// ── Fuel receipts CRUD ──────────────────────────────────────────────────────

// POST /fuel — log a fuel purchase
router.post(
  '/fuel',
  auth,
  carrierOnly,
  [
    body('date').notEmpty().withMessage('date is required'),
    body('jurisdiction').isIn(US_JURISDICTIONS).withMessage('invalid jurisdiction'),
    body('gallons').isFloat({ gt: 0 }).withMessage('gallons must be greater than 0'),
    body('fuelType').optional().isIn(FUEL_TYPES).withMessage('invalid fuelType'),
    body('totalCostCents').optional().isInt({ min: 0 }),
    body('pricePerGallonCents').optional().isInt({ min: 0 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { tripId, date, jurisdiction, gallons, fuelType, totalCostCents, pricePerGallonCents, vendor, receiptUrl } = req.body;

      const gal = Number(gallons);
      const tcc = Math.round(Number(totalCostCents) || 0);
      let ppg = Math.round(Number(pricePerGallonCents) || 0);
      // Derive price/gallon when both cost and gallons are present.
      if (tcc > 0 && gal > 0) ppg = Math.round(tcc / gal);

      const doc = await FuelPurchase.create({
        carrier: companyId(req),
        tripId: tripId || null,
        date: new Date(date),
        jurisdiction,
        gallons: gal,
        fuelType: fuelType || 'diesel',
        totalCostCents: tcc,
        pricePerGallonCents: ppg,
        vendor: vendor || undefined,
        receiptUrl: receiptUrl || undefined,
      });

      res.status(201).json(doc);
    } catch (err) {
      console.error('[ifta] create fuel failed:', err.message);
      res.status(500).json({ error: 'Server error creating fuel purchase' });
    }
  }
);

// GET /fuel — list receipts (optionally quarter- and jurisdiction-filtered)
router.get('/fuel', auth, carrierOnly, async (req, res) => {
  try {
    const { year, quarter, jurisdiction } = req.query;
    const filter = { carrier: companyId(req) };

    if (jurisdiction) {
      if (!US_JURISDICTIONS.includes(jurisdiction)) {
        return res.status(400).json({ error: 'invalid jurisdiction' });
      }
      filter.jurisdiction = jurisdiction;
    }

    const y = parseInt(year, 10);
    const q = parseInt(quarter, 10);
    if (validYearQuarter(y, q)) {
      const { start, end } = quarterRange(y, q);
      filter.date = { $gte: start, $lt: end };
    }

    const fuelPurchases = await FuelPurchase.find(filter).sort({ date: -1 });
    res.json({ fuelPurchases });
  } catch (err) {
    console.error('[ifta] list fuel failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /fuel/:id — update a receipt (company-scoped)
router.put('/fuel/:id', auth, carrierOnly, async (req, res) => {
  try {
    const doc = await FuelPurchase.findOne({ _id: req.params.id, carrier: companyId(req) });
    if (!doc) return res.status(404).json({ error: 'Fuel purchase not found' });

    const { tripId, date, jurisdiction, gallons, fuelType, totalCostCents, pricePerGallonCents, vendor, receiptUrl } = req.body;

    if (jurisdiction !== undefined) {
      if (!US_JURISDICTIONS.includes(jurisdiction)) {
        return res.status(400).json({ error: 'invalid jurisdiction' });
      }
      doc.jurisdiction = jurisdiction;
    }
    if (gallons !== undefined) {
      const gal = Number(gallons);
      if (!(gal > 0)) return res.status(400).json({ error: 'gallons must be greater than 0' });
      doc.gallons = gal;
    }
    if (fuelType !== undefined) {
      if (!FUEL_TYPES.includes(fuelType)) return res.status(400).json({ error: 'invalid fuelType' });
      doc.fuelType = fuelType;
    }
    if (tripId !== undefined)        doc.tripId = tripId || null;
    if (date !== undefined)          doc.date = new Date(date);
    if (totalCostCents !== undefined) doc.totalCostCents = Math.round(Number(totalCostCents) || 0);
    if (pricePerGallonCents !== undefined) doc.pricePerGallonCents = Math.round(Number(pricePerGallonCents) || 0);
    if (vendor !== undefined)        doc.vendor = vendor;
    if (receiptUrl !== undefined)    doc.receiptUrl = receiptUrl;

    // Keep price/gallon consistent when both cost and gallons are known.
    if (doc.totalCostCents > 0 && doc.gallons > 0) {
      doc.pricePerGallonCents = Math.round(doc.totalCostCents / doc.gallons);
    }

    await doc.save();
    res.json(doc);
  } catch (err) {
    console.error('[ifta] update fuel failed:', err.message);
    res.status(500).json({ error: 'Server error updating fuel purchase' });
  }
});

// DELETE /fuel/:id — delete a receipt (company-scoped)
router.delete('/fuel/:id', auth, carrierOnly, async (req, res) => {
  try {
    const doc = await FuelPurchase.findOneAndDelete({ _id: req.params.id, carrier: companyId(req) });
    if (!doc) return res.status(404).json({ error: 'Fuel purchase not found' });
    res.json({ message: 'Fuel purchase deleted' });
  } catch (err) {
    console.error('[ifta] delete fuel failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Worksheet ───────────────────────────────────────────────────────────────

// GET /quarters — report summaries for the company
router.get('/quarters', auth, carrierOnly, async (req, res) => {
  try {
    const reports = await IftaReport.find({ carrier: companyId(req) })
      .select('year quarter status fleetMpg totalMiles totalTaxableGallons totalTaxPaidGallons netTaxableGallons finalizedAt updatedAt')
      .sort({ year: -1, quarter: -1 });
    res.json({ quarters: reports });
  } catch (err) {
    console.error('[ifta] list quarters failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /:year/:quarter/export — CSV worksheet download
router.get('/:year/:quarter/export', auth, carrierOnly, async (req, res) => {
  try {
    const year = parseInt(req.params.year, 10);
    const quarter = parseInt(req.params.quarter, 10);
    if (!validYearQuarter(year, quarter)) return res.status(400).json({ error: 'Invalid year or quarter' });

    const { report } = await buildOrGetReport(companyId(req), year, quarter);
    const mpg = report.fleetMpg || 6.5;

    const headers = [
      'Jurisdiction', 'Total Miles', 'Taxable Miles', 'Taxable Gallons',
      'Tax Paid Gallons', 'Net Taxable Gallons', 'Tax Rate ($/gal)', 'Tax Due ($)',
    ];

    const rows = report.jurisdictions.map((j) => {
      const taxableGallons = round3((j.taxableMiles || 0) / mpg);
      const net = round3(taxableGallons - (j.taxPaidGallons || 0));
      const rateDollars = j.taxRateCents != null ? (j.taxRateCents / 100) : null;
      const taxDue = rateDollars != null ? (net * rateDollars) : null;
      return [
        j.jurisdiction,
        j.totalMiles || 0,
        j.taxableMiles || 0,
        taxableGallons,
        j.taxPaidGallons || 0,
        net,
        rateDollars != null ? rateDollars.toFixed(4) : '',
        taxDue != null ? taxDue.toFixed(2) : '',
      ];
    });

    const csvParts = [
      `IFTA Worksheet — Q${quarter} ${year}`,
      `Fleet MPG,${mpg}`,
      `Miles Source,${report.milesSource || 'manual'}`,
      `Total Miles,${report.totalMiles}`,
      `Total Taxable Gallons,${report.totalTaxableGallons}`,
      `Total Tax-Paid Gallons,${report.totalTaxPaidGallons}`,
      `Net Taxable Gallons,${report.netTaxableGallons}`,
      '',
      headers.join(','),
      ...rows.map((r) => r.join(',')),
      '',
      `"${DISCLAIMER}"`,
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="IFTA_Q${quarter}_${year}.csv"`);
    res.send(csvParts.join('\n'));
  } catch (err) {
    console.error('[ifta] export failed:', err.message);
    res.status(500).json({ error: 'Server error generating export' });
  }
});

// POST /:year/:quarter/finalize — freeze a draft
router.post('/:year/:quarter/finalize', auth, carrierOnly, async (req, res) => {
  try {
    const year = parseInt(req.params.year, 10);
    const quarter = parseInt(req.params.quarter, 10);
    if (!validYearQuarter(year, quarter)) return res.status(400).json({ error: 'Invalid year or quarter' });

    const report = await IftaReport.findOne({ carrier: companyId(req), year, quarter });
    if (!report) return res.status(404).json({ error: 'No worksheet to finalize — open it first' });
    if (report.status !== 'draft') {
      return res.status(409).json({ error: 'Only draft reports can be finalized' });
    }

    report.status = 'finalized';
    report.finalizedAt = new Date();
    await report.save();

    res.json({ report, disclaimer: DISCLAIMER });
  } catch (err) {
    console.error('[ifta] finalize failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /:year/:quarter — save manual miles / mpg / rates (draft only)
router.put('/:year/:quarter', auth, carrierOnly, async (req, res) => {
  try {
    const year = parseInt(req.params.year, 10);
    const quarter = parseInt(req.params.quarter, 10);
    if (!validYearQuarter(year, quarter)) return res.status(400).json({ error: 'Invalid year or quarter' });

    let report = await IftaReport.findOne({ carrier: companyId(req), year, quarter });
    if (!report) {
      // Build the seeded draft first so manual edits merge onto real data.
      ({ report } = await buildOrGetReport(companyId(req), year, quarter));
    }
    if (report.status !== 'draft') {
      return res.status(409).json({ error: 'Report is finalized and cannot be edited' });
    }

    const { fleetMpg, milesSource, iftaLicenseNumber, baseJurisdiction, jurisdictions } = req.body;

    if (fleetMpg !== undefined) {
      const mpg = Number(fleetMpg);
      if (mpg > 0) report.fleetMpg = mpg;
    }
    if (milesSource !== undefined && ['manual', 'odometer', 'gps_estimated'].includes(milesSource)) {
      report.milesSource = milesSource;
    }
    if (iftaLicenseNumber !== undefined) report.iftaLicenseNumber = iftaLicenseNumber;
    if (baseJurisdiction !== undefined)  report.baseJurisdiction = baseJurisdiction;

    if (Array.isArray(jurisdictions)) {
      // Merge manual entries onto existing lines (preserving seeded taxPaidGallons).
      const lines = report.jurisdictions.map((j) => ({
        jurisdiction:   j.jurisdiction,
        totalMiles:     j.totalMiles || 0,
        taxableMiles:   j.taxableMiles || 0,
        taxPaidGallons: j.taxPaidGallons || 0,
        taxRateCents:   (j.taxRateCents === undefined ? null : j.taxRateCents),
      }));
      const byCode = new Map(lines.map((l) => [l.jurisdiction, l]));

      for (const inc of jurisdictions) {
        if (!inc || !US_JURISDICTIONS.includes(inc.jurisdiction)) continue;
        let line = byCode.get(inc.jurisdiction);
        if (!line) {
          line = { jurisdiction: inc.jurisdiction, totalMiles: 0, taxableMiles: 0, taxPaidGallons: 0, taxRateCents: null };
          lines.push(line);
          byCode.set(inc.jurisdiction, line);
        }
        if (inc.totalMiles !== undefined)   line.totalMiles = Number(inc.totalMiles) || 0;
        if (inc.taxableMiles !== undefined) line.taxableMiles = Number(inc.taxableMiles) || 0;
        if (inc.taxRateCents !== undefined) {
          line.taxRateCents = inc.taxRateCents === null ? null : Math.round(Number(inc.taxRateCents) || 0);
        }
      }

      report.jurisdictions = lines;
    }

    recomputeRollups(report);
    await report.save();

    res.json({ report, disclaimer: DISCLAIMER });
  } catch (err) {
    console.error('[ifta] save report failed:', err.message);
    res.status(500).json({ error: 'Server error saving report' });
  }
});

// GET /:year/:quarter — get-or-build the draft worksheet
router.get('/:year/:quarter', auth, carrierOnly, async (req, res) => {
  try {
    const year = parseInt(req.params.year, 10);
    const quarter = parseInt(req.params.quarter, 10);
    if (!validYearQuarter(year, quarter)) return res.status(400).json({ error: 'Invalid year or quarter' });

    const { report, quarterTotalMilesHint, fuelByState } = await buildOrGetReport(companyId(req), year, quarter);
    res.json({ report, quarterTotalMilesHint, fuelByState, disclaimer: DISCLAIMER });
  } catch (err) {
    console.error('[ifta] get report failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
