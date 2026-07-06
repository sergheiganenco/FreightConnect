const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const auth = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validate');
const User = require('../models/User');

const ALLOWED_ENDORSEMENTS = ['hazmat', 'tanker', 'doubles_triples', 'passenger', 'school_bus'];

// ── Helper: generate a roster-unique driverId ───────────────────────────────
function generateDriverId(existingDrivers = []) {
  const existing = new Set(existingDrivers.map((d) => d.driverId));
  let id;
  do {
    id = 'drv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  } while (existing.has(id));
  return id;
}

// ── GET /  — list my drivers ────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user.drivers || []);
  } catch (err) {
    console.error('[drivers GET] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /  — add a driver ──────────────────────────────────────────────────
router.post(
  '/',
  auth,
  [body('name').trim().notEmpty().withMessage('Driver name is required')],
  validate,
  async (req, res) => {
    try {
      if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
      const user = await User.findById(req.user.userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const {
        name, phone, licenseNumber, licenseState, licenseExpiry,
        endorsements, hazmatExpiry,
      } = req.body;
      // Canonical field is medicalCardExpiry; accept the web form's legacy
      // `medicalExpiry` alias too (a silent mismatch here lost the date entirely).
      const medicalCardExpiry = req.body.medicalCardExpiry ?? req.body.medicalExpiry;

      const driver = {
        driverId: generateDriverId(user.drivers),
        name: String(name).trim(),
        phone: phone || undefined,
        licenseNumber: licenseNumber || undefined,
        licenseState: licenseState || undefined,
        licenseExpiry: licenseExpiry || undefined,
        endorsements: Array.isArray(endorsements) ? endorsements : [],
        hazmatExpiry: hazmatExpiry || undefined,
        medicalCardExpiry: medicalCardExpiry || undefined,
        status: 'active',
        createdAt: new Date(),
      };

      user.drivers.push(driver);
      await user.save();

      const created = user.drivers[user.drivers.length - 1];
      res.status(201).json(created);
    } catch (err) {
      console.error('[drivers POST] failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ── PUT /endorsements  — set carrier-level endorsements ─────────────────────
// (defined before /:driverId so 'endorsements' isn't matched as a driverId)
router.put(
  '/endorsements',
  auth,
  [body('endorsements').isArray().withMessage('endorsements must be an array')],
  validate,
  async (req, res) => {
    try {
      if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
      const user = await User.findById(req.user.userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const filtered = req.body.endorsements.filter((e) => ALLOWED_ENDORSEMENTS.includes(e));
      user.carrierEndorsements = filtered;
      await user.save();

      res.json({ carrierEndorsements: user.carrierEndorsements });
    } catch (err) {
      console.error('[drivers PUT endorsements] failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ── GET /compliance-alerts  — expiring credentials ──────────────────────────
router.get('/compliance-alerts', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const WINDOW = 30; // days

    const fields = [
      { field: 'licenseExpiry', issue: 'CDL license expiring' },
      { field: 'hazmatExpiry', issue: 'Hazmat endorsement expiring' },
      { field: 'medicalCardExpiry', issue: 'Medical card expiring' },
    ];

    const alerts = [];
    for (const driver of user.drivers || []) {
      for (const { field, issue } of fields) {
        const expiry = driver[field];
        if (!expiry) continue;
        const expiresAt = new Date(expiry);
        const daysRemaining = Math.floor((expiresAt.getTime() - now) / DAY);
        if (daysRemaining <= WINDOW) {
          alerts.push({
            driverId: driver.driverId,
            name: driver.name,
            issue: daysRemaining < 0 ? issue.replace('expiring', 'expired') : issue,
            field,
            expiresAt,
            daysRemaining,
          });
        }
      }
    }

    // Soonest-to-expire first
    alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
    res.json(alerts);
  } catch (err) {
    console.error('[drivers compliance-alerts] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /:driverId  — update a driver ───────────────────────────────────────
router.put('/:driverId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const driver = user.drivers.find((d) => d.driverId === req.params.driverId);
    if (!driver) return res.status(404).json({ error: 'Driver not found' });

    // Normalize the web form's legacy alias to the canonical field
    if (req.body.medicalExpiry !== undefined && req.body.medicalCardExpiry === undefined) {
      req.body.medicalCardExpiry = req.body.medicalExpiry;
    }

    const allowed = [
      'name', 'phone', 'licenseNumber', 'licenseState', 'licenseExpiry',
      'endorsements', 'hazmatExpiry', 'medicalCardExpiry', 'status',
    ];
    for (const key of allowed) {
      if (req.body[key] !== undefined) driver[key] = req.body[key];
    }

    await user.save();
    res.json(driver);
  } catch (err) {
    console.error('[drivers PUT] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /:driverId  — remove a driver ────────────────────────────────────
router.delete('/:driverId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const idx = user.drivers.findIndex((d) => d.driverId === req.params.driverId);
    if (idx === -1) return res.status(404).json({ error: 'Driver not found' });

    user.drivers.splice(idx, 1);
    await user.save();

    res.json({ success: true });
  } catch (err) {
    console.error('[drivers DELETE] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
