/**
 * expenseRoutes.js — Carrier Expense Tracking
 *
 * POST   /api/expenses              — create expense
 * GET    /api/expenses              — list expenses (paginated, filterable by category, date range)
 * GET    /api/expenses/:id          — single expense detail
 * PUT    /api/expenses/:id          — update expense
 * DELETE /api/expenses/:id          — delete expense
 * GET    /api/expenses/summary/monthly   — monthly totals by category
 * GET    /api/expenses/summary/yearly    — yearly totals by category (for tax export)
 * GET    /api/expenses/categories        — list available categories with labels
 * POST   /api/expenses/:id/receipt       — upload receipt for expense (uses existing multer)
 */

const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/authMiddleware');
const Expense = require('../models/Expense');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

// Ensure receipts directory exists
const receiptsDir = path.join(__dirname, '..', 'public', 'documents', 'receipts');
if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: receiptsDir,
  filename: (_req, file, cb) => cb(null, `rcpt_${Date.now()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10 MB

// ── Carrier-only guard ───────────────────────────────────────────────────────
function carrierOnly(req, res, next) {
  if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
  next();
}

// ── GET /categories — available categories with labels ──────────────────────
router.get('/categories', auth, carrierOnly, (_req, res) => {
  res.json({
    categories: Expense.CATEGORIES,
    labels: Expense.CATEGORY_LABELS,
  });
});

// ── GET /summary/monthly — monthly totals for current or specified year ─────
router.get('/summary/monthly', auth, carrierOnly, async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
    const endOfYear   = new Date(`${year}-12-31T23:59:59.999Z`);

    const pipeline = [
      { $match: { carrier: req.user._userId, date: { $gte: startOfYear, $lte: endOfYear } } },
      {
        $group: {
          _id: { month: { $month: '$date' }, category: '$category' },
          total: { $sum: '$amountCents' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.month': 1 } },
    ];

    // Fix: use ObjectId properly
    const mongoose = require('mongoose');
    pipeline[0].$match.carrier = new mongoose.Types.ObjectId(req.user.userId);

    const results = await Expense.aggregate(pipeline);

    // Reshape: { month: 1, categories: { fuel: 5000, tolls: 1200, ... }, total: 6200 }
    const months = {};
    for (const r of results) {
      const m = r._id.month;
      if (!months[m]) months[m] = { month: m, categories: {}, total: 0, count: 0 };
      months[m].categories[r._id.category] = r.total;
      months[m].total += r.total;
      months[m].count += r.count;
    }

    res.json({ year, months: Object.values(months) });
  } catch (err) {
    console.error('Error fetching monthly expense summary:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /summary/yearly — year totals by category (for tax integration) ────
router.get('/summary/yearly', auth, carrierOnly, async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
    const endOfYear   = new Date(`${year}-12-31T23:59:59.999Z`);

    const mongoose = require('mongoose');
    const carrierId = new mongoose.Types.ObjectId(req.user.userId);

    const pipeline = [
      { $match: { carrier: carrierId, date: { $gte: startOfYear, $lte: endOfYear } } },
      {
        $group: {
          _id: '$category',
          total: { $sum: '$amountCents' },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ];

    const results = await Expense.aggregate(pipeline);

    const categories = {};
    let grandTotal = 0;
    let totalCount = 0;
    for (const r of results) {
      categories[r._id] = { total: r.total, count: r.count };
      grandTotal += r.total;
      totalCount += r.count;
    }

    // Mileage summary
    const mileagePipeline = [
      { $match: { carrier: carrierId, date: { $gte: startOfYear, $lte: endOfYear }, 'mileage.miles': { $gt: 0 } } },
      { $group: { _id: null, totalMiles: { $sum: '$mileage.miles' }, entries: { $sum: 1 } } },
    ];
    const [mileageResult] = await Expense.aggregate(mileagePipeline);

    res.json({
      year,
      categories,
      grandTotalCents: grandTotal,
      totalExpenses: totalCount,
      mileage: mileageResult || { totalMiles: 0, entries: 0 },
    });
  } catch (err) {
    console.error('Error fetching yearly expense summary:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST / — create expense ─────────────────────────────────────────────────
router.post('/', auth, carrierOnly, async (req, res) => {
  try {
    const { category, amountCents, vendor, description, date, location, loadId, tripId, mileage, isDeductible } = req.body;

    if (!category || !amountCents || !date) {
      return res.status(400).json({ error: 'category, amountCents, and date are required' });
    }
    if (!Expense.CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Invalid category. Valid: ${Expense.CATEGORIES.join(', ')}` });
    }
    if (amountCents < 1) {
      return res.status(400).json({ error: 'amountCents must be positive' });
    }

    const expense = await Expense.create({
      carrier: req.user.userId,
      category,
      amountCents: Math.round(amountCents),
      vendor: vendor || '',
      description: description || '',
      date: new Date(date),
      location: location || '',
      loadId: loadId || null,
      tripId: tripId || null,
      mileage: mileage || {},
      isDeductible: isDeductible !== false,
    });

    res.status(201).json(expense);
  } catch (err) {
    console.error('Error creating expense:', err);
    res.status(500).json({ error: 'Server error creating expense' });
  }
});

// ── GET / — list expenses (paginated, filterable) ──────────────────────────
router.get('/', auth, carrierOnly, async (req, res) => {
  try {
    const { category, startDate, endDate, loadId, tripId, page = 1, limit = 25, sort = '-date' } = req.query;

    const filter = { carrier: req.user.userId };
    if (category) filter.category = category;
    if (loadId)   filter.loadId = loadId;
    if (tripId)   filter.tripId = tripId;
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate)   filter.date.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [expenses, total] = await Promise.all([
      Expense.find(filter)
        .populate('loadId', 'title origin destination')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Expense.countDocuments(filter),
    ]);

    res.json({
      expenses,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) {
    console.error('Error listing expenses:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /:id — single expense ───────────────────────────────────────────────
router.get('/:id', auth, carrierOnly, async (req, res) => {
  try {
    const expense = await Expense.findOne({ _id: req.params.id, carrier: req.user.userId })
      .populate('loadId', 'title origin destination')
      .populate('tripId', 'name');
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    res.json(expense);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /:id — update expense ───────────────────────────────────────────────
router.put('/:id', auth, carrierOnly, async (req, res) => {
  try {
    const expense = await Expense.findOne({ _id: req.params.id, carrier: req.user.userId });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    const allowed = ['category', 'amountCents', 'vendor', 'description', 'date', 'location', 'loadId', 'tripId', 'mileage', 'isDeductible'];
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        if (field === 'amountCents') {
          expense[field] = Math.round(req.body[field]);
        } else if (field === 'date') {
          expense[field] = new Date(req.body[field]);
        } else {
          expense[field] = req.body[field];
        }
      }
    }

    await expense.save();
    res.json(expense);
  } catch (err) {
    console.error('Error updating expense:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /:id — delete expense ────────────────────────────────────────────
router.delete('/:id', auth, carrierOnly, async (req, res) => {
  try {
    const expense = await Expense.findOneAndDelete({ _id: req.params.id, carrier: req.user.userId });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    res.json({ message: 'Expense deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /:id/receipt — upload receipt image/PDF ────────────────────────────
router.post('/:id/receipt', auth, carrierOnly, upload.single('receipt'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const expense = await Expense.findOne({ _id: req.params.id, carrier: req.user.userId });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    expense.receiptUrl  = `/documents/receipts/${req.file.filename}`;
    expense.receiptName = req.file.originalname;
    await expense.save();

    res.json({ receiptUrl: expense.receiptUrl, receiptName: expense.receiptName });
  } catch (err) {
    console.error('Error uploading receipt:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
