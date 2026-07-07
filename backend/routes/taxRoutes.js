/**
 * taxRoutes.js — Tax & Compliance endpoints
 *
 * GET  /api/tax/summary          — current user's tax summary (all years)
 * GET  /api/tax/summary/:year    — specific year summary (calculate on-demand)
 * POST /api/tax/w9               — carrier submits W-9 info
 * GET  /api/tax/w9               — carrier retrieves their W-9 status
 * GET  /api/tax/export/:year     — export annual earnings as CSV download
 *
 * Admin-only:
 * GET  /api/tax/admin/records    — list all records (paginated, filterable)
 * POST /api/tax/admin/generate-1099/:userId/:year — mark 1099 generated + store URL
 */

const express = require('express');
const router  = express.Router();
const mongoose = require('mongoose');
const auth    = require('../middlewares/authMiddleware');
const TaxRecord = require('../models/TaxRecord');
const Load    = require('../models/Load');
const User    = require('../models/User');
const Expense = require('../models/Expense');
const Payment = require('../models/Payment');
const { PLATFORM_FEE_PCT } = require('../config/fees');
const { encrypt, maskTin } = require('../utils/fieldCrypto');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Calculate a carrier's tax summary for a given year (not persisted here).
 *
 * Money source of truth: when a released Payment exists for a load, its
 * cents-accurate settled amounts win. Loads settled off-platform (pilot mode,
 * Stripe dormant) fall back to Load.rate with the shared platform fee — the
 * same 2% the payment pipeline actually charges, not a stale hardcoded rate.
 */
async function calcCarrierSummary(userId, year) {
  const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
  const endOfYear   = new Date(`${year}-12-31T23:59:59.999Z`);

  const loads = await Load.find({
    acceptedBy: userId,
    status: 'delivered',
    deliveredAt: { $gte: startOfYear, $lte: endOfYear },
  });

  // Payments and expenses are independent — fetch them in parallel
  const [payments, expenseAgg] = await Promise.all([
    Payment.find({
      carrierId: userId,
      loadId: { $in: loads.map((l) => l._id) },
      status: 'released',
    }).select('loadId amountCents platformFeeCents'),
    Expense.aggregate([
      {
        $match: {
          carrier: new mongoose.Types.ObjectId(String(userId)),
          isDeductible: true,
          date: { $gte: startOfYear, $lte: endOfYear },
        },
      },
      { $group: { _id: null, total: { $sum: '$amountCents' } } },
    ]),
  ]);
  const paymentByLoad = new Map(payments.map((p) => [String(p.loadId), p]));

  let totalEarningsCents = 0;
  let platformFeeCents = 0;
  for (const l of loads) {
    const p = paymentByLoad.get(String(l._id));
    if (p && Number.isFinite(p.amountCents)) {
      totalEarningsCents += p.amountCents;
      platformFeeCents   += p.platformFeeCents || 0;
    } else {
      const grossCents = Math.round((l.rate || 0) * 100);
      totalEarningsCents += grossCents;
      platformFeeCents   += Math.round(grossCents * PLATFORM_FEE_PCT);
    }
  }
  const netEarningsCents = totalEarningsCents - platformFeeCents;

  // Deductible expenses logged for the year (non-deductible excluded)
  const totalExpensesCents = expenseAgg.length ? expenseAgg[0].total : 0;

  // Rough mileage estimate: no stored mileage per load — use a constant 350mi avg
  const estimatedMilesDriven = loads.length * 350;

  return {
    taxYear: year,
    loadCount: loads.length,
    totalEarningsCents,
    platformFeeCents,
    netEarningsCents,
    totalExpensesCents,
    netProfitCents: netEarningsCents - totalExpensesCents,
    estimatedMilesDriven,
    requires1099: totalEarningsCents >= 60000, // $600.00
  };
}

/** Calculate a shipper's tax summary for a given year. */
async function calcShipperSummary(userId, year) {
  const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
  const endOfYear   = new Date(`${year}-12-31T23:59:59.999Z`);

  const loads = await Load.find({
    postedBy: userId,
    status: 'delivered',
    deliveredAt: { $gte: startOfYear, $lte: endOfYear },
  });

  const totalSpendCents = loads.reduce((sum, l) => sum + Math.round((l.rate || 0) * 100), 0);

  return {
    taxYear: year,
    loadPostedCount: loads.length,
    totalSpendCents,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/tax/summary — all years for current user (from persisted records)
router.get('/summary', auth, async (req, res) => {
  try {
    const records = await TaxRecord.find({ user: req.user.userId }).sort({ taxYear: -1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: 'Server error fetching tax summary' });
  }
});

// GET /api/tax/summary/:year — calculate (and upsert) summary for a specific year
router.get('/summary/:year', auth, async (req, res) => {
  try {
    const year = parseInt(req.params.year, 10);
    if (isNaN(year) || year < 2020 || year > new Date().getFullYear() + 1) {
      return res.status(400).json({ error: 'Invalid tax year' });
    }

    const role = req.user.role;

    // Freeze filed years: once a 1099 has been generated/sent from a record,
    // recalculation must not silently rewrite the figures it was based on.
    const existing = await TaxRecord.findOne({ user: req.user.userId, taxYear: year });
    if (existing && ['generated', 'sent'].includes(existing.form1099Status)) {
      return res.json(existing);
    }

    let fields = {};

    if (role === 'carrier') {
      fields = await calcCarrierSummary(req.user.userId, year);
    } else if (role === 'shipper') {
      const s = await calcShipperSummary(req.user.userId, year);
      fields = { ...s, role: 'shipper' };
    } else {
      return res.status(403).json({ error: 'Only carriers and shippers have tax records' });
    }

    // Upsert
    const record = await TaxRecord.findOneAndUpdate(
      { user: req.user.userId, taxYear: year },
      {
        $set: {
          ...fields,
          role,
          user: req.user.userId,
          lastCalculatedAt: new Date(),
          form1099Status: fields.requires1099 ? 'pending' : 'not_required',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json(record);
  } catch (err) {
    console.error('Error calculating tax summary:', err);
    res.status(500).json({ error: 'Server error calculating tax summary' });
  }
});

// POST /api/tax/w9 — carrier submits W-9
router.post('/w9', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') {
      return res.status(403).json({ error: 'Only carriers can submit W-9' });
    }

    const {
      legalName, businessName, taxClassification,
      ein, ssnLast4, address, city, state, zip,
      exemptPayeeCode, fatcaCode,
    } = req.body;

    if (!legalName || !taxClassification) {
      return res.status(400).json({ error: 'legalName and taxClassification are required' });
    }
    if (!ein && !ssnLast4) {
      return res.status(400).json({ error: 'Either EIN or last 4 of SSN is required' });
    }

    const currentYear = new Date().getFullYear();
    const w9 = {
      legalName,
      businessName: businessName || undefined,
      taxClassification,
      // EIN is a full TIN — encrypt it at rest. SSN is stored last-4 only.
      ein: ein ? encrypt(ein) : undefined,
      ssn: ssnLast4 ? `***-**-${ssnLast4}` : undefined,
      address: address || undefined,
      city: city || undefined,
      state: state || undefined,
      zip: zip || undefined,
      exemptPayeeCode: exemptPayeeCode || undefined,
      fatcaCode: fatcaCode || undefined,
      certifiedAt: new Date(),
    };

    const record = await TaxRecord.findOneAndUpdate(
      { user: req.user.userId, taxYear: currentYear },
      {
        $set: {
          role: 'carrier',
          user: req.user.userId,
          taxYear: currentYear,
          w9,
          w9Status: 'submitted',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ message: 'W-9 submitted successfully', w9Status: record.w9Status });
  } catch (err) {
    console.error('Error submitting W-9:', err);
    res.status(500).json({ error: 'Server error submitting W-9' });
  }
});

// GET /api/tax/w9 — carrier retrieves their W-9 status (masked)
router.get('/w9', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') {
      return res.status(403).json({ error: 'Only carriers have W-9 records' });
    }
    const currentYear = new Date().getFullYear();
    const record = await TaxRecord.findOne({ user: req.user.userId, taxYear: currentYear });
    if (!record) return res.json({ w9Status: 'not_submitted', w9: null });
    // Never return the full EIN — decrypt + mask to the last 4 for display.
    const w9 = record.w9 ? { ...record.w9.toObject(), ein: record.w9.ein ? maskTin(record.w9.ein) : undefined } : null;
    res.json({ w9Status: record.w9Status, w9 });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/tax/export/:year — CSV download of annual transactions
router.get('/export/:year', auth, async (req, res) => {
  try {
    const year = parseInt(req.params.year, 10);
    if (isNaN(year)) return res.status(400).json({ error: 'Invalid year' });

    const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
    const endOfYear   = new Date(`${year}-12-31T23:59:59.999Z`);
    const role = req.user.role;

    let loads;
    if (role === 'carrier') {
      loads = await Load.find({ acceptedBy: req.user.userId, status: 'delivered', deliveredAt: { $gte: startOfYear, $lte: endOfYear } })
        .select('title origin destination rate deliveredAt');
    } else {
      loads = await Load.find({ postedBy: req.user.userId, status: 'delivered', deliveredAt: { $gte: startOfYear, $lte: endOfYear } })
        .populate('acceptedBy', 'name companyName')
        .select('title origin destination rate deliveredAt acceptedBy');
    }

    // Build CSV — Income section
    const incomeHeaders = role === 'carrier'
      ? ['Date', 'Load Title', 'Origin', 'Destination', 'Gross ($)', 'Platform Fee ($)', 'Net ($)']
      : ['Date', 'Load Title', 'Origin', 'Destination', 'Amount ($)', 'Carrier'];

    const incomeRows = loads.map(l => {
      const date = l.deliveredAt ? new Date(l.deliveredAt).toLocaleDateString('en-US') : '';
      const rate = (l.rate || 0).toFixed(2);
      if (role === 'carrier') {
        // Integer-cents math (house money rule) — matches the /summary fallback exactly
        const grossCents = Math.round((l.rate || 0) * 100);
        const feeCents = Math.round(grossCents * PLATFORM_FEE_PCT);
        const fee = (feeCents / 100).toFixed(2);
        const net = ((grossCents - feeCents) / 100).toFixed(2);
        return [date, `"${l.title}"`, `"${l.origin}"`, `"${l.destination}"`, rate, fee, net];
      } else {
        const carrier = l.acceptedBy?.companyName || l.acceptedBy?.name || 'N/A';
        return [date, `"${l.title}"`, `"${l.origin}"`, `"${l.destination}"`, rate, `"${carrier}"`];
      }
    });

    const csvParts = [
      '--- INCOME ---',
      incomeHeaders.join(','),
      ...incomeRows.map(r => r.join(',')),
    ];

    // Expenses section (carrier only)
    if (role === 'carrier') {
      const expenses = await Expense.find({
        carrier: req.user.userId,
        date: { $gte: startOfYear, $lte: endOfYear },
      }).sort({ date: 1 });

      if (expenses.length > 0) {
        const expHeaders = ['Date', 'Category', 'Vendor', 'Description', 'Amount ($)', 'Deductible', 'Mileage'];
        const expRows = expenses.map(e => {
          const date = new Date(e.date).toLocaleDateString('en-US');
          const amount = (e.amountCents / 100).toFixed(2);
          const cat = (Expense.CATEGORY_LABELS[e.category] || e.category);
          const miles = e.mileage?.miles || '';
          return [date, `"${cat}"`, `"${e.vendor}"`, `"${e.description}"`, amount, e.isDeductible ? 'Yes' : 'No', miles];
        });

        // SUMMARY must agree with /summary (the 1099 basis): same Payment-preferred
        // gross/fee and same deductible-only expense subtraction.
        const summary = await calcCarrierSummary(req.user.userId, year);

        csvParts.push('');
        csvParts.push('--- EXPENSES ---');
        csvParts.push(expHeaders.join(','));
        csvParts.push(...expRows.map(r => r.join(',')));
        csvParts.push('');
        csvParts.push('--- SUMMARY ---');
        csvParts.push(`Gross Income,$${(summary.totalEarningsCents / 100).toFixed(2)}`);
        csvParts.push(`Platform Fees (${(PLATFORM_FEE_PCT * 100).toFixed(0)}%),$${(summary.platformFeeCents / 100).toFixed(2)}`);
        csvParts.push(`Deductible Expenses,$${(summary.totalExpensesCents / 100).toFixed(2)}`);
        csvParts.push(`Net Profit,$${(summary.netProfitCents / 100).toFixed(2)}`);
      }
    }

    const csv = csvParts.join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="FreightConnect_${role}_${year}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Error exporting tax CSV:', err);
    res.status(500).json({ error: 'Server error generating export' });
  }
});

// ── Admin routes ──────────────────────────────────────────────────────────────

// GET /api/tax/admin/records — paginated list of all tax records
router.get('/admin/records', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const { year, role: roleFilter, w9Status, requires1099, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (year)         filter.taxYear  = parseInt(year, 10);
    if (roleFilter)   filter.role     = roleFilter;
    if (w9Status)     filter.w9Status = w9Status;
    if (requires1099 === 'true') filter.requires1099 = true;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [records, total] = await Promise.all([
      TaxRecord.find(filter)
        .populate('user', 'name email companyName mcNumber')
        .sort({ taxYear: -1, totalEarningsCents: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      TaxRecord.countDocuments(filter),
    ]);

    res.json({ records, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tax/admin/generate-1099/:userId/:year — mark 1099 as generated
router.post('/admin/generate-1099/:userId/:year', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const { form1099Url } = req.body;
    const year = parseInt(req.params.year, 10);

    const record = await TaxRecord.findOneAndUpdate(
      { user: req.params.userId, taxYear: year },
      { $set: { form1099Status: 'generated', form1099Url: form1099Url || undefined, generatedAt: new Date() } },
      { new: true }
    );

    if (!record) return res.status(404).json({ error: 'Tax record not found' });
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
