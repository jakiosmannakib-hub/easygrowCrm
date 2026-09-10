// lib/action-result.ts — PUL-111
//
// THE SERVER-ACTION BOUNDARY. Every exported server action returns an `ActionResult`; none of
// them throws an expected error across the wire.
//
// ── Why this exists ──────────────────────────────────────────────────────────────────────
// Next.js redacts errors thrown out of a Server Action in a PRODUCTION build: the message is
// replaced with a generic string plus a `digest`, and custom properties — our `code`, our
// `meta.reason` — are stripped entirely. That is a deliberate security feature (an unhandled
// server stack must never reach a browser), and it is not configurable per-error.
//
// The consequence, before this file existed: every typed failure collapsed at the boundary.
// `GATE:last_managers` ("The team must keep at least two active managers.") and
// `FORBIDDEN` and `CONFLICT` all arrived at the client as the same anonymous object, so
// `errorToToast` fell through to "Something went wrong. Please try again." for all of them —
// in production only. In dev, where Next passes errors through intact, everything looked
// correct. That gap is precisely why it survived four tickets unnoticed.
//
// ── The fix ──────────────────────────────────────────────────────────────────────────────
// A *returned* value is ordinary data: React serializes it and hands it to the client
// verbatim. So expected failures become return values, and only genuinely unexpected throws
// stay throws — where redaction is exactly what we want.
//
// **`AppError` remains the internal language.** Action bodies, `authorize()`, `withTx`
// callbacks and every helper keep throwing it, because a throw is what unwinds a transaction
// and rolls the audit row back with it. Only the outermost boundary converts. Nothing below
// `actionResult` knows this file exists.

import { AppError, type AppErrorCode } from './errors';

/**
 * What every server action returns.
 *
 * A discriminated union rather than `{ data?, error? }`: `result.ok` narrows `result.data` to
 * non-optional on the success side, so a call site that forgets to branch fails to compile
 * instead of reading `undefined` at runtime.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** One of the seven §13 codes. */
      code: AppErrorCode;
      /** GATE's machine-readable reason (§13 line 12), e.g. `last_managers`. */
      reason?: string;
      /** Human-readable fallback. The toast mapper prefers a known `reason` over this. */
      message: string;
      /** The rest of `AppError.meta` — e.g. the `taskIds` a GATE names. */
      details?: Record<string, unknown>;
    };

/**
 * Run an action body and convert its outcome to an `ActionResult`.
 *
 * Expected failures (`AppError`) become `{ ok: false }` carrying code, reason and message, so
 * they survive the boundary as plain data.
 *
 * **Anything that is not an `AppError` is re-thrown, deliberately.** A `TypeError`, a driver
 * connection failure, a bug — none of those are part of the §13 contract, and their messages
 * and stacks are exactly what production redaction exists to hide. They stay throws, stay
 * redacted, and reach the client as an opaque digest that `errorToToast` renders as the
 * generic line. Swallowing them into a typed result would be a security regression, and would
 * also mislabel a crash as a handled outcome.
 *
 * Usage — note the shape, because `authorize-first` depends on it:
 *
 *   export async function myAction(input: MyInput): Promise<ActionResult<Row>> {
 *     return actionResult(async () => {
 *       const parsed = MyInput.parse(input);
 *       const actor = await authorize('thing.do');
 *       return await withTx(async (tx) => { ... });
 *     });
 *   }
 *
 * The exported function stays an `async function` declaration wrapping the call. Writing
 * `export const myAction = actionResult(async () => …)` instead would silently disable the
 * `easygrowcrm/authorize-first` lint rule for that action — see the guard case in
 * eslint-rules/authorize-first.test.ts.
 */
export async function actionResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof AppError) {
      const { reason, ...details } = error.meta ?? {};
      return {
        ok: false,
        code: error.code,
        ...(typeof reason === 'string' ? { reason } : {}),
        message: error.message,
        ...(Object.keys(details).length > 0 ? { details } : {}),
      };
    }
    throw error;
  }
}

/**
 * Narrow a result to its data, throwing the `AppError` back if it failed.
 *
 * For SERVER-side callers only — one action composing another, or a test that wants the old
 * throwing ergonomics. Never call this in a client component: it reconstructs the throw this
 * whole file exists to avoid.
 */
export function unwrap<T>(result: ActionResult<T>): T {
  if (result.ok) return result.data;
  throw new AppError(result.code, result.message, {
    ...result.details,
    ...(result.reason ? { reason: result.reason } : {}),
  });
}
