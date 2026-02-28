/**
 * Reefer Routes — Temperature Monitoring for Refrigerated Loads
 *
 * POST  /api/reefer/readings/:loadId    — Carrier logs a temp reading
 * GET   /api/reefer/readings/:loadId    — History (last N hours, default 24)
 * GET   /api/reefer/status/:loadId      — Latest reading + alert status + stats
 * PUT   /api/reefer/settings/:loadId    — Shipper updates reefer settings
 */

const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/authMiddleware');
const TempReading = require('../models/TempReading');
const Load    = require('../models/Load');
const { notifyUserSafe } = require('../utils/notifyUser');

// ── Helpers ────────────────────────────────────────────────────────────────────
function cToF(c) { return Math.round((c * 9 / 5 + 32) * 10) / 10; }

function checkAlert(tempC, reefer) {
  if (!reefer?.enabled) return null;
  const min = reefer.targetMinC;
  const max = reefer.targetMaxC;
  if (min != null && tempC < min) {
    return `Temperature ${tempC}°C is below minimum ${min}°C (${cToF(min)}°F)`;
  }
  if (max != null && tempC > max) {
    return `Temperature ${tempC}°C exceeds maximum ${max}°C (${cToF(max)}°F)`;
  }
  return null;
}

// ── POST /readings/:loadId — log a temperature reading ────────────────────────
router.post('/readings/:loadId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Carriers only' });
    }

    const load = await Load.findById(req.params.loadId)
      .populate('postedBy', 'name')
      .populate('acceptedBy', 'name');
    if (!load) return res.status(404).json({ error: 'Load not found' });
    if (load.acceptedBy?.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You are not assigned to this load' });
    }

    const { tempC, tempF, humidity, location, notes } = req.body;
    // Accept either Celsius or Fahrenheit
    let celsius = tempC !== undefined
      ? parseFloat(tempC)
      : tempF !== undefined ? Math.round((parseFloat(tempF) - 32) * 5 / 9 * 10) / 10 : null;

    if (celsius === null || isNaN(celsius)) {
      return res.status(400).json({ error: 'tempC or tempF is required' });
    }

    // Check against reefer settings
    const alertMsg = checkAlert(celsius, load.reefer);
    const reading = await TempReading.create({
      load:         load._id,
      carrier:      req.user.userId,
      tempC:        celsius,
      humidity:     humidity ? parseFloat(humidity) : undefined,
      location,
      notes,
      isAlert:      !!alertMsg,
      alertMessage: alertMsg || undefined,
    });

    // Fire notification if out of range
    if (alertMsg && load.reefer?.alertOnDeviation) {
      // Notify carrier
      notifyUserSafe(req.user.userId, {
        type:  'exception:new',
        title: 'Reefer Alert',
        body:  alertMsg,
        link:  `/dashboard/carrier/loads`,
        metadata: { loadId: load._id },
      });
      // Notify shipper
      if (load.postedBy?._id) {
        notifyUserSafe(load.postedBy._id.toString(), {
          type:  'exception:new',
          title: 'Reefer Alert',
          body:  `Load "${load.title}": ${alertMsg}`,
          link:  `/dashboard/shipper/loads`,
          metadata: { loadId: load._id },
        });
      }
    }

    res.status(201).json({ reading, alert: alertMsg || null });
  } catch (err) {
    console.error('Reefer reading error:', err);
    res.status(500).json({ error: 'Failed to log reading' });
  }
});

// ── GET /readings/:loadId — temperature history ────────────────────────────────
router.get('/readings/:loadId', auth, async (req, res) => {
  try {
    const load = await Load.findById(req.params.loadId).select('postedBy acceptedBy reefer');
    if (!load) return res.status(404).json({ error: 'Load not found' });

    // Both shipper (postedBy) and carrier (acceptedBy) can view
    const uid = req.user.userId;
    if (
      req.user.role !== 'admin' &&
      load.postedBy?.toString() !== uid &&
      load.acceptedBy?.toString() !== uid
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const hours = Math.min(parseInt(req.query.hours, 10) || 24, 168); // max 7 days
    const from  = new Date(Date.now() - hours * 3600 * 1000);

    const readings = await TempReading.find({
      load:       load._id,
      recordedAt: { $gte: from },
    }).sort({ recordedAt: 1 });

    res.json({ readings, reefer: load.reefer });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch readings' });
  }
});

// ── GET /status/:loadId — latest reading + summary ────────────────────────────
router.get('/status/:loadId', auth, async (req, res) => {
  try {
    const load = await Load.findById(req.params.loadId).select('postedBy acceptedBy reefer title');
    if (!load) return res.status(404).json({ error: 'Load not found' });

    const uid = req.user.userId;
    if (
      req.user.role !== 'admin' &&
      load.postedBy?.toString() !== uid &&
      load.acceptedBy?.toString() !== uid
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [latest, alertCount, totalCount] = await Promise.all([
      TempReading.findOne({ load: load._id }).sort({ recordedAt: -1 }),
      TempReading.countDocuments({ load: load._id, isAlert: true }),
      TempReading.countDocuments({ load: load._id }),
    ]);

    // Last 24h stats
    const since24h = new Date(Date.now() - 86400000);
    const recent = await TempReading.find({ load: load._id, recordedAt: { $gte: since24h } })
      .sort({ recordedAt: 1 });

    const temps = recent.map(r => r.tempC);
    const stats24h = temps.length
      ? {
          minC: Math.min(...temps),
          maxC: Math.max(...temps),
          avgC: Math.round(temps.reduce((a, b) => a + b, 0) / temps.length * 10) / 10,
          count: temps.length,
        }
      : null;

    res.json({
      reefer:      load.reefer,
      latest,
      alertCount,
      totalCount,
      stats24h,
      currentAlert: latest?.isAlert ? latest.alertMessage : null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// ── PUT /settings/:loadId — shipper updates reefer target range ───────────────
router.put('/settings/:loadId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'shipper' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Shippers only' });
    }
    const load = await Load.findById(req.params.loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });
    if (load.postedBy?.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { targetMinC, targetMaxC, alertOnDeviation, notes } = req.body;
    if (!load.reefer) load.reefer = { enabled: true };
    load.reefer.enabled = true;
    if (targetMinC !== undefined) load.reefer.targetMinC = parseFloat(targetMinC);
    if (targetMaxC !== undefined) load.reefer.targetMaxC = parseFloat(targetMaxC);
    if (alertOnDeviation !== undefined) load.reefer.alertOnDeviation = Boolean(alertOnDeviation);
    if (notes !== undefined) load.reefer.notes = notes;

    load.markModified('reefer');
    await load.save();
    res.json(load.reefer);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update reefer settings' });
  }
});

module.exports = router;
