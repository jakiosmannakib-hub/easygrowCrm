// lib/show-error-toast.tsx — PUL-106.2b, extended by PUL-111
//
// The client half of error presentation: run the pure mapper, render the result.
// Every failed call in the UI goes through here, so error wording is decided in exactly one
// place (lib/error-toast.ts) and never inline at a call site.

'use client';

import { toast } from 'sonner';
import type { ActionResult } from './action-result';
import { errorToToast, type ErrorLike } from './error-toast';

/** The `ok: false` half of an ActionResult — what a call site actually holds after branching. */
type FailedResult = Extract<ActionResult<unknown>, { ok: false }>;

/**
 * Show the toast for a failed server action.
 *
 * Takes the **failed result object** (PUL-111), not a caught throw. `ErrorLike` is still
 * accepted for the few genuinely-throwing paths that remain — `errorToToast` reads `code`,
 * `reason`, `message` and `meta`, and a `FailedResult` already satisfies that shape, so no
 * translation happens here beyond forwarding `details` as `meta` for the GATE reasons that
 * live there.
 *
 * CONFLICT gets a "Refresh" action (§14.15 r.3): the user's view is stale, so reloading is
 * the remedy. A full reload rather than router.refresh() — a CONFLICT means client state
 * disagrees with the server, and only a reload is guaranteed to discard it.
 */
export function showErrorToast(err: FailedResult | ErrorLike): void {
  const { message, refresh } = errorToToast({
    code: err.code,
    reason: err.reason,
    message: err.message,
    meta: 'details' in err ? err.details : 'meta' in err ? err.meta : undefined,
  });

  toast.error(message, {
    duration: refresh ? Infinity : 6000,
    action: refresh ? { label: 'Refresh', onClick: () => window.location.reload() } : undefined,
  });
}
