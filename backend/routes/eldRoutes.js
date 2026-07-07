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
const {
  computeTotals,
  computeShiftStatus,
  checkCycleViolation,
  mergeViolations,
} = require('../services/hosRules');

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

// Gather duty events across the last few days so a shift (and the 10h rest that
// starts it) is visible even when it spans midnight. Today's events are supplied
// in-memory by the caller because they include the just-pushed, unsaved event.
async function gatherRecentEvents(carrierId, today, todayEvents) {
  const from = new Date();
  from.setDate(from.getDate() - 2);
  const fromStr = from.toISOString().slice(0, 10);
  const priorLogs = await ELDLog.find({
    carrier: carrierId,
    date: { $gte: fromStr, $lt: today },
  }).sort({ date: 1 }).select('events').lean();
  const events = [];
  for (const l of priorLogs) for (const e of (l.events || [])) events.push(e);
  for (const e of (todayEvents || [])) events.push(e);
  return events;
}

// Sum on-duty minutes across the driver's rolling 8-day cycle (excluding today,
// which the caller adds live). Used for the 70-hour check.
async function cycleOnDutyMinutesExcludingToday(carrierId, today) {
  const from = new Date();
  from.setDate(from.getDate() - 7);
  const fromStr = from.toISOString().slice(0, 10);
  const logs = await ELDLog.find({
    carrier: carrierId,
    date: { $gte: fromStr, $ne: today },
  }).select('totals').lean();
  let mins = 0;
  for (const l of logs) {
    mins += (l.totals?.drivingMinutes || 0) + (l.totals?.onDutyNotDrivingMinutes || 0);
  }
  return mins;
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

    // Day totals (for the daily-log display).
    log.totals = computeTotals(log.events);

    // Shift-accurate HOS: gather events across the last few days so a shift that
    // spans midnight (and the 10h rest before it) is visible, then compute the
    // 11h/14h/break status against the CURRENT shift — not the calendar day.
    const shiftEvents = await gatherRecentEvents(req.user.userId, today, log.events);
    const shift = computeShiftStatus(shiftEvents, now);

    log.remaining.driveMinutes  = shift.driveRemaining;
    log.remaining.onDutyMinutes = shift.windowRemaining;

    const newViolations = [...shift.violations];
    // …plus the 70h/8-day cycle (needs prior days).
    const cycleOnDuty =
      (await cycleOnDutyMinutesExcludingToday(req.user.userId, today)) +
      log.totals.drivingMinutes + log.totals.onDutyNotDrivingMinutes;
    const cycleViolation = checkCycleViolation(cycleOnDuty);
    if (cycleViolation) newViolations.push(cycleViolation);

    // Dedupe by type AND severity so a recorded "warning" no longer suppresses the
    // later "violation" of the same type. Notify only for newly-added violations.
    const { merged, added } = mergeViolations(log.violations, newViolations);
    log.violations = merged;
    for (const v of added) {
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

    // Shift-accurate live status (spans midnight; used for the gauge + remaining).
    const now = new Date();
    const shiftEvents = await gatherRecentEvents(req.user.userId, today, log.events);
    const shift = computeShiftStatus(shiftEvents, now);
    const shiftOut = {
      onShift: shift.onShift,
      shiftStart: shift.shiftStart,
      driveMinutesUsed: shift.driveMinutesUsed,
      driveRemaining: shift.driveRemaining,
      windowElapsedMinutes: shift.windowElapsedMinutes,
      windowRemaining: shift.windowRemaining,
    };

    // If there's an open event, include live duration in the day totals display.
    const openEvent = log.events.find(e => !e.endTime);
    if (openEvent) {
      const liveMinutes = minutesBetween(openEvent.startTime, now);
      const liveTotals  = computeTotals(log.events.map(e => {
        if (!e.endTime) return { ...e.toObject(), durationMinutes: liveMinutes };
        return e;
      }));
      return res.json({
        ...log.toObject(),
        totals:    liveTotals,
        // Remaining now comes from the shift model (day-bucket was the false-negative source).
        remaining: { ...log.remaining.toObject(), driveMinutes: shift.driveRemaining, onDutyMinutes: shift.windowRemaining },
        shift: shiftOut,
        liveActiveMinutes: liveMinutes,
      });
    }

    res.json({ ...log.toObject(), shift: shiftOut });
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

    // Close any open events. Day buckets are UTC (todayStr uses toISOString), so the
    // end-of-day must be UTC too — a local "T23:59:59" is parsed in server-local time
    // and produces negative/inflated durations on any non-UTC server. Guard against a
    // negative span in case the open event somehow started after end-of-day.
    const openEvent = log.events.find(e => !e.endTime);
    if (openEvent) {
      const eod = new Date(`${date}T23:59:59.999Z`);
      openEvent.endTime         = eod;
      openEvent.durationMinutes = Math.max(0, minutesBetween(openEvent.startTime, eod));
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
