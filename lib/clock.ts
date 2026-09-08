/**
 * The clock port — PUL-108.1, §16.6.
 *
 * All time in features/** goes through clock.now(), never new Date()/Date.now() (§16.6).
 * Freezable in tests so late-detection, timer unlock, and auto-close are deterministic (§15.5).
 * This file is the only permitted use of new Date().
 *
 * MECHANISM: `clock` is a stable facade object that delegates to a swappable source. Tests
 * call `setClock(testClock)` (and `resetClock()` in teardown) rather than reassigning the
 * export, so feature code can keep `import { clock }` at module scope and still see the
 * frozen time — a re-exported `let` binding is fragile across bundler/transpiler interop,
 * a facade is not.
 */

export interface Clock {
  now(): Date;
}

/** The production adapter — the one place in the codebase allowed to call `new Date()`. */
export const systemClock: Clock = {
  now: () => new Date(),
};

let source: Clock = systemClock;

/** The clock every caller imports. Stable identity; its `now()` follows the current source. */
export const clock: Clock = {
  now: () => source.now(),
};

/** A clock frozen at an instant, movable by the test that owns it. */
export interface TestClock extends Clock {
  /** Jump to an absolute instant. */
  set(d: Date): void;
  /** Move forward by `ms` milliseconds. */
  advance(ms: number): void;
}

/** Build a frozen clock for a test. Pass it to `setClock` to make feature code see it. */
export function createTestClock(initial: Date = new Date(0)): TestClock {
  let at = new Date(initial.getTime());
  return {
    now: () => new Date(at.getTime()),
    set: (d) => {
      at = new Date(d.getTime());
    },
    advance: (ms) => {
      at = new Date(at.getTime() + ms);
    },
  };
}

/** Point `clock` at a test adapter. Always pair with `resetClock()` in teardown. */
export function setClock(c: Clock): void {
  source = c;
}

/** Restore the production adapter. */
export function resetClock(): void {
  source = systemClock;
}
