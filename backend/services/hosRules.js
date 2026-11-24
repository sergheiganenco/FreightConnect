/**
 * hosRules.js — pure Hours-of-Service calculations (49 CFR Part 395).
 *
 * Extracted from eldRoutes so the rule logic is unit-testable in isolation.
 * This is an ADVISORY calculator, not a registered ELD. The live clock (computeClock) works on
 * one continuous timeline of duty statuses, so shifts, rest and the cycle are not cut at midnight.
 *
 * All limits are in minutes to avoid float drift.
 */

const LIMITS = {
  DRIVING_MIN: 660,        // 11h driving
  DRIVING_WARN: 600,       // 10h — approaching
  ONDUTY_MIN: 840,         // 14h on-duty window
  ONDUTY_WARN: 780,        // 13h — approaching
  BREAK_AFTER_MIN: 480,    // 30-min break required after 8h driving
  CYCLE_MIN: 4200,         // 70h / 8 days
  CYCLE_WARN: 3900,        // 65h — approaching
};

function computeTotals(events) {
  const totals = { drivingMinutes: 0, onDutyNotDrivingMinutes: 0, sleeperMinutes: 0, offDutyMinutes: 0 };
  for (const ev of events || []) {
    const mins = ev.durationMinutes ||
      (ev.endTime ? Math.round((new Date(ev.endTime) - new Date(ev.startTime)) / 60000) : 0);
    if (ev.status === 'DRIVING')             totals.drivingMinutes += mins;
    if (ev.status === 'ON_DUTY_NOT_DRIVING') totals.onDutyNotDrivingMinutes += mins;
    if (ev.status === 'SLEEPER_BERTH')       totals.sleeperMinutes += mins;
    if (ev.status === 'OFF_DUTY')            totals.offDutyMinutes += mins;
  }
  return totals;
}

function computeRemaining(totals) {
  const driveMinutes  = Math.max(0, LIMITS.DRIVING_MIN - totals.drivingMinutes);
  const onDutyTotal   = totals.drivingMinutes + totals.onDutyNotDrivingMinutes;
  const onDutyMinutes = Math.max(0, LIMITS.ONDUTY_MIN - onDutyTotal);
  return { driveMinutes, onDutyMinutes };
}

/**
 * Per-day driving / on-duty-window / 30-min-break checks.
 * @param {object} totals - from computeTotals
 * @param {Array}  events - the day's duty events (for the break analysis)
 */
function checkViolations(totals, events) {
  const violations = [];
  const onDutyTotal = totals.drivingMinutes + totals.onDutyNotDrivingMinutes;

  if (totals.drivingMinutes >= LIMITS.DRIVING_MIN) {
    violations.push({ type: '11_HOUR', message: '11-hour driving limit reached', severity: 'violation' });
  } else if (totals.drivingMinutes >= LIMITS.DRIVING_WARN) {
    violations.push({ type: '11_HOUR', message: `Approaching 11-hour limit (${(totals.drivingMinutes / 60).toFixed(1)}h driven)`, severity: 'warning' });
  }

  if (onDutyTotal >= LIMITS.ONDUTY_MIN) {
    violations.push({ type: '14_HOUR', message: '14-hour on-duty window exceeded', severity: 'violation' });
  } else if (onDutyTotal >= LIMITS.ONDUTY_WARN) {
    violations.push({ type: '14_HOUR', message: `Approaching 14-hour window (${(onDutyTotal / 60).toFixed(1)}h on-duty)`, severity: 'warning' });
  }

  // 30-minute break: required once 8h of driving accrues WITHOUT a 30-minute
  // non-driving interruption. `continuousDriving` accumulates driving since the
  // last qualifying break, so no separate "did a break happen at all" clause is
  // needed. Any non-driving status (off-duty, sleeper, or on-duty-not-driving)
  // counts toward the break per the Sept 2020 rule (49 CFR 395.3(a)(3)(ii)).
  let continuousDriving = 0;
  let tempBreak = 0;
  for (const ev of (events || [])) {
    const mins = ev.durationMinutes || 0;
    if (ev.status === 'DRIVING') {
      continuousDriving += mins;
      tempBreak = 0;
    } else {
      tempBreak += mins;
      if (tempBreak >= 30) continuousDriving = 0; // qualifying break resets the counter
    }
  }
  if (continuousDriving >= LIMITS.BREAK_AFTER_MIN) {
    violations.push({ type: '30_MIN_BREAK', message: 'Required 30-minute break after 8 hours of driving', severity: 'violation' });
  }

  return violations;
}

const MIN = 60000;
const HOUR = 60 * MIN;
const REST_STATUSES = new Set(['OFF_DUTY', 'SLEEPER_BERTH', 'PERSONAL_CONVEYANCE']);
const isRest = (s) => REST_STATUSES.has(s);
const CYCLES = { '70_8': { hours: 70, days: 8 }, '60_7': { hours: 60, days: 7 } };

// ── Time zone helpers (a log day is the home terminal's day, not the server's) ──
function tzOffsetMs(t, tz) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(t))) p[x.type] = Number(x.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}
/** The instant (ms) a YYYY-MM-DD day starts in `tz`. */
function dayStart(dateStr, tz = 'UTC') {
  const guess = Date.parse(`${dateStr}T00:00:00Z`);
  return guess - tzOffsetMs(guess - tzOffsetMs(guess, tz), tz); // second pass settles daylight-saving edges
}
/** YYYY-MM-DD of an instant in `tz`. */
function dateIn(t, tz = 'UTC') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}
function addDays(dateStr, n) {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 24 * HOUR).toISOString().slice(0, 10);
}
function validTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return typeof tz === 'string' && tz.length > 0; } catch (_) { return false; }
}

/**
 * One continuous, chronological list of duty segments { status, start, end } (ms).
 * A status runs until the next one starts (or its own end, or now). Time nobody logged
 * between two entries is treated as off duty.
 */
function timeline(events, now = new Date()) {
  const nowMs = +new Date(now);
  const evs = (events || [])
    .filter((e) => e && e.startTime)
    .map((e) => ({ status: e.status, start: +new Date(e.startTime), end: e.endTime ? +new Date(e.endTime) : nowMs }))
    .filter((e) => e.start <= nowMs)
    .sort((a, b) => a.start - b.start);
  const out = [];
  evs.forEach((e, i) => {
    const end = Math.min(e.end, i + 1 < evs.length ? evs[i + 1].start : nowMs, nowMs);
    const last = out[out.length - 1];
    if (last && e.start > last.end) out.push({ status: 'OFF_DUTY', start: last.end, end: e.start });
    if (end > e.start || i === evs.length - 1) out.push({ status: e.status, start: e.start, end: Math.max(end, e.start) }); // the newest entry counts even at zero length
  });
  return out;
}

/**
 * The driver's live clock (49 CFR 395.3, property-carrying).
 *
 *   - A shift starts after 10 consecutive hours of rest (off duty, sleeper, personal conveyance).
 *   - 11 hours of driving per shift; no driving after the 14th hour since the shift started.
 *   - Split sleeper (395.1(g)): one rest of 7+ hours in the sleeper paired with another rest of 2+ hours,
 *     10+ hours together. The clocks then run from the end of the first of the pair, and the second
 *     does not count against the 14 hours.
 *   - 30-minute break after 8 hours of driving without a 30-minute interruption.
 *   - Cycle: 70 hours in 8 days or 60 in 7 (company setting), counted over calendar days in the home
 *     time zone; 34 consecutive hours of rest restarts it.
 *
 * @param {Array} events { status, startTime, endTime? }
 * @param {Date}  now
 * @param {{cycle?: '70_8'|'60_7', tz?: string}} opts
 */
function computeClock(events, now = new Date(), opts = {}) {
  const nowMs = +new Date(now);
  const tz = opts.tz || 'UTC';
  const cyc = CYCLES[opts.cycle] || CYCLES['70_8'];
  const cycleLimit = cyc.hours * 60;
  const segs = timeline(events, nowMs);

  // Runs of consecutive rest, with the longest unbroken sleeper stretch inside each.
  const blocks = [];
  for (const s of segs) {
    if (!isRest(s.status)) continue;
    let b = blocks[blocks.length - 1];
    if (!b || b.end !== s.start) { b = { start: s.start, end: s.start, sleeper: 0, run: 0 }; blocks.push(b); }
    b.end = s.end;
    b.run = s.status === 'SLEEPER_BERTH' ? b.run + (s.end - s.start) : 0;
    b.sleeper = Math.max(b.sleeper, b.run);
  }

  // Where the 11/14-hour clocks count from.
  let anchor = null; let excluded = null; let prev = null; let restartAt = null; let split = false;
  for (const b of blocks) {
    const len = b.end - b.start;
    if (len >= 34 * HOUR) restartAt = b.end;
    if (len >= 10 * HOUR) { anchor = b.end; excluded = null; prev = null; split = false; continue; }
    if (len < 2 * HOUR) continue;
    // ponytail: pairs a rest only with the qualifying rest just before it; a planner that searches every legal pairing is more than an advisory clock needs.
    if (prev && (prev.end - prev.start) + len >= 10 * HOUR && (prev.sleeper >= 7 * HOUR || b.sleeper >= 7 * HOUR)) {
      anchor = prev.end; excluded = b; split = true;
    }
    prev = b;
  }
  if (anchor === null) {
    const first = segs.find((s) => !isRest(s.status));
    anchor = first ? first.start : nowMs;
  }

  let drive = 0; let sinceBreak = 0; let nonDriving = 0; let worked = false;
  for (const s of segs) {
    if (s.end <= anchor) continue;
    const dur = s.end - Math.max(s.start, anchor);
    if (s.status === 'DRIVING') { drive += dur; sinceBreak += dur; nonDriving = 0; worked = true; }
    else {
      nonDriving += dur;
      if (nonDriving >= 30 * MIN) sinceBreak = 0;
      if (!isRest(s.status)) worked = true;
    }
  }
  let windowMs = worked ? nowMs - anchor : 0;
  if (worked && excluded && excluded.end > anchor) windowMs -= excluded.end - Math.max(excluded.start, anchor);
  if (!worked) { drive = 0; sinceBreak = 0; }

  // Cycle
  let cycleStart = dayStart(addDays(dateIn(nowMs, tz), -(cyc.days - 1)), tz);
  if (restartAt && restartAt > cycleStart) cycleStart = restartAt;
  let cycleMs = 0;
  for (const s of segs) if (!isRest(s.status) && s.end > cycleStart) cycleMs += s.end - Math.max(s.start, cycleStart);

  const m = (ms) => Math.round(ms / MIN);
  const driveUsed = m(drive); const windowElapsed = m(windowMs); const breakDrive = m(sinceBreak); const cycleUsed = m(cycleMs);
  const last = segs[segs.length - 1] || null;
  const resting = !!last && isRest(last.status);

  const violations = [];
  if (driveUsed >= LIMITS.DRIVING_MIN) violations.push({ type: '11_HOUR', message: '11-hour driving limit reached', severity: 'violation' });
  else if (driveUsed >= LIMITS.DRIVING_WARN) violations.push({ type: '11_HOUR', message: `Approaching 11-hour limit (${(driveUsed / 60).toFixed(1)}h driven this shift)`, severity: 'warning' });
  if (windowElapsed >= LIMITS.ONDUTY_MIN) violations.push({ type: '14_HOUR', message: '14-hour on-duty window exceeded — cannot drive', severity: 'violation' });
  else if (windowElapsed >= LIMITS.ONDUTY_WARN) violations.push({ type: '14_HOUR', message: `Approaching 14-hour window (${(windowElapsed / 60).toFixed(1)}h since shift start)`, severity: 'warning' });
  if (breakDrive >= LIMITS.BREAK_AFTER_MIN) violations.push({ type: '30_MIN_BREAK', message: 'Required 30-minute break after 8 hours of driving', severity: 'violation' });
  const cycleType = `${cyc.hours}_HOUR`;
  if (cycleUsed >= cycleLimit) violations.push({ type: cycleType, message: `${cyc.hours}-hour/${cyc.days}-day on-duty cycle limit reached`, severity: 'violation' });
  else if (cycleUsed >= cycleLimit - 300) violations.push({ type: cycleType, message: `Approaching ${cyc.hours}-hour cycle limit (${(cycleUsed / 60).toFixed(1)}h)`, severity: 'warning' });

  const driveRemaining = Math.max(0, LIMITS.DRIVING_MIN - driveUsed);
  const windowRemaining = Math.max(0, LIMITS.ONDUTY_MIN - windowElapsed);
  const cycleRemaining = Math.max(0, cycleLimit - cycleUsed);
  return {
    onShift: worked,
    shiftStart: worked ? new Date(anchor) : null,
    currentStatus: last ? last.status : 'OFF_DUTY',
    statusSince: last ? new Date(last.start) : null,
    driveMinutesUsed: driveUsed,
    driveRemaining,
    windowElapsedMinutes: windowElapsed,
    windowRemaining,
    breakDriveMinutes: breakDrive,
    breakDueIn: Math.max(0, LIMITS.BREAK_AFTER_MIN - breakDrive),
    cycleHours: cyc.hours,
    cycleDays: cyc.days,
    cycleUsedMinutes: cycleUsed,
    cycleRemaining,
    cycleRestartAt: restartAt ? new Date(restartAt) : null,
    splitSleeper: worked && split,
    // Driving time actually available right now: the tightest of the three clocks.
    driveableMinutes: Math.min(driveRemaining, windowRemaining, cycleRemaining),
    restingSince: resting ? new Date(blocks[blocks.length - 1].start) : null,
    violations,
  };
}

/** Kept for existing callers: the shift part of computeClock. */
function computeShiftStatus(events, now = new Date()) {
  const c = computeClock(events, now);
  return { ...c, violations: c.violations.filter((v) => v.type === '11_HOUR' || v.type === '14_HOUR' || v.type === '30_MIN_BREAK') };
}

/**
 * Minutes in each duty line for the given log days (home time zone), from the continuous timeline,
 * so a status that runs past midnight is counted on both days. Personal conveyance is off duty and
 * a yard move is on duty; both are also reported on their own.
 */
function dailySummaries(events, tz, dates, now = new Date()) {
  const nowMs = +new Date(now);
  const segs = timeline(events, nowMs);
  const line = { DRIVING: 'drivingMinutes', ON_DUTY_NOT_DRIVING: 'onDutyNotDrivingMinutes', YARD_MOVE: 'onDutyNotDrivingMinutes', SLEEPER_BERTH: 'sleeperMinutes', OFF_DUTY: 'offDutyMinutes', PERSONAL_CONVEYANCE: 'offDutyMinutes' };
  const out = {};
  for (const date of dates) {
    const from = dayStart(date, tz); const to = Math.min(dayStart(addDays(date, 1), tz), nowMs);
    const ms = { drivingMinutes: 0, onDutyNotDrivingMinutes: 0, sleeperMinutes: 0, offDutyMinutes: 0, personalConveyanceMinutes: 0, yardMoveMinutes: 0 };
    const parts = [];
    for (const s of segs) {
      const a = Math.max(s.start, from); const b = Math.min(s.end, to);
      if (b <= a) continue;
      if (line[s.status]) ms[line[s.status]] += b - a;
      if (s.status === 'PERSONAL_CONVEYANCE') ms.personalConveyanceMinutes += b - a;
      if (s.status === 'YARD_MOVE') ms.yardMoveMinutes += b - a;
      parts.push({ status: s.status, start: new Date(a), end: new Date(b) });
    }
    for (const k of Object.keys(ms)) ms[k] = Math.round(ms[k] / MIN);
    out[date] = { totals: ms, segments: parts, from: new Date(from), to: new Date(to) };
  }
  return out;
}

/** On-duty minutes (driving + on-duty-not-driving) summed from ELDLog day totals. Shared by the ELD routes and Autopilot. */
function sumOnDutyMinutes(logs) {
  let mins = 0;
  for (const l of logs || []) mins += (l.totals?.drivingMinutes || 0) + (l.totals?.onDutyNotDrivingMinutes || 0);
  return mins;
}

function checkCycleViolation(cycleOnDutyMinutes) {
  if (cycleOnDutyMinutes >= LIMITS.CYCLE_MIN) {
    return { type: '70_HOUR', message: '70-hour/8-day on-duty cycle limit reached', severity: 'violation' };
  }
  if (cycleOnDutyMinutes >= LIMITS.CYCLE_WARN) {
    return { type: '70_HOUR', message: `Approaching 70-hour cycle limit (${(cycleOnDutyMinutes / 60).toFixed(1)}h)`, severity: 'warning' };
  }
  return null;
}

/**
 * Merge newly-computed violations into an existing list, deduping by type AND
 * severity. Deduping by type alone (the old bug) let an early "warning" suppress
 * the later "violation" of the same type, so real 11h/14h breaches were never
 * recorded or notified. Returns { merged, added } where `added` are the entries
 * that were newly appended (used to decide who to notify).
 */
function mergeViolations(existing, incoming) {
  const merged = [...(existing || [])];
  const seen = new Set(merged.map(v => `${v.type}|${v.severity}`));
  const added = [];
  for (const v of incoming) {
    const key = `${v.type}|${v.severity}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(v);
      added.push(v);
    }
  }
  return { merged, added };
}

module.exports = {
  LIMITS,
  computeTotals,
  computeRemaining,
  checkViolations,
  computeShiftStatus,
  computeClock,
  dailySummaries,
  timeline,
  dayStart,
  dateIn,
  addDays,
  validTimeZone,
  CYCLES,
  isRest,
  checkCycleViolation,
  sumOnDutyMinutes,
  mergeViolations,
};
