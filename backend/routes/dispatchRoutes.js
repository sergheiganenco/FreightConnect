/**
 * Dispatch Board -- every truck, what it is doing, what is next, what needs attention. Read-only.
 *
 * GET /api/dispatch/board?state=&q=&page=&pageSize=   (carrier owner/dispatcher only)
 */
const express = require('express');
const { query } = require('express-validator');
const auth = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validate');
const { managerOnly } = require('../middlewares/companyRoles');
const { makeLimiter } = require('../middlewares/rateLimiter');
const { buildBoard, STATES } = require('../services/dispatchBoardService');

const router = express.Router();

// Per COMPANY (a fleet office shares one IP), on top of the general API limiter.
const boardLimiter = makeLimiter({
  windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.companyOwnerId || req.user?.userId || 'anon'),
  message: { error: 'Too many requests, please try again shortly' },
}, 'rl:dispatch:');

const carrierOnly = (req, res, next) => {
  if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Only carriers can use the dispatch board' });
  next();
};

router.get('/board', auth, carrierOnly, managerOnly, boardLimiter,
  [
    query('state').optional().isIn(STATES).withMessage(`state must be one of: ${STATES.join(', ')}`),
    query('q').optional().isString().trim().isLength({ max: 100 }).withMessage('q must be at most 100 characters'),
    query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('page must be 1 or more').toInt(),
    query('pageSize').optional().isInt({ min: 10, max: 100 }).withMessage('pageSize must be 10-100').toInt(),
  ],
  validate,
  async (req, res) => {
    try {
      const { state, q, page, pageSize } = req.query;
      const data = await buildBoard({
        companyId: req.user.companyOwnerId, now: new Date(),
        filter: state || undefined, search: q || undefined, page: page || 1, pageSize: pageSize || 25,
      });
      res.json({ success: true, data });
    } catch (err) {
      console.error('[dispatch/board] failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

module.exports = router;
