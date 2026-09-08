// lib/show-error-toast.tsx — PUL-106.2b
//
// The client half of error presentation: run the pure mapper, render the result.
// Every catch block in the UI calls this, so error wording is decided in exactly one
// place (lib/error-toast.ts) and never inline at a call site.

'use client';

import { toast } from 'sonner';
import { errorToToast, type ErrorLike } from './error-toast';

/**
 * Show the toast for a thrown error.
 *
 * CONFLICT gets a "Refresh" action (§14.15 r.3): the user's view is stale, so reloading
 * is the remedy. A full reload rather than router.refresh() — a CONFLICT means client
 * state disagrees with the server, and only a reload is guaranteed to discard it.
 */
export function showErrorToast(err: ErrorLike): void {
  const { message, refresh } = errorToToast(err);

  toast.error(message, {
    duration: refresh ? Infinity : 6000,
    action: refresh
      ? { label: 'Refresh', onClick: () => window.location.reload() }
      : undefined,
  });
}
