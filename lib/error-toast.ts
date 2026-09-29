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
  self_role_change: 'You cannot change your own role. Ask another super admin to do it.',
  unresolved_assignments: 'This user still has tasks assigned. Reassign them first.',
  unresolved_reviews: 'This user still has reviews routed to them. Reroute them first.',
  self_deactivate: 'You cannot deactivate your own account. Ask another admin to do it.',
  sa_has_assignments: 'A super admin cannot hold task assignments.',
  use_review: 'Use the review screen to approve or return this task.',
  // PUL-403 (§13.4.1). `project_archived` is thrown by `updateProject` (PUL-402) as well as by
  // `createTask` — one reason string, one entry, shared by both gates.
  project_archived: 'This project is archived. Un-archive it before adding or changing tasks.',
  sa_assignee: 'A super admin can never be assigned delivery work. Pick someone else.',
  inactive_assignee: 'That person is deactivated and cannot hold tasks. Pick an active teammate.',
  bad_dependency: 'A task can only depend on another task in the same project.',
  // PUL-404 (§13.4.4) + PUL-405 (§13.4.9–10). Action-agnostic on purpose: one reason serves the
  // status pill (a task in submitted / approved / completed / cancelled cannot be moved from
  // there) AND the child-edit lock (an employee cannot edit subtasks or the checklist while the
  // task is submitted). "Awaiting review" would be wrong for the three terminal statuses.
  locked: "This task is locked at its current status, so it can't be changed here.",
  // PUL-404 Stage 2 (§13.4.5). `use_review` was already seeded above from the PRD's own list;
  // this is the note gate that goes with it.
  note_required: 'Say what needs changing before you send this task back for revision.',
  // PUL-503 (§13.3.6–7d). `bad_ref` is the §13.3.6 reason for an `after` due rule that points
  // outside the template, at the task itself, or into a cycle. Start Project (§13.3.2) re-checks
  // the same reason at clone time.
  bad_ref: 'A task can only be scheduled after another task in this template, without a loop.',
  // PUL-506 (§13.3.2). Start Project: a `before_deadline` task needs the project to have one.
  no_deadline: 'This template has tasks due before the deadline. Set a project deadline.',
  // Thrown by the task, category and month deletes alike, so it names no level.
  task_has_dependents:
    'Another task is scheduled after something you’re deleting. Change that task’s due rule first.',
};

/** The first string in `meta[key]` when it is a non-empty string array. */
function firstString(meta: Record<string, unknown>, key: string): string | undefined {
  const value = meta[key];
  return Array.isArray(value) && typeof value[0] === 'string' && value[0] ? value[0] : undefined;
}

/**
 * GATE reasons whose sentence can NAME the blocker from the error's details (§14.15 r.3: "name
 * the specific field or task"). Consulted before `GATE_REASONS`; when the detail it needs is
 * missing it returns `undefined`, and the fixed registry sentence is used instead.
 *
 * Kept separate from `GATE_REASONS` so that registry stays a plain string table.
 */
const GATE_REASONS_NAMED: Record<string, (meta: Record<string, unknown>) => string | undefined> = {
  // PUL-503: the task, category and month deletes all carry `titles` of the tasks scheduled
  // `after` something being deleted.
  task_has_dependents: (meta) => {
    const title = firstString(meta, 'titles');
    return title
      ? `“${title}” is scheduled after something you’re deleting. Change its due rule first.`
      : undefined;
  },
};

const FALLBACK: Record<string, string> = {
  UNAUTHENTICATED: 'Please sign in again.',
  DEACTIVATED: 'This account has been deactivated.',
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: 'That item no longer exists.',
  VALIDATION: 'Please check the form and try again.',
  GATE: 'This action is blocked.',
  CONFLICT: 'This changed while you were editing. Refresh to see the latest.',
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
      const named = reason && err.meta ? GATE_REASONS_NAMED[reason]?.(err.meta) : undefined;
      const known = reason ? GATE_REASONS[reason] : undefined;
      return { message: named ?? known ?? err.message ?? FALLBACK.GATE, refresh: false };
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
