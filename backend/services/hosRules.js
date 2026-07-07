/**
 * hosRules.js — pure Hours-of-Service calculations (49 CFR Part 395).
 *
 * Extracted from eldRoutes so the rule logic is unit-testable in isolation.
 * This is an ADVISORY calculator, not a registered ELD. Known limitation: it
 * still buckets by calendar day rather than by a driver's 10-hour-off shift, so
 * the 11h/14h windows reset at day boundaries; correcting that needs a shift
 * model. What these functions DO get right: the driving/on-duty/break/cycle
 * thresholds, warning-vs-violation severities, and the 70h/8-day cycle.
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

/**
 * 70-hour / 8-day rolling cycle check.
 * @param {number} cycleOnDutyMinutes - total on-duty minutes across the last 8 days
 */
const REST_RESET_MIN = 600; // 10 consecutive hours off duty ends a shift

/**
 * Shift-accurate HOS computation (the correct model, replacing calendar-day buckets).
 *
 * A shift begins when a driver comes on duty after 10+ consecutive hours off duty
 * (off-duty or sleeper). Within that shift:
 *   - 11-hour driving limit: total DRIVING minutes in the shift (660).
 *   - 14-hour window: ELAPSED time since the shift started (840) — NOT paused by
 *     short breaks; this is the key fix over the old sum-of-on-duty approach.
 *   - 30-minute break: driving accrued since the last 30-min non-driving interruption.
 *
 * @param {Array} events - chronological duty events: { status, startTime, endTime? }.
 *                         An open (endTime-less) event is treated as running until `now`.
 * @param {Date}  now
 * @returns {{ onShift, shiftStart, driveMinutesUsed, driveRemaining,
 *             windowElapsedMinutes, windowRemaining, breakDriveMinutes, violations }}
 */
function computeShiftStatus(events, now = new Date()) {
  const nowT = new Date(now);
  const evs = (events || [])
    .filter((e) => e && e.startTime)
    .map((e) => ({
      status: e.status,
      start: new Date(e.startTime),
      end: e.endTime ? new Date(e.endTime) : nowT,
    }))
    .filter((e) => e.end >= e.start)
    .sort((a, b) => a.start - b.start);

  const empty = {
    onShift: false, shiftStart: null,
    driveMinutesUsed: 0, driveRemaining: LIMITS.DRIVING_MIN,
    windowElapsedMinutes: 0, windowRemaining: LIMITS.ONDUTY_MIN,
    breakDriveMinutes: 0, violations: [],
  };
  if (evs.length === 0) return empty;

  // Find the current shift start: the on-duty event that follows the most recent
  // 10h+ continuous rest (or the first on-duty event if there was no prior reset).
  let shiftStart = null;
  let restAccum = 0;
  for (const e of evs) {
    const dur = Math.round((e.end - e.start) / 60000);
    const isRest = e.status === 'OFF_DUTY' || e.status === 'SLEEPER_BERTH';
    const isOnDuty = e.status === 'DRIVING' || e.status === 'ON_DUTY_NOT_DRIVING';
    if (isRest) {
      restAccum += dur;
    } else if (isOnDuty) {
      if (shiftStart === null || restAccum >= REST_RESET_MIN) shiftStart = e.start;
      restAccum = 0;
    }
  }
  if (!shiftStart) return empty; // only ever off duty → no active shift

  // Accumulate driving + break tracking from the shift start onward.
  let shiftDriving = 0;
  let breakDriving = 0; // driving since the last qualifying 30-min break
  let curBreak = 0;
  for (const e of evs) {
    if (e.end <= shiftStart) continue;
    const start = e.start < shiftStart ? shiftStart : e.start;
    const dur = Math.max(0, Math.round((e.end - start) / 60000));
    if (e.status === 'DRIVING') {
      shiftDriving += dur;
      breakDriving += dur;
      curBreak = 0;
    } else {
      curBreak += dur;
      if (curBreak >= 30) breakDriving = 0; // any 30-min non-driving break resets it
    }
  }

  const windowElapsed = Math.max(0, Math.round((nowT - shiftStart) / 60000));

  const violations = [];
  if (shiftDriving >= LIMITS.DRIVING_MIN) {
    violations.push({ type: '11_HOUR', message: '11-hour driving limit reached', severity: 'violation' });
  } else if (shiftDriving >= LIMITS.DRIVING_WARN) {
    violations.push({ type: '11_HOUR', message: `Approaching 11-hour limit (${(shiftDriving / 60).toFixed(1)}h driven this shift)`, severity: 'warning' });
  }
  if (windowElapsed >= LIMITS.ONDUTY_MIN) {
    violations.push({ type: '14_HOUR', message: '14-hour on-duty window exceeded — cannot drive', severity: 'violation' });
  } else if (windowElapsed >= LIMITS.ONDUTY_WARN) {
    violations.push({ type: '14_HOUR', message: `Approaching 14-hour window (${(windowElapsed / 60).toFixed(1)}h since shift start)`, severity: 'warning' });
  }
  if (breakDriving >= LIMITS.BREAK_AFTER_MIN) {
    violations.push({ type: '30_MIN_BREAK', message: 'Required 30-minute break after 8 hours of driving', severity: 'violation' });
  }

  return {
    onShift: true,
    shiftStart,
    driveMinutesUsed: shiftDriving,
    driveRemaining: Math.max(0, LIMITS.DRIVING_MIN - shiftDriving),
    windowElapsedMinutes: windowElapsed,
    windowRemaining: Math.max(0, LIMITS.ONDUTY_MIN - windowElapsed),
    breakDriveMinutes: breakDriving,
    violations,
  };
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
  checkCycleViolation,
  mergeViolations,
};
