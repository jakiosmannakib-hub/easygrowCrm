// tests/format.test.ts — PUL-407.1–2
//
// Not a §15.4 mandatory file; §15.3 lists `fmtHM` / `fmtDate` as unit-lane pure functions.
// Time is frozen through the clock port so "today" is deterministic.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestClock, resetClock, setClock } from '../lib/clock';
import { dhakaToday, fmtDate, fmtHM } from '../lib/format';

// 2026-08-08 10:00 in Dhaka (UTC+6).
const NOW = new Date('2026-08-08T04:00:00.000Z');

describe('fmtDate', () => {
  const clock = createTestClock(NOW);

  beforeEach(() => {
    clock.set(NOW);
    setClock(clock);
  });
  afterEach(() => resetClock());

  it('renders a future date plainly, with the year', () => {
    expect(fmtDate('2026-08-09')).toBe('Aug 9, 2026');
    expect(fmtDate('2027-01-31')).toBe('Jan 31, 2027');
  });

  it('suffixes today with " · Today"', () => {
    expect(fmtDate('2026-08-08')).toBe('Aug 8, 2026 · Today');
  });

  it('suffixes a past date with " · Overdue"', () => {
    expect(fmtDate('2026-08-07')).toBe('Aug 7, 2026 · Overdue');
    expect(fmtDate('2025-12-31')).toBe('Dec 31, 2025 · Overdue');
  });

  it('returns "" for null', () => {
    expect(fmtDate(null)).toBe('');
  });

  it('always carries a four-digit year — never a bare month-day', () => {
    for (const d of ['2026-01-01', '2026-08-08', '2026-08-07', '2030-12-25']) {
      expect(fmtDate(d)).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}( · (Today|Overdue))?$/);
    }
  });

  it('uses the Asia/Dhaka day, not UTC: 19:30 UTC is already tomorrow in Dhaka', () => {
    // 2026-08-08T19:30Z = 2026-08-09 01:30 Dhaka. UTC still says the 8th.
    clock.set(new Date('2026-08-08T19:30:00.000Z'));
    expect(dhakaToday()).toBe('2026-08-09');
    expect(fmtDate('2026-08-09')).toBe('Aug 9, 2026 · Today');
    expect(fmtDate('2026-08-08')).toBe('Aug 8, 2026 · Overdue');
  });

  it('flips at Dhaka midnight (18:00 UTC), not before', () => {
    clock.set(new Date('2026-08-08T17:59:59.999Z'));
    expect(fmtDate('2026-08-08')).toBe('Aug 8, 2026 · Today');
    clock.set(new Date('2026-08-08T18:00:00.000Z'));
    expect(fmtDate('2026-08-08')).toBe('Aug 8, 2026 · Overdue');
  });

  it('returns a malformed input unchanged rather than inventing a date', () => {
    expect(fmtDate('2026-13-01')).toBe('2026-13-01');
    expect(fmtDate('Aug 8')).toBe('Aug 8');
  });

  // PUL-409 — the Board card's opt-out. The default must not move: every test above calls
  // fmtDate with no options and still expects the suffix.
  describe('{ relative }', () => {
    it('defaults to relative: true — identical to passing nothing', () => {
      for (const d of ['2026-08-07', '2026-08-08', '2026-08-09', null]) {
        expect(fmtDate(d, { relative: true })).toBe(fmtDate(d));
        expect(fmtDate(d, {})).toBe(fmtDate(d));
      }
    });

    it('relative: false drops " · Today" and " · Overdue", keeping the year', () => {
      expect(fmtDate('2026-08-08', { relative: false })).toBe('Aug 8, 2026');
      expect(fmtDate('2026-08-07', { relative: false })).toBe('Aug 7, 2026');
      expect(fmtDate('2025-12-31', { relative: false })).toBe('Dec 31, 2025');
      expect(fmtDate('2026-08-09', { relative: false })).toBe('Aug 9, 2026');
    });

    it('relative: false keeps the null and malformed-input behavior', () => {
      expect(fmtDate(null, { relative: false })).toBe('');
      expect(fmtDate('2026-13-01', { relative: false })).toBe('2026-13-01');
    });
  });
});

describe('fmtHM', () => {
  it.each([
    [1.5, '1h 30m'],
    [0.75, '45m'],
    [0, '0m'],
    [2, '2h'],
    [0.25, '15m'],
    [8.1, '8h 6m'],
  ])('%s → %s', (hours, expected) => {
    expect(fmtHM(hours)).toBe(expected);
  });

  it('rounds to the minute before splitting, so it never renders "60m"', () => {
    expect(fmtHM(1.999)).toBe('2h');
    expect(fmtHM(0.9999)).toBe('1h');
  });

  it('returns an em dash for null', () => {
    expect(fmtHM(null)).toBe('-');
  });
});
