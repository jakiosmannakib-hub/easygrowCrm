// tests/expect-result.ts — PUL-111
//
// Assertion helpers for the `ActionResult` boundary. Every action test uses these instead of
// `rejects.toThrow`, because after PUL-111 an expected failure is a RETURNED value, not a
// throw.
//
// These deliberately assert and narrow in one step. The alternative — `expect(r.ok).toBe(false)`
// followed by `if (!r.ok)` to satisfy the compiler — quietly lets a test pass when the guard
// is skipped, and that is exactly the class of hole this ticket is closing.

import { expect } from 'vitest';
import type { ActionResult } from '../lib/action-result';

/** Assert the action succeeded, and return its payload. */
export function expectOk<T>(result: ActionResult<T>): T {
  if (!result.ok) {
    throw new Error(
      `expected ok, got ${result.code}${result.reason ? `:${result.reason}` : ''} — ${result.message}`,
    );
  }
  return result.data;
}

/**
 * Assert the action failed with `code` (and `reason`, when given), and return the failure so
 * the caller can make further assertions on `details`.
 *
 * Note it asserts the call RESOLVED: if an action regresses to throwing an AppError across
 * the boundary, the rejection propagates out of the test and fails it, rather than being
 * caught and treated as an equivalent outcome. That is the regression this ticket must not
 * allow back in.
 */
export function expectFail<T>(
  result: ActionResult<T>,
  code: Extract<ActionResult<T>, { ok: false }>['code'],
  reason?: string,
): Extract<ActionResult<T>, { ok: false }> {
  expect(result.ok, `expected ${code} failure, got ok`).toBe(false);
  const failure = result as Extract<ActionResult<T>, { ok: false }>;
  expect(failure.code).toBe(code);
  if (reason !== undefined) expect(failure.reason).toBe(reason);
  return failure;
}
