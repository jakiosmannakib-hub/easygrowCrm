// lib/error-toast.ts — PUL-106.2a, §13 (codes) + §14.15 r.3.
//
// The pure half of error presentation: a thrown AppError in, toast content out.
// No React, no toast library, no knowledge of how the error crossed the server-action
// boundary (that is deferred to the first Phase 2 action). This is what the unit test
// exercises, and it is the only place a user-facing error string is decided.

/**
 * The shape the mapper needs. Deliberately structural rather than `AppError`: once an
 * error crosses a server-action boundary it is a plain object, not an instance, so
 * accepting the shape means the mapper works on both sides without a re-hydration step.
 */
export interface ErrorLike {
  code: string;
  /** GATE's machine-readable reason, when it arrives flattened rather than in `meta`. */
  reason?: string;
  message?: string;
  meta?: Record<string, unknown>;
}

export interface ToastContent {
  message: string;
  /** Whether the toast offers a "Refresh" action. CONFLICT only (§14.15 r.3). */
  refresh: boolean;
}

/**
 * GATE reasons → the sentence a user sees. §14.15 r.3 requires a GATE message to name
 * the blocked thing, so these are specific, never "action blocked".
 *
 * Seeded with the reasons the PRD already defines. FEATURE TICKETS EXTEND THIS REGISTRY
 * with their own reasons as they add gates — an unknown reason degrades gracefully
 * (see `errorToToast`) rather than throwing, but it loses the specific wording.
 */
export const GATE_REASONS: Record<string, string> = {
  checklist_incomplete: 'Finish every checklist item before sending this for review.',
  proof_required: 'This task needs proof of work before it can be sent for review.',
  pending_reviews: 'You still have tasks waiting on your review.',
  client_in_use: 'This client still has live projects and cannot be archived.',
  last_managers: 'The team must keep at least two active managers.',
  self_role_change: 'You cannot change your own role — ask another super admin to do it.',
  unresolved_assignments: 'This user still has tasks assigned. Reassign them first.',
  unresolved_reviews: 'This user still has reviews routed to them. Reroute them first.',
  self_deactivate: 'You cannot deactivate your own account — ask another admin to do it.',
  sa_has_assignments: 'A super admin cannot hold task assignments.',
  use_review: 'Use the review screen to approve or return this task.',
};

const FALLBACK: Record<string, string> = {
  UNAUTHENTICATED: 'Please sign in again.',
  DEACTIVATED: 'This account has been deactivated.',
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: 'That item no longer exists.',
  VALIDATION: 'Please check the form and try again.',
  GATE: 'This action is blocked.',
  CONFLICT: 'This changed while you were editing — refresh.',
};

/** Map a thrown error to the toast the user should see. Pure; safe on the client. */
export function errorToToast(err: ErrorLike): ToastContent {
  switch (err.code) {
    case 'UNAUTHENTICATED':
    case 'DEACTIVATED':
    case 'FORBIDDEN':
    case 'NOT_FOUND':
      // Fixed wording: a server message here would leak internals to the user, and these
      // four say everything the user can act on.
      return { message: FALLBACK[err.code], refresh: false };

    case 'VALIDATION':
      // The server's message is the specific field complaint — prefer it.
      return { message: err.message ?? FALLBACK.VALIDATION, refresh: false };

    case 'GATE': {
      const reason =
        err.reason ?? (typeof err.meta?.reason === 'string' ? err.meta.reason : undefined);
      const known = reason ? GATE_REASONS[reason] : undefined;
      return { message: known ?? err.message ?? FALLBACK.GATE, refresh: false };
    }

    case 'CONFLICT':
      // The only code that offers refresh (§14.15 r.3) — the user's view is stale, and
      // reloading is the actual remedy.
      return { message: err.message ?? FALLBACK.CONFLICT, refresh: true };

    default:
      // An error that isn't one of the seven codes: never surface a raw internal message.
      return { message: 'Something went wrong. Please try again.', refresh: false };
  }
}
