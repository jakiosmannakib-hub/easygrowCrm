// features/projects/display.ts
//
// Presentation data for project tasks. Pure — no DB, no JSX — so it is safe in both client and
// server components, and testable in the node lane without a DOM.
//
// The counterpart to features/employees/display.ts, and it follows the same discipline: the
// maps are typed off the pgEnum's `enumValues`, so adding a status or a priority to the schema
// without labelling it here is a COMPILE error rather than a blank pill in production.

import { taskPriority, taskStatus } from '../../db/schema/enums';

export type TaskStatus = (typeof taskStatus.enumValues)[number];
export type TaskPriority = (typeof taskPriority.enumValues)[number];

/** What a status pill needs to draw itself, minus the lock/dependency override. */
export interface StatusDisplay {
  /** The employee-facing label. §14.3.2's map, verbatim. */
  label: string;
  /** Tailwind classes for the pill body — one place, so Board and Detail can't drift apart. */
  className: string;
  /** `true` only for `approved`: the check-shield is what separates QC-approved from closed. */
  icon: boolean;
}

/**
 * The §14.3.2 status map — labels and colors for every `task_status` value.
 *
 * `as const satisfies Record<TaskStatus, StatusDisplay>` rather than a plain annotation: the
 * `satisfies` half is the exhaustiveness check (a missing status fails to compile), and the
 * `as const` half keeps the literal label types for the test.
 *
 * Three of these labels are load-bearing and must not be "improved" (CLAUDE.md §2, PUL-809
 * greps for them):
 *   - `submitted` is "Awaiting review", never "Submitted".
 *   - `revision_required` is "Needs revision", NEVER "Stuck" — the prototype's "Stuck —
 *     revision" collided with Blocked, which is a different thing entirely.
 *   - `completed` is "Done" and `approved` is "Done ✓". They read almost the same on purpose:
 *     both mean the work is finished. The check-shield icon on `approved` is the *only* visual
 *     difference, because the difference is QC-approved vs. manager-closed (a QC bypass), which
 *     is a provenance distinction, not a progress one. "Completed" is a manager-only status and
 *     the word never appears as an employee-facing label.
 */
export const STATUS_DISPLAY = {
  planned: {
    label: 'Not Started',
    className: 'bg-muted text-muted-foreground border-border',
    icon: false,
  },
  in_progress: {
    label: 'Working on it',
    className: 'bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-300',
    icon: false,
  },
  blocked: {
    label: 'Blocked',
    className: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-300',
    icon: false,
  },
  submitted: {
    label: 'Awaiting review',
    className: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300',
    icon: false,
  },
  revision_required: {
    label: 'Needs revision',
    className: 'bg-orange-500/10 text-orange-700 border-orange-500/30 dark:text-orange-300',
    icon: false,
  },
  approved: {
    label: 'Done ✓',
    className: 'bg-teal-500/10 text-teal-700 border-teal-500/30 dark:text-teal-300',
    icon: true,
  },
  completed: {
    label: 'Done',
    className: 'bg-teal-500/10 text-teal-700 border-teal-500/30 dark:text-teal-300',
    icon: false,
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-muted text-muted-foreground border-border line-through',
    icon: false,
  },
} as const satisfies Record<TaskStatus, StatusDisplay>;

/**
 * How a dependency-blocked pill draws, whatever the stored status is (§14.3.2, §3.2.5).
 *
 * Shares `blocked`'s color deliberately: to the person looking at the board, "you can't start
 * this yet" is one state, and the lock icon plus the tooltip naming the upstream task is what
 * says *why*. This is display only — the stored status is never rewritten to `blocked`.
 */
export const DEPENDENCY_BLOCKED_CLASSNAME = STATUS_DISPLAY.blocked.className;

/**
 * The four `task_priority` values, labelled. Same compile-time exhaustiveness as above.
 *
 * Plain labels rather than a display object: priority renders as text next to the pill in the
 * §14.3.3 header, and nothing yet asks it to carry a color of its own.
 */
export const PRIORITY_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
} as const satisfies Record<TaskPriority, string>;

/**
 * Statuses that count as "the upstream work is finished", i.e. a dependency that no longer
 * blocks (§3.2.5). `approved` (QC-passed) and `completed` (manager-closed) both mean done;
 * `cancelled` deliberately does NOT — a cancelled upstream task is an unresolved question about
 * the downstream one, not a green light.
 */
export const DEPENDENCY_SATISFIED_STATUSES: readonly TaskStatus[] = ['approved', 'completed'];
