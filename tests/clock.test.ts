// tests/clock.test.ts — PUL-108.1
//
// Not a §15.4 mandatory test. It guards the freeze/advance behaviour that the mandatory
// attendance tests (late detection, timer unlock, auto-close) will lean on.

import { afterEach, describe, expect, it } from 'vitest';
import { clock, createTestClock, resetClock, setClock } from '../lib/clock';

afterEach(() => {
  resetClock();
});

const T0 = new Date('2026-09-08T03:00:00.000Z');

describe('createTestClock', () => {
  it('freezes: now() is stable across calls', () => {
    const test = createTestClock(T0);

    expect(test.now().toISOString()).toBe(T0.toISOString());
    expect(test.now().toISOString()).toBe(T0.toISOString());
  });

  it('advance(1000) moves now() forward one second', () => {
    const test = createTestClock(T0);
    test.advance(1000);

    expect(test.now().getTime()).toBe(T0.getTime() + 1000);
  });

  it('set(d) jumps to an absolute instant', () => {
    const test = createTestClock(T0);
    const target = new Date('2026-12-25T09:30:00.000Z');
    test.set(target);

    expect(test.now().toISOString()).toBe(target.toISOString());
  });

  it('hands out a copy, so a caller cannot mutate the frozen instant', () => {
    const test = createTestClock(T0);
    test.now().setFullYear(1999);

    expect(test.now().toISOString()).toBe(T0.toISOString());
  });
});

describe('setClock / resetClock', () => {
  it('points the shared clock at the test adapter', () => {
    const test = createTestClock(T0);
    setClock(test);

    expect(clock.now().toISOString()).toBe(T0.toISOString());

    test.advance(60_000);
    // Feature code holds `clock`, not `test` — it must still see the advance.
    expect(clock.now().getTime()).toBe(T0.getTime() + 60_000);
  });

  it('resetClock restores real time', () => {
    setClock(createTestClock(T0));
    resetClock();

    expect(clock.now().getFullYear()).toBeGreaterThan(2020);
  });
});
