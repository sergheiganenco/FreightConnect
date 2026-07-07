const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const auth = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validate');
const { managerOnly } = require('../middlewares/companyRoles');
const User = require('../models/User');
const { encrypt, maskField } = require('../utils/fieldCrypto');

const ALLOWED_ENDORSEMENTS = ['hazmat', 'tanker', 'doubles_triples', 'passenger', 'school_bus'];

/**
 * Return a driver subdoc as a plain object with the CDL number masked. Never
 * return the live Mongoose subdoc from a read path — masking it in place and
 * then saving would overwrite the ciphertext with the mask.
 */
function sanitizeDriver(driver) {
  const d = typeof driver.toObject === 'function' ? driver.toObject() : { ...driver };
  if (d.licenseNumber) d.licenseNumber = maskField(d.licenseNumber);
  return d;
}

// Coerce a driver pay config to safe integer-cents values (settlement math relies
// on these). Returns undefined when nothing usable is supplied so the schema
// default applies.
const PAY_TYPES = ['per_mile', 'per_load', 'percentage', 'flat'];
function sanitizePay(pay) {
  if (!pay || typeof pay !== 'object') return undefined;
  const intCents = (v) => Math.max(0, Math.round(Number(v) || 0));
  const out = {
    type: PAY_TYPES.includes(pay.type) ? pay.type : 'percentage',
    perMileCents: intCents(pay.perMileCents),
    perLoadCents: intCents(pay.perLoadCents),
    percentage: Math.min(100, Math.max(0, Number(pay.percentage) || 0)),
    flatCents: intCents(pay.flatCents),
  };
  return out;
}

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
    const user = await User.findById(req.user.companyOwnerId || req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json((user.drivers || []).map(sanitizeDriver));
  } catch (err) {
    console.error('[drivers GET] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /  — add a driver (owner/dispatcher only) ──────────────────────────
router.post(
  '/',
  auth,
  managerOnly,
  [body('name').trim().notEmpty().withMessage('Driver name is required')],
  validate,
  async (req, res) => {
    try {
      if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
      const user = await User.findById(req.user.companyOwnerId || req.user.userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const {
        name, phone, licenseNumber, licenseState, licenseExpiry,
        endorsements, hazmatExpiry, pay,
      } = req.body;
      // Canonical field is medicalCardExpiry; accept the web form's legacy
      // `medicalExpiry` alias too (a silent mismatch here lost the date entirely).
      const medicalCardExpiry = req.body.medicalCardExpiry ?? req.body.medicalExpiry;

      const driver = {
        driverId: generateDriverId(user.drivers),
        name: String(name).trim(),
        phone: phone || undefined,
        // CDL number is PII — encrypt at rest (AES-256-GCM); masked on read.
        licenseNumber: licenseNumber ? encrypt(String(licenseNumber).trim()) : undefined,
        licenseState: licenseState || undefined,
        licenseExpiry: licenseExpiry || undefined,
        endorsements: Array.isArray(endorsements) ? endorsements : [],
        hazmatExpiry: hazmatExpiry || undefined,
        medicalCardExpiry: medicalCardExpiry || undefined,
        pay: sanitizePay(pay),
        status: 'active',
        createdAt: new Date(),
      };

      user.drivers.push(driver);
      await user.save();

      const created = user.drivers[user.drivers.length - 1];
      res.status(201).json(sanitizeDriver(created));
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
  managerOnly,
  [body('endorsements').isArray().withMessage('endorsements must be an array')],
  validate,
  async (req, res) => {
    try {
      if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
      const user = await User.findById(req.user.companyOwnerId || req.user.userId);
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
    const user = await User.findById(req.user.companyOwnerId || req.user.userId);
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

// ── PUT /:driverId  — update a driver (owner/dispatcher only) ────────────────
router.put('/:driverId', auth, managerOnly, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
    const user = await User.findById(req.user.companyOwnerId || req.user.userId);
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
      if (req.body[key] === undefined) continue;
      if (key === 'licenseNumber') {
        // CDL number is PII — encrypt at rest. A client that renders the masked
        // value ("****6789") and submits the form unchanged would otherwise
        // overwrite the real CDL with the mask, so ignore masked echoes.
        const raw = String(req.body[key]).trim();
        if (/^\*{4}/.test(raw)) continue;
        driver.licenseNumber = encrypt(raw);
        continue;
      }
      driver[key] = req.body[key];
    }
    // Pay config is a nested object — sanitize to integer cents before storing.
    if (req.body.pay !== undefined) {
      const p = sanitizePay(req.body.pay);
      if (p) driver.pay = p;
    }

    await user.save();
    res.json(sanitizeDriver(driver));
  } catch (err) {
    console.error('[drivers PUT] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /:driverId  — remove a driver (owner/dispatcher only) ─────────────
router.delete('/:driverId', auth, managerOnly, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
    const user = await User.findById(req.user.companyOwnerId || req.user.userId);
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
