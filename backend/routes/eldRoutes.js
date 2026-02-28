/**
 * ELD Routes — Hours of Service / Electronic Logging
 *
 * POST  /api/eld/status          — Log a duty status change
 * GET   /api/eld/today           — Today's log + live HOS summary
 * GET   /api/eld/logs            — Paginated history (default: last 8 days)
 * GET   /api/eld/summary         — 70-hour rolling cycle summary
 * POST  /api/eld/certify/:date   — Certify a day's log
 */

const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/authMiddleware');
const ELDLog  = require('../models/ELDLog');
const { notifyUserSafe } = require('../utils/notifyUser');

const CARRIER_ONLY = (req, res, next) => {
  if (req.user.role !== 'carrier' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Carriers only' });
  }
  next();
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function minutesBetween(start, end) {
  return Math.round((new Date(end) - new Date(start)) / 60000);
}

function computeTotals(events) {
  const totals = { drivingMinutes: 0, onDutyNotDrivingMinutes: 0, sleeperMinutes: 0, offDutyMinutes: 0 };
  for (const ev of events) {
    const mins = ev.durationMinutes || (ev.endTime ? minutesBetween(ev.startTime, ev.endTime) : 0);
    if (ev.status === 'DRIVING')             totals.drivingMinutes += mins;
    if (ev.status === 'ON_DUTY_NOT_DRIVING') totals.onDutyNotDrivingMinutes += mins;
    if (ev.status === 'SLEEPER_BERTH')       totals.sleeperMinutes += mins;
    if (ev.status === 'OFF_DUTY')            totals.offDutyMinutes += mins;
  }
  return totals;
}

function computeRemaining(totals) {
  const driveMinutes  = Math.max(0, 660 - totals.drivingMinutes);
  const onDutyTotal   = totals.drivingMinutes + totals.onDutyNotDrivingMinutes;
  const onDutyMinutes = Math.max(0, 840 - onDutyTotal);
  return { driveMinutes, onDutyMinutes };
}

function checkViolations(totals, log) {
  const violations = [];
  const onDutyTotal = totals.drivingMinutes + totals.onDutyNotDrivingMinutes;

  if (totals.drivingMinutes >= 660) {
    violations.push({ type: '11_HOUR', message: '11-hour driving limit reached', severity: 'violation' });
  } else if (totals.drivingMinutes >= 600) {
    violations.push({ type: '11_HOUR', message: `Approaching 11-hour limit (${Math.round(totals.drivingMinutes / 60 * 10) / 10}h driven)`, severity: 'warning' });
  }

  if (onDutyTotal >= 840) {
    violations.push({ type: '14_HOUR', message: '14-hour on-duty window exceeded', severity: 'violation' });
  } else if (onDutyTotal >= 780) {
    violations.push({ type: '14_HOUR', message: `Approaching 14-hour window (${Math.round(onDutyTotal / 60 * 10) / 10}h on-duty)`, severity: 'warning' });
  }

  // 30-min break check: if drove 8+ hours without a 30-min break
  let continuousDriving = 0;
  let maxBreak = 0;
  let tempBreak = 0;
  for (const ev of (log.events || [])) {
    if (ev.status === 'DRIVING') {
      continuousDriving += ev.durationMinutes || 0;
      tempBreak = 0;
    } else if (ev.status === 'OFF_DUTY' || ev.status === 'SLEEPER_BERTH') {
      tempBreak += ev.durationMinutes || 0;
      maxBreak = Math.max(maxBreak, tempBreak);
      if (tempBreak >= 30) continuousDriving = 0; // break resets the counter
    }
  }
  if (continuousDriving >= 480 && maxBreak < 30) {
    violations.push({ type: '30_MIN_BREAK', message: 'Required 30-minute break after 8 hours of driving', severity: 'violation' });
  }

  return violations;
}

// ── POST /status — log a duty status change ───────────────────────────────────
router.post('/status', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const { status, location, loadId, odometer, notes } = req.body;
    const VALID = ['OFF_DUTY', 'SLEEPER_BERTH', 'DRIVING', 'ON_DUTY_NOT_DRIVING'];
    if (!VALID.includes(status)) return res.status(400).json({ error: `status must be one of: ${VALID.join(', ')}` });

    const today = todayStr();
    const now   = new Date();

    // Get or create today's log
    let log = await ELDLog.findOne({ carrier: req.user.userId, date: today });
    if (!log) {
      log = await ELDLog.create({
        carrier:       req.user.userId,
        date:          today,
        currentStatus: 'OFF_DUTY',
        events:        [],
      });
    }

    // Close the current open event
    const openEvent = log.events.find(e => !e.endTime);
    if (openEvent) {
      openEvent.endTime         = now;
      openEvent.durationMinutes = minutesBetween(openEvent.startTime, now);
    }

    // Open new event
    log.events.push({ status, startTime: now, location, load: loadId || null, odometer, notes });
    log.currentStatus = status;

    // Recompute totals + remaining
    log.totals    = computeTotals(log.events);
    const rem     = computeRemaining(log.totals);
    log.remaining.driveMinutes  = rem.driveMinutes;
    log.remaining.onDutyMinutes = rem.onDutyMinutes;

    // Check violations
    const newViolations = checkViolations(log.totals, log);
    // Add only new violation types not already recorded today
    const existingTypes = log.violations.map(v => v.type);
    for (const v of newViolations) {
      if (!existingTypes.includes(v.type)) {
        log.violations.push(v);
        if (v.severity === 'violation') {
          notifyUserSafe(req.user.userId, {
            type:  'exception:new',
            title: 'HOS Violation',
            body:  v.message,
            link:  '/dashboard/carrier/eld',
            metadata: { date: today },
          });
        }
      }
    }

    await log.save();
    res.json(log);
  } catch (err) {
    console.error('ELD status error:', err);
    res.status(500).json({ error: 'Failed to log status' });
  }
});

// ── GET /today — today's full log ─────────────────────────────────────────────
router.get('/today', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const today = todayStr();
    let log = await ELDLog.findOne({ carrier: req.user.userId, date: today })
      .populate('events.load', 'title origin destination');

    if (!log) {
      // Return empty skeleton
      return res.json({
        carrier: req.user.userId,
        date:    today,
        currentStatus: 'OFF_DUTY',
        events:  [],
        totals:  { drivingMinutes: 0, onDutyNotDrivingMinutes: 0, sleeperMinutes: 0, offDutyMinutes: 0 },
        remaining: { driveMinutes: 660, onDutyMinutes: 840, cycleMinutes: 4200 },
        violations: [],
        certified: false,
      });
    }

    // If there's an open event, include live duration in totals
    const openEvent = log.events.find(e => !e.endTime);
    if (openEvent) {
      const liveMinutes = minutesBetween(openEvent.startTime, new Date());
      const liveTotals  = computeTotals(log.events.map(e => {
        if (!e.endTime) return { ...e.toObject(), durationMinutes: liveMinutes };
        return e;
      }));
      const liveRem = computeRemaining(liveTotals);
      return res.json({
        ...log.toObject(),
        totals:    liveTotals,
        remaining: { ...log.remaining.toObject(), ...liveRem },
        liveActiveMinutes: liveMinutes,
      });
    }

    res.json(log);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch today\'s log' });
  }
});

// ── GET /logs — paginated history ─────────────────────────────────────────────
router.get('/logs', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 8, 30);
    const from = new Date();
    from.setDate(from.getDate() - days);
    const fromStr = from.toISOString().slice(0, 10);

    const logs = await ELDLog.find({
      carrier: req.user.userId,
      date:    { $gte: fromStr },
    }).sort({ date: -1 });

    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// ── GET /summary — 70-hour rolling cycle ─────────────────────────────────────
router.get('/summary', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const from = new Date();
    from.setDate(from.getDate() - 7);
    const fromStr = from.toISOString().slice(0, 10);

    const logs = await ELDLog.find({
      carrier: req.user.userId,
      date:    { $gte: fromStr },
    }).lean();

    let totalOnDutyMinutes = 0;
    let totalDriveMinutes  = 0;
    for (const log of logs) {
      totalOnDutyMinutes += (log.totals?.drivingMinutes || 0) + (log.totals?.onDutyNotDrivingMinutes || 0);
      totalDriveMinutes  += log.totals?.drivingMinutes || 0;
    }

    // Today's open event — add live time
    const today = todayStr();
    const todayLog = logs.find(l => l.date === today);
    const openEvent = todayLog?.events?.find(e => !e.endTime);
    const liveExtra = openEvent ? minutesBetween(openEvent.startTime, new Date()) : 0;
    if (openEvent && ['DRIVING', 'ON_DUTY_NOT_DRIVING'].includes(openEvent.status)) {
      totalOnDutyMinutes += liveExtra;
      if (openEvent.status === 'DRIVING') totalDriveMinutes += liveExtra;
    }

    res.json({
      cycleHours:      70,
      usedOnDutyHours: Math.round(totalOnDutyMinutes / 60 * 10) / 10,
      usedDriveHours:  Math.round(totalDriveMinutes  / 60 * 10) / 10,
      remainingCycleHours: Math.max(0, Math.round((4200 - totalOnDutyMinutes) / 60 * 10) / 10),
      daysInCycle:     logs.length,
      logs: logs.map(l => ({
        date: l.date,
        drivingHours:  Math.round((l.totals?.drivingMinutes || 0) / 60 * 10) / 10,
        onDutyHours:   Math.round(((l.totals?.drivingMinutes || 0) + (l.totals?.onDutyNotDrivingMinutes || 0)) / 60 * 10) / 10,
        violations:    (l.violations || []).length,
        certified:     l.certified,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// ── POST /certify/:date — certify day's log ───────────────────────────────────
router.post('/certify/:date', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const { date } = req.params;
    if (date === todayStr()) {
      return res.status(400).json({ error: 'Cannot certify today\'s log until the day ends' });
    }

    const log = await ELDLog.findOne({ carrier: req.user.userId, date });
    if (!log) return res.status(404).json({ error: 'Log not found for this date' });
    if (log.certified) return res.status(409).json({ error: 'Already certified' });

    // Close any open events
    const openEvent = log.events.find(e => !e.endTime);
    if (openEvent) {
      const eod = new Date(`${date}T23:59:59`);
      openEvent.endTime         = eod;
      openEvent.durationMinutes = minutesBetween(openEvent.startTime, eod);
    }

    log.totals    = computeTotals(log.events);
    log.certified = true;
    log.certifiedAt = new Date();
    await log.save();
    res.json(log);
  } catch (err) {
    res.status(500).json({ error: 'Failed to certify log' });
  }
});

module.exports = router;
