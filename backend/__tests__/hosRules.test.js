const {
  computeTotals,
  computeRemaining,
  checkViolations,
  computeShiftStatus,
  checkCycleViolation,
  mergeViolations,
} = require('../services/hosRules');

const ev = (status, durationMinutes) => ({ status, durationMinutes });

// Build a timed event from an anchor time + minute offsets (for shift-model tests).
const BASE = new Date('2026-03-10T06:00:00.000Z').getTime();
const at = (mins) => new Date(BASE + mins * 60000);
const tev = (status, startMin, endMin) => ({ status, startTime: at(startMin), endTime: at(endMin) });

describe('hosRules.checkViolations — 11h driving', () => {
  test('flags a violation at exactly the 11-hour (660 min) limit', () => {
    const events = [ev('DRIVING', 660)];
    const v = checkViolations(computeTotals(events), events);
    expect(v.find(x => x.type === '11_HOUR')?.severity).toBe('violation');
  });
  test('flags a warning between 10h and 11h driving', () => {
    const events = [ev('DRIVING', 610)];
    const v = checkViolations(computeTotals(events), events);
    expect(v.find(x => x.type === '11_HOUR')?.severity).toBe('warning');
  });
  test('no 11h entry under 10h driving', () => {
    const events = [ev('DRIVING', 300)];
    const v = checkViolations(computeTotals(events), events);
    expect(v.find(x => x.type === '11_HOUR')).toBeUndefined();
  });
});

describe('hosRules.checkViolations — 14h on-duty window', () => {
  test('violation when driving + on-duty reaches 840 min', () => {
    const events = [ev('DRIVING', 600), ev('ON_DUTY_NOT_DRIVING', 240)];
    const v = checkViolations(computeTotals(events), events);
    expect(v.find(x => x.type === '14_HOUR')?.severity).toBe('violation');
  });
});

describe('hosRules.checkViolations — 30-minute break (the maxBreak fix)', () => {
  test('violation: 9h of driving straight with no qualifying break', () => {
    const events = [ev('DRIVING', 540)];
    const v = checkViolations(computeTotals(events), events);
    expect(v.find(x => x.type === '30_MIN_BREAK')?.severity).toBe('violation');
  });

  test('an EARLY 30-min break no longer suppresses a later 8h+ stint', () => {
    // Old bug: a 30-min break anywhere in the day set maxBreak>=30 and disabled the
    // check even though the driver then drove 9h straight. Now continuousDriving
    // resets at the break and re-accumulates, so this must still flag.
    const events = [
      ev('DRIVING', 60),
      ev('OFF_DUTY', 30),   // qualifying break — resets the counter
      ev('DRIVING', 540),   // then 9h straight
    ];
    const v = checkViolations(computeTotals(events), events);
    expect(v.find(x => x.type === '30_MIN_BREAK')?.severity).toBe('violation');
  });

  test('no violation when a 30-min break splits the driving under 8h/segment', () => {
    const events = [
      ev('DRIVING', 420),   // 7h
      ev('SLEEPER_BERTH', 30),
      ev('DRIVING', 180),   // 3h — under 8h since the break
    ];
    const v = checkViolations(computeTotals(events), events);
    expect(v.find(x => x.type === '30_MIN_BREAK')).toBeUndefined();
  });

  test('on-duty-not-driving counts toward the 30-min break (2020 rule)', () => {
    const events = [
      ev('DRIVING', 420),
      ev('ON_DUTY_NOT_DRIVING', 45), // dock work now satisfies the break
      ev('DRIVING', 120),
    ];
    const v = checkViolations(computeTotals(events), events);
    expect(v.find(x => x.type === '30_MIN_BREAK')).toBeUndefined();
  });
});

describe('hosRules.checkCycleViolation — 70h/8-day', () => {
  test('violation at 4200 min on-duty', () => {
    expect(checkCycleViolation(4200)?.severity).toBe('violation');
  });
  test('warning in the 65–70h band', () => {
    expect(checkCycleViolation(3950)?.severity).toBe('warning');
  });
  test('nothing under 65h', () => {
    expect(checkCycleViolation(3000)).toBeNull();
  });
});

describe('hosRules.mergeViolations — warning must not suppress the later violation', () => {
  test('a recorded 11h warning does not block the 11h violation', () => {
    const existing = [{ type: '11_HOUR', severity: 'warning', message: 'approaching' }];
    const incoming = [{ type: '11_HOUR', severity: 'violation', message: 'reached' }];
    const { merged, added } = mergeViolations(existing, incoming);
    expect(added).toHaveLength(1);
    expect(added[0].severity).toBe('violation');
    expect(merged.filter(v => v.type === '11_HOUR')).toHaveLength(2);
  });

  test('the same type+severity is not duplicated', () => {
    const existing = [{ type: '30_MIN_BREAK', severity: 'violation' }];
    const incoming = [{ type: '30_MIN_BREAK', severity: 'violation' }];
    const { added } = mergeViolations(existing, incoming);
    expect(added).toHaveLength(0);
  });
});

describe('hosRules.computeShiftStatus — 14h window is ELAPSED time, not a sum', () => {
  test('an intervening off-duty break does NOT pause the 14-hour window', () => {
    // On duty 0–360 (6h), off 360–660 (5h, NOT a 10h reset), then driving 660–690.
    // At now=690 min, 11.5h have ELAPSED since shift start. Old bug summed on-duty
    // (~6.5h) and thought there was plenty of window left. Elapsed model is correct.
    const events = [
      tev('ON_DUTY_NOT_DRIVING', 0, 360),
      tev('OFF_DUTY', 360, 660),
      tev('DRIVING', 660, 690),
    ];
    const s = computeShiftStatus(events, at(690));
    expect(s.onShift).toBe(true);
    expect(s.windowElapsedMinutes).toBe(690);          // 11.5h elapsed
    expect(s.windowRemaining).toBe(840 - 690);         // ~2.5h left, not ~7.5h
  });

  test('driving past the 14th elapsed hour is a violation even with modest total driving', () => {
    const events = [
      tev('ON_DUTY_NOT_DRIVING', 0, 300),  // 5h dock
      tev('OFF_DUTY', 300, 600),           // 5h break (not a reset)
      tev('DRIVING', 600, 900),            // drives to 15h elapsed
    ];
    const s = computeShiftStatus(events, at(900));
    expect(s.violations.find(v => v.type === '14_HOUR')?.severity).toBe('violation');
  });
});

describe('hosRules.computeShiftStatus — 10-hour reset & no midnight reset', () => {
  test('a 10-hour off-duty period starts a fresh shift (clocks reset)', () => {
    const events = [
      tev('DRIVING', 0, 600),        // 10h driving (prior shift, near limit)
      tev('OFF_DUTY', 600, 1200),    // 10h off → RESET
      tev('DRIVING', 1200, 1320),    // new shift: 2h driving
    ];
    const s = computeShiftStatus(events, at(1320));
    expect(s.driveMinutesUsed).toBe(120);              // only the new shift's driving
    expect(s.driveRemaining).toBe(660 - 120);
    expect(s.windowElapsedMinutes).toBe(120);          // window restarted at 1200
  });

  test('clocks do NOT reset without 10h off — driving accumulates across the shift', () => {
    // 9h driving, only 8h off (not enough to reset), then 3h more driving = 12h > 11h.
    const events = [
      tev('DRIVING', 0, 540),        // 9h
      tev('OFF_DUTY', 540, 1020),    // 8h off — NOT a reset
      tev('DRIVING', 1020, 1200),    // +3h = 12h driving this shift
    ];
    const s = computeShiftStatus(events, at(1200));
    expect(s.driveMinutesUsed).toBe(720);              // 12h — carried across the short break
    expect(s.violations.find(v => v.type === '11_HOUR')?.severity).toBe('violation');
  });
});

describe('hosRules.computeShiftStatus — 30-min break within a shift', () => {
  test('8h+ driving since the last 30-min break flags a violation', () => {
    const events = [tev('DRIVING', 0, 540)]; // 9h straight
    const s = computeShiftStatus(events, at(540));
    expect(s.violations.find(v => v.type === '30_MIN_BREAK')?.severity).toBe('violation');
  });
  test('a 30-min break resets the break-driving counter', () => {
    const events = [
      tev('DRIVING', 0, 420),        // 7h
      tev('OFF_DUTY', 420, 450),     // 30-min break
      tev('DRIVING', 450, 630),      // 3h — under 8h since the break
    ];
    const s = computeShiftStatus(events, at(630));
    expect(s.violations.find(v => v.type === '30_MIN_BREAK')).toBeUndefined();
  });
});

describe('hosRules.computeRemaining', () => {
  test('caps remaining at zero and computes the on-duty window', () => {
    const totals = { drivingMinutes: 700, onDutyNotDrivingMinutes: 200 };
    const r = computeRemaining(totals);
    expect(r.driveMinutes).toBe(0);       // 660 - 700 floored at 0
    expect(r.onDutyMinutes).toBe(0);      // 840 - 900 floored at 0
  });
});
