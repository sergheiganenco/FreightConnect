/**
 * /api/eld: the driver's duty-status log and hours of service.
 *
 * POST  /status            change duty status
 * GET   /today             today's log + the live clock
 * GET   /logs              recent log days
 * GET   /summary           weekly cycle summary
 * GET   /fleet             every driver's clock (owner/dispatcher)
 * POST  /certify/:date     certify a past day
 * PUT   /events/:eventId   correct an entry (a reason is required; the original is kept)
 * GET   /settings, PUT /settings   weekly limit and home time zone (PUT: owner/dispatcher)
 * GET   /record, /record/pdf       the last 8 days as one record (a manager may ask for any company driver)
 *
 * An advisory log kept in the app. It is not a registered electronic logging device.
 * All numbers come from services/hosService so no two screens can disagree.
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const router  = express.Router();
const auth    = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validate');
const { managerOnly } = require('../middlewares/companyRoles');
const ELDLog  = require('../models/ELDLog');
const User    = require('../models/User');
const { notifyUserSafe } = require('../utils/notifyUser');
const { mergeViolations, dateIn, validTimeZone } = require('../services/hosRules');
const hosService = require('../services/hosService');

const { DUTY_STATUSES } = ELDLog;
const CARRIER_ONLY = (req, res, next) => {
  if (req.user.role !== 'carrier' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Carriers only' });
  }
  next();
};
const companyOf = (req) => String(req.user.companyOwnerId || req.user.userId);
const clean = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, ' ').trim() : v);
const hours = (min) => Math.round((min / 60) * 10) / 10;

/** What the log page shows for today. */
function todayPayload(h, userId) {
  const log = h.logs.find((l) => l.date === h.today);
  const c = h.clock;
  // A status that started on an earlier day and is still running is not among today's entries.
  const carriedOver = c.statusSince && dateIn(c.statusSince, h.settings.timeZone) !== h.today
    ? { status: c.currentStatus, startTime: c.statusSince } : null;
  return {
    carrier: userId,
    date: h.today,
    events: [],
    violations: [],
    certified: false,
    ...(log || {}),
    currentStatus: c.currentStatus,
    totals: h.daily[h.today].totals,
    remaining: { driveMinutes: c.driveRemaining, onDutyMinutes: c.windowRemaining, cycleMinutes: c.cycleRemaining, breakDueIn: c.breakDueIn },
    shift: {
      onShift: c.onShift, shiftStart: c.shiftStart,
      driveMinutesUsed: c.driveMinutesUsed, driveRemaining: c.driveRemaining,
      windowElapsedMinutes: c.windowElapsedMinutes, windowRemaining: c.windowRemaining,
    },
    clock: c,
    carriedOver,
    settings: h.settings,
    liveActiveMinutes: c.statusSince ? Math.round((Date.now() - c.statusSince) / 60000) : 0,
  };
}

/** One record day: totals, entries and corrections. */
function recordDays(h) {
  return h.dates.map((date) => {
    const log = h.logs.find((l) => l.date === date);
    return {
      date,
      totals: h.daily[date].totals,
      segments: h.daily[date].segments,
      from: h.daily[date].from,
      events: (log && log.events) || [],
      edits: (log && log.edits) || [],
      violations: (log && log.violations) || [],
      certified: !!(log && log.certified),
      certifiedAt: (log && log.certifiedAt) || null,
    };
  });
}

/** The driver a request is about: yourself, or (for a manager) a member of your company. */
async function subjectDriver(req) {
  const id = req.query.driverId;
  if (!id || String(id) === String(req.user.userId)) return req.user.userId;
  if (req.user.companyRole === 'driver') return null;
  const company = companyOf(req);
  const ok = await User.exists({ _id: id, $or: [{ _id: company }, { parentAccountId: company }] });
  return ok ? id : null;
}

// ── POST /status ──────────────────────────────────────────────────────────────
router.post('/status', auth, CARRIER_ONLY, [
  body('status').isIn(DUTY_STATUSES).withMessage(`status must be one of: ${DUTY_STATUSES.join(', ')}`),
  body('location').optional({ nullable: true }).isString().isLength({ max: 200 }),
  body('notes').optional({ nullable: true }).isString().isLength({ max: 500 }),
  body('odometer').optional({ nullable: true }).isFloat({ min: 0, max: 9999999 }),
  body('loadId').optional({ nullable: true }).isMongoId(),
], validate, async (req, res) => {
  try {
    const { status, loadId, odometer } = req.body;
    const location = clean(req.body.location); const notes = clean(req.body.notes);
    // Personal conveyance and yard moves must say why, as on a registered ELD.
    if ((status === 'PERSONAL_CONVEYANCE' || status === 'YARD_MOVE') && !notes) {
      return res.status(400).json({ error: 'Add a note saying why (for example "to the nearest safe parking").' });
    }
    const companyId = companyOf(req);
    const settings = await hosService.settingsFor(companyId);
    const now = new Date();
    const today = dateIn(now, settings.timeZone);

    // Close whatever is still running, on whichever day it started (a status often runs past midnight).
    const open = await ELDLog.find({ carrier: req.user.userId, events: { $elemMatch: { endTime: null } } });
    let running = null;
    for (const l of open) for (const e of l.events) if (!e.endTime && (!running || e.startTime > running.startTime)) running = e;
    if (running && running.status === status) {
      return res.json(todayPayload(await hosService.driverHos(req.user.userId, settings, now), req.user.userId));
    }
    for (const l of open) {
      for (const e of l.events) {
        if (e.endTime) continue;
        e.endTime = now;
        e.durationMinutes = Math.max(0, Math.round((now - e.startTime) / 60000));
      }
      if (l.date !== today) await l.save();
    }

    let log = open.find((l) => l.date === today) || await ELDLog.findOneAndUpdate(
      { carrier: req.user.userId, date: today },
      { $setOnInsert: { companyId } },
      { upsert: true, new: true },
    );
    if (!log.companyId) log.companyId = companyId;
    log.events.push({ status, startTime: now, location, load: loadId || null, odometer, notes });
    log.currentStatus = status;
    await log.save();

    // Recompute from the whole timeline, then store the day figures other reports read.
    const h = await hosService.driverHos(req.user.userId, settings, now);
    for (const l of h.logs) {
      if (h.daily[l.date]) await ELDLog.updateOne({ _id: l._id }, { $set: { totals: h.daily[l.date].totals } });
    }
    const { merged, added } = mergeViolations(log.violations, h.clock.violations);
    await ELDLog.updateOne({ _id: log._id }, { $set: {
      violations: merged,
      'remaining.driveMinutes': h.clock.driveRemaining,
      'remaining.onDutyMinutes': h.clock.windowRemaining,
      'remaining.cycleMinutes': h.clock.cycleRemaining,
      'remaining.breakDueIn': h.clock.breakDueIn,
    } });
    for (const v of added) {
      if (v.severity !== 'violation') continue;
      notifyUserSafe(req.user.userId, {
        type: 'exception:new', title: 'HOS Violation', body: v.message,
        link: '/dashboard/carrier/eld', metadata: { date: today },
      });
    }

    const fresh = await hosService.driverHos(req.user.userId, settings, now);
    res.json(todayPayload(fresh, req.user.userId));
  } catch (err) {
    console.error('[eld/status] failed:', err.message);
    res.status(500).json({ error: 'Failed to log status' });
  }
});

// ── GET /today ────────────────────────────────────────────────────────────────
router.get('/today', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const h = await hosService.driverHos(req.user.userId, await hosService.settingsFor(companyOf(req)));
    res.json(todayPayload(h, req.user.userId));
  } catch (err) {
    console.error('[eld/today] failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch today\'s log' });
  }
});

// ── GET /logs ─────────────────────────────────────────────────────────────────
router.get('/logs', auth, CARRIER_ONLY, [query('days').optional().isInt({ min: 1, max: 30 })], validate, async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 8;
    const h = await hosService.driverHos(req.user.userId, await hosService.settingsFor(companyOf(req)), new Date(), days);
    // Newest first; a day with no entries of its own is listed only when something was running through it.
    res.json(h.dates
      .map((date) => ({ ...(h.logs.find((l) => l.date === date) || { date, events: [], violations: [], certified: false }), totals: h.daily[date].totals }))
      .filter((d) => d._id || Object.values(d.totals).some((n) => n > 0)));
  } catch (err) {
    console.error('[eld/logs] failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// ── GET /summary ──────────────────────────────────────────────────────────────
router.get('/summary', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const h = await hosService.driverHos(req.user.userId, await hosService.settingsFor(companyOf(req)));
    const c = h.clock;
    const days = recordDays(h).slice(0, c.cycleDays);
    res.json({
      cycleHours: c.cycleHours,
      cycleDays: c.cycleDays,
      usedOnDutyHours: hours(c.cycleUsedMinutes),
      usedDriveHours: hours(days.reduce((n, d) => n + d.totals.drivingMinutes, 0)),
      remainingCycleHours: hours(c.cycleRemaining),
      cycleRestartAt: c.cycleRestartAt,
      daysInCycle: days.filter((d) => d.totals.drivingMinutes + d.totals.onDutyNotDrivingMinutes > 0).length,
      logs: days.map((d) => ({
        date: d.date,
        drivingHours: hours(d.totals.drivingMinutes),
        onDutyHours: hours(d.totals.drivingMinutes + d.totals.onDutyNotDrivingMinutes),
        violations: d.violations.length,
        certified: d.certified,
      })),
    });
  } catch (err) {
    console.error('[eld/summary] failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// ── GET /fleet ────────────────────────────────────────────────────────────────
router.get('/fleet', auth, CARRIER_ONLY, async (req, res) => {
  try {
    if (req.user.companyRole === 'driver') {
      return res.status(403).json({ error: 'Fleet HOS is available to owners and dispatchers' });
    }
    const companyId = companyOf(req);
    const settings = await hosService.settingsFor(companyId);
    const now = new Date();
    const today = dateIn(now, settings.timeZone);
    // Everyone with an entry in the last few days (a driver still on yesterday's status has no log today).
    const since = dateIn(now.getTime() - 3 * 86400000, settings.timeZone);
    const ids = await ELDLog.distinct('carrier', { companyId, date: { $gte: since } });
    const people = await User.find({ _id: { $in: ids } }).select('name companyRole').lean();

    const drivers = await Promise.all(people.map(async (p) => {
      const h = await hosService.driverHos(p._id, settings, now);
      const todayLog = h.logs.find((l) => l.date === today);
      return {
        driverId: String(p._id),
        name: p.name || 'Driver',
        companyRole: p.companyRole || 'owner',
        currentStatus: h.clock.currentStatus,
        known: h.known,
        driveRemainingMinutes: h.clock.driveRemaining,
        windowRemainingMinutes: h.clock.windowRemaining,
        cycleRemainingMinutes: h.clock.cycleRemaining,
        drivingMinutesToday: h.daily[today].totals.drivingMinutes,
        violations: ((todayLog && todayLog.violations) || []).filter((v) => v.severity === 'violation').length,
        certified: !!(todayLog && todayLog.certified),
      };
    }));
    drivers.sort((a, b) => a.driveRemainingMinutes - b.driveRemainingMinutes);
    res.json({ date: today, drivers });
  } catch (err) {
    console.error('[eld/fleet] failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch fleet HOS' });
  }
});

// ── POST /certify/:date ───────────────────────────────────────────────────────
router.post('/certify/:date', auth, CARRIER_ONLY, [param('date').matches(/^\d{4}-\d{2}-\d{2}$/)], validate, async (req, res) => {
  try {
    const { date } = req.params;
    const settings = await hosService.settingsFor(companyOf(req));
    if (date >= dateIn(new Date(), settings.timeZone)) {
      return res.status(400).json({ error: 'Cannot certify today\'s log until the day ends' });
    }
    const log = await ELDLog.findOneAndUpdate(
      { carrier: req.user.userId, date, certified: { $ne: true } },
      { $set: { certified: true, certifiedAt: new Date() } },
      { new: true },
    );
    if (log) return res.json(log);
    const exists = await ELDLog.exists({ carrier: req.user.userId, date });
    return exists ? res.status(409).json({ error: 'Already certified' }) : res.status(404).json({ error: 'Log not found for this date' });
  } catch (err) {
    console.error('[eld/certify] failed:', err.message);
    res.status(500).json({ error: 'Failed to certify log' });
  }
});

// ── PUT /events/:eventId — correct an entry ───────────────────────────────────
// Only your own entries, only the status and start time, and always with a reason. The original
// values stay on the log, and a corrected day has to be certified again.
router.put('/events/:eventId', auth, CARRIER_ONLY, [
  param('eventId').isMongoId(),
  body('note').isString().trim().isLength({ min: 4, max: 500 }).withMessage('Say why you are correcting this entry (at least 4 characters).'),
  body('status').optional().isIn(DUTY_STATUSES),
  body('startTime').optional().isISO8601(),
], validate, async (req, res) => {
  try {
    const settings = await hosService.settingsFor(companyOf(req));
    const now = new Date();
    const log = await ELDLog.findOne({ carrier: req.user.userId, 'events._id': req.params.eventId });
    if (!log) return res.status(404).json({ error: 'Entry not found' });
    const h = await hosService.driverHos(req.user.userId, settings, now);
    if (!h.dates.includes(log.date)) return res.status(409).json({ error: 'Entries older than 8 days cannot be corrected here.' });

    const ev = log.events.id(req.params.eventId);
    const status = req.body.status || ev.status;
    const startTime = req.body.startTime ? new Date(req.body.startTime) : ev.startTime;
    if (status === ev.status && +startTime === +ev.startTime) return res.status(400).json({ error: 'Nothing was changed.' });

    // The corrected time must stay between the entries before and after it, on the same log day.
    const all = h.events.slice().sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    const i = all.findIndex((e) => String(e._id) === String(ev._id));
    const before = all[i - 1]; const after = all[i + 1];
    if (startTime > now) return res.status(400).json({ error: 'The time cannot be in the future.' });
    if (before && startTime <= new Date(before.startTime)) return res.status(400).json({ error: 'The time must be after the entry before it.' });
    if (after && startTime >= new Date(after.startTime)) return res.status(400).json({ error: 'The time must be before the entry after it.' });
    if (dateIn(startTime, settings.timeZone) !== log.date && +startTime !== +ev.startTime) {
      return res.status(400).json({ error: 'The time must stay on the same day.' });
    }

    log.edits.push({ eventId: ev._id, by: req.user.userId, from: { status: ev.status, startTime: ev.startTime }, to: { status, startTime }, note: clean(req.body.note) });
    ev.status = status;
    ev.startTime = startTime;
    if (ev.endTime) ev.durationMinutes = Math.max(0, Math.round((ev.endTime - startTime) / 60000));
    if (!after) log.currentStatus = status;
    log.certified = false;
    log.certifiedAt = undefined;
    await log.save();
    // The entry before it now ends where this one starts.
    if (before) {
      await ELDLog.updateOne(
        { carrier: req.user.userId, 'events._id': before._id },
        { $set: { 'events.$.endTime': startTime, 'events.$.durationMinutes': Math.max(0, Math.round((startTime - new Date(before.startTime)) / 60000)) } },
      );
    }
    const fresh = await hosService.driverHos(req.user.userId, settings, now);
    for (const l of fresh.logs) {
      if (fresh.daily[l.date]) await ELDLog.updateOne({ _id: l._id }, { $set: { totals: fresh.daily[l.date].totals } });
    }
    res.json(todayPayload(fresh, req.user.userId));
  } catch (err) {
    console.error('[eld/events] failed:', err.message);
    res.status(500).json({ error: 'Failed to correct the entry' });
  }
});

// ── Settings ──────────────────────────────────────────────────────────────────
router.get('/settings', auth, CARRIER_ONLY, async (req, res) => {
  try {
    res.json({ data: await hosService.settingsFor(companyOf(req)) });
  } catch (err) {
    console.error('[eld/settings] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/settings', auth, CARRIER_ONLY, managerOnly, [
  body('cycle').isIn(['70_8', '60_7']).withMessage('Choose 70 hours in 8 days or 60 hours in 7 days.'),
  body('timeZone').custom(validTimeZone).withMessage('Choose a valid time zone.'),
], validate, async (req, res) => {
  try {
    await User.updateOne({ _id: companyOf(req) }, { $set: { hosSettings: { cycle: req.body.cycle, timeZone: req.body.timeZone } } });
    res.json({ data: await hosService.settingsFor(companyOf(req)) });
  } catch (err) {
    console.error('[eld/settings] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── The 8-day record ──────────────────────────────────────────────────────────
async function buildRecord(req) {
  const driverId = await subjectDriver(req);
  if (!driverId) return null;
  const company = await User.findById(companyOf(req)).select('name companyName dotNumber mcNumber verification').lean();
  const driver = await User.findById(driverId).select('name').lean();
  const h = await hosService.driverHos(driverId, await hosService.settingsFor(companyOf(req)));
  return {
    driver: { id: String(driverId), name: (driver && driver.name) || 'Driver' },
    carrier: {
      name: (company && (company.companyName || company.name)) || '',
      dotNumber: (company && (company.verification?.dotNumber || company.dotNumber)) || '',
    },
    settings: h.settings,
    generatedAt: new Date(),
    clock: h.clock,
    known: h.known,
    days: recordDays(h),
  };
}
const recordRules = [query('driverId').optional().isMongoId()];

router.get('/record', auth, CARRIER_ONLY, recordRules, validate, async (req, res) => {
  try {
    const record = await buildRecord(req);
    if (!record) return res.status(403).json({ error: 'You can only open your own record' });
    res.json({ data: record });
  } catch (err) {
    console.error('[eld/record] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/record/pdf', auth, CARRIER_ONLY, recordRules, validate, async (req, res) => {
  try {
    const record = await buildRecord(req);
    if (!record) return res.status(403).json({ error: 'You can only open your own record' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="duty-status-${record.days[0].date}.pdf"`);
    require('../utils/pdfGenerator').streamHosRecord(record, res);
  } catch (err) {
    console.error('[eld/record/pdf] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
