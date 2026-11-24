/**
 * Hours of service for one driver, read from the duty-status log.
 *
 * Every screen and every check (the log page, the fleet view, the planner, driver assignment, the
 * printed record) gets its numbers here, so they cannot disagree.
 */
const ELDLog = require('../models/ELDLog');
const User = require('../models/User');
const { computeClock, dailySummaries, dateIn, addDays, isRest } = require('./hosRules');

const HOUR_MS = 3600000;
const DEFAULTS = { cycle: '70_8', timeZone: 'America/Chicago' };
// A working status left running this long was almost certainly forgotten, not worked.
const STALE_MS = 16 * HOUR_MS;

async function settingsFor(companyId) {
  const u = await User.findById(companyId).select('hosSettings').lean();
  return {
    cycle: (u && u.hosSettings && u.hosSettings.cycle) || DEFAULTS.cycle,
    timeZone: (u && u.hosSettings && u.hosSettings.timeZone) || DEFAULTS.timeZone,
  };
}

/**
 * @returns {{ settings, today, dates, logs, events, clock, daily, known }}
 *   `known` is false when there is nothing recent to go on (no entries, or a working status left running).
 */
async function driverHos(driverId, settings, now = new Date(), days = 8) {
  const today = dateIn(now, settings.timeZone);
  const logs = await ELDLog.find({ carrier: driverId, date: { $gte: addDays(today, -(Math.max(days, 8) + 1)) } })
    .sort({ date: 1 }).lean();
  const events = logs.flatMap((l) => l.events || []).filter((e) => e && e.startTime);
  const clock = computeClock(events, now, { cycle: settings.cycle, tz: settings.timeZone });
  const dates = Array.from({ length: days }, (_, i) => addDays(today, -i));
  const daily = dailySummaries(events, settings.timeZone, dates, now);
  const stale = !!clock.statusSince && !isRest(clock.currentStatus) && now - clock.statusSince > STALE_MS;
  return { settings, today, dates, logs, events, clock, daily, known: events.length > 0 && !stale };
}

/**
 * Can this driver legally start a load that must be picked up by `pickupBy`?
 * @returns {{ ok: boolean, warning?: string, message?: string, readyAt?: Date }}
 */
function hoursCheck(h, pickupBy, now = new Date()) {
  if (!h || !h.known) return { ok: true, warning: 'This driver has no recent hours-of-service log, so their hours were not checked.' };
  const c = h.clock;
  if (c.driveableMinutes > 0) {
    return c.driveableMinutes < 120
      ? { ok: true, warning: `This driver has only ${Math.floor(c.driveableMinutes / 60)}h ${c.driveableMinutes % 60}m of driving time left on their current shift.` }
      : { ok: true };
  }
  // Out of hours. ponytail: a used-up cycle is assumed to need a 34-hour restart; hours also come back as old days roll off, which this does not model.
  const restFrom = c.restingSince ? +c.restingSince : +now;
  const readyAt = new Date(restFrom + (c.cycleRemaining === 0 ? 34 : 10) * HOUR_MS);
  const pickup = pickupBy ? new Date(pickupBy) : now;
  if (pickup < readyAt) {
    return {
      ok: false, readyAt,
      message: `This driver is out of hours and cannot legally drive before ${readyAt.toUTCString()}${c.cycleRemaining === 0 ? ' (weekly limit reached)' : ''}. Assign another driver, or correct the log if it is wrong.`,
    };
  }
  return { ok: true, warning: `This driver is out of hours now and will be rested by ${readyAt.toUTCString()}, before pickup.` };
}

module.exports = { settingsFor, driverHos, hoursCheck, DEFAULTS };
