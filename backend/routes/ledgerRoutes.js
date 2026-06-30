/**
 * Ledger Routes — admin-only access to the double-entry ledger.
 *
 *  GET /reconcile      — totals + balanced flag across all accounts
 *  GET /load/:loadId   — all ledger entries for a single load
 *  GET /               — paginated recent ledger entries
 */

const express = require('express');
const router = express.Router();
const auth = require('../middlewares/authMiddleware');
const LedgerEntry = require('../models/LedgerEntry');
const ledgerService = require('../services/ledgerService');

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
}

// ────────────────────────────────────────────────────────────────────────────
// GET /api/ledger/reconcile — sum debits/credits, confirm books balance
// ────────────────────────────────────────────────────────────────────────────
router.get('/reconcile', auth, adminOnly, async (req, res) => {
  try {
    const result = await ledgerService.reconcile();
    res.json(result);
  } catch (err) {
    console.error('[ledger/reconcile] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/ledger/load/:loadId — all ledger entries for a load
// ────────────────────────────────────────────────────────────────────────────
router.get('/load/:loadId', auth, adminOnly, async (req, res) => {
  try {
    const entries = await LedgerEntry.find({ loadId: req.params.loadId }).sort({ createdAt: 1 });
    res.json({ data: entries });
  } catch (err) {
    console.error('[ledger/load] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/ledger — paginated recent ledger entries
// ────────────────────────────────────────────────────────────────────────────
router.get('/', auth, adminOnly, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

    const [entries, total] = await Promise.all([
      LedgerEntry.find({})
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      LedgerEntry.countDocuments({}),
    ]);

    res.json({ data: entries, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[ledger/list] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
