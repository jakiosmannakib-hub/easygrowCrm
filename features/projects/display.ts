// features/projects/display.ts
//
// Presentation data for project tasks. Pure — no DB, no JSX — so it is safe in both client and
// server components, and testable in the node lane without a DOM.
//
// The counterpart to features/employees/display.ts, and it follows the same discipline: the
// maps are typed off the pgEnum's `enumValues`, so adding a status or a priority to the schema
// without labelling it here is a COMPILE error rather than a blank pill in production.

import { taskPriority, taskStatus, userRole } from '../../db/schema/enums';

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

// ─────────────────────────────────────────────────────────────────────────────────────────
// §14.3.2 status-dropdown option sets (PUL-407 Stage 3a)
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The statuses §13.4.4 `changeTaskStatusOpen` accepts — the employee-reachable pill.
 *
 * Mirrors `ChangeTaskStatusOpenInput`'s enum exactly. Deliberately a hand-written subset, not
 * derived from `taskStatus.enumValues`: widening it automatically when the DB enum gains a
 * value would offer a status the action refuses.
 */
export const OPEN_SETTABLE_STATUSES = ['planned', 'in_progress', 'blocked'] as const;

/**
 * The statuses §13.4.5 `setTaskStatusProtected` accepts FROM THE MENU — the manager overrides.
 *
 * **`approved` is deliberately absent.** The action lists it (a well-formed payload) but always
 * refuses it with `GATE:use_review`: approving goes through the Phase-6 review modal, never the
 * status menu (§14.3.2). Offering it here would render a menu item whose only possible outcome
 * is an error toast.
 */
export const PROTECTED_SETTABLE_STATUSES = ['revision_required', 'completed', 'cancelled'] as const;

/**
 * The statuses a task can be moved OUT OF via the menu — `OPEN_STATUSES` in actions.ts.
 *
 * Note `revision_required` is here but absent from `OPEN_SETTABLE_STATUSES`: a task in revision
 * is moved back to work through the menu, but only a review (§13.4.7) or a manager override
 * (§13.4.5) puts it there. Everything absent — `submitted`, `approved`, `completed`,
 * `cancelled` — is a locked state (§14.3.2), and the pill renders read-only.
 */
export const STATUS_CHANGEABLE_FROM = [
  'planned',
  'in_progress',
  'blocked',
  'revision_required',
] as const;

/**
 * The label a status carries **in the dropdown**, which differs from its pill label in exactly
 * one case.
 *
 * §14.3.2 writes the manager set as "… Needs revision · Done (Completed) · Cancelled", with the
 * parenthetical distinguishing it from "Done (Approved)", which is NOT in the menu. The pill
 * stays plain "Done" — on a board, provenance is carried by the check-shield icon, but in a menu
 * there is no pill to compare against, so the word does the work.
 *
 * This is a MANAGER-only control. CLAUDE.md's "'Completed' never appears as an employee-facing
 * label" is scoped to what employees see; the manager choosing an explicit QC bypass is exactly
 * who should see the word.
 *
 * PUL-809's forbidden-words grep does NOT cover this file — §17 scopes the "Completed" glob to
 * `features/attendance/**` and `features/daily-plan/**`, and §17's PUL-809 note now says not to
 * widen it to `features/**` for exactly this reason.
 */
export function statusMenuLabel(status: TaskStatus): string {
  return status === 'completed' ? 'Done (Completed)' : STATUS_DISPLAY[status].label;
}

/**
 * Who is looking, as far as the menu is concerned.
 *
 * `Role` is derived from the pgEnum rather than imported from `lib/authz`, deliberately: authz
 * pulls in `authorize()` → `lib/session` → `next/headers` and the db client, none of which may
 * cross into a client bundle. The enum module is pure.
 */
export type Role = (typeof userRole.enumValues)[number];

export interface StatusMenuViewer {
  id: string;
  role: Role;
}

/**
 * §9.6's manager-level roles. Mirrors `MANAGER_ROLES` in features/employees/queries.ts, which
 * cannot be imported here: that module pulls in the db client, and this one is consumed by
 * client components.
 */
export const MENU_MANAGER_ROLES: readonly Role[] = [
  'super_admin',
  'team_leader',
  'project_manager',
];

/**
 * Is this role manager-level? The one predicate behind both the §14.3.2 menu and the §14.3.3
 * post-submission lock, so the two can't disagree about who a "manager" is.
 */
export function isManagerRole(role: Role): boolean {
  return MENU_MANAGER_ROLES.includes(role);
}

/**
 * The §14.3.2 option set for one viewer looking at one task, and the single place that decides
 * whether the pill is a menu at all.
 *
 * Returns `[]` when the pill must render read-only, which happens when either:
 *   - the task sits in a locked state (`submitted` / `approved` / `completed` / `cancelled`) —
 *     §13.4.4 refuses to move those and §13.4.5 is a different, deliberate act; or
 *   - the viewer is an employee who is not the assignee, or is HR (no status cell at all).
 *
 * **This is convenience, not security.** Every option it returns is re-authorized server-side by
 * `changeTaskStatusOpen` / `setTaskStatusProtected`; the client only decides what to draw
 * (§16 — "the client displays; the server decides").
 *
 * `submit for review` is deliberately NOT produced: `submitTask` is Phase 6 (PUL-601), and
 * §14.3.2's "➤ Submit for review…" opens the Submit modal rather than setting a status.
 */
export function statusMenuOptions(
  status: TaskStatus,
  viewer: StatusMenuViewer,
  assigneeId: string | null,
): TaskStatus[] {
  if (!(STATUS_CHANGEABLE_FROM as readonly TaskStatus[]).includes(status)) return [];

  if (isManagerRole(viewer.role)) {
    return [...OPEN_SETTABLE_STATUSES, ...PROTECTED_SETTABLE_STATUSES];
  }

  // The only non-manager who may move a pill is the assignee (§9.6's `assignee` cell).
  // admin_hr holds no `set_status_open` cell at all, so it falls through to read-only.
  if (viewer.role === 'employee' && assigneeId === viewer.id) {
    return [...OPEN_SETTABLE_STATUSES];
  }

  return [];
}

/** Which action a chosen menu status routes to. */
export function isProtectedStatus(status: TaskStatus): boolean {
  return (PROTECTED_SETTABLE_STATUSES as readonly TaskStatus[]).includes(status);
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// §14.3 Month ▾ labels (PUL-408.2)
// ─────────────────────────────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * A retainer month number → `Month 3 — March`, calendar-anchored to the project's start date
 * (§1–§8 "Month dropdown … calendar-anchored via the project's start date"; the same anchor
 * §13.8's due-date computation uses — "Month k start = `startDate` + (k−1) calendar months").
 *
 * Deliberately string arithmetic on the `YYYY-MM-DD` and NOT a `Date`: a bare `date` column is
 * an Asia/Dhaka calendar day (§11.0), and `new Date('2026-01-01')` is UTC midnight, which is
 * how a project that starts on the 1st renders as starting in December. The month index is all
 * this needs, and it is right there in characters 6–7.
 *
 * **Day-clamping does not apply here, and that is not an oversight.** §13.8 clamps the day when
 * it computes a due *date* (Jan 31 + 1 month = Feb 28, not Mar 3). A month *name* is unaffected
 * by the clamp: adding k calendar months always lands in month index `start + k` whichever day
 * the clamp picks. Clamping here would be dead code that implies a subtlety that isn't there.
 *
 * Falls back to a bare `Month N` if the start date is malformed — a label with no month name is
 * degraded, but a wrong month name is a manager filtering to the wrong cycle.
 */
export function monthLabel(startDate: string, month: number): string {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  if (!parsed || !Number.isInteger(month) || month < 1) return `Month ${month}`;

  // `month` is 1-based (Month 1 IS the start month), so the offset from the start is month - 1.
  const index = (Number(parsed[2]) - 1 + (month - 1)) % 12;
  return `Month ${month} — ${MONTH_NAMES[index]}`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// §14.3 project header — progress, health, current month (PUL-408.2)
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The "done" set, §4.1 verbatim: *"`status === "Completed" || status === "Approved"` is the
 * 'done' check throughout the code"*. Both close a task; `approved` came through QC and
 * `completed` is the manager override, and §4.1 is explicit that they are "treated identically
 * in all reporting math".
 *
 * **Deliberately NOT shared with `DEPENDENCY_SATISFIED_STATUSES`,** which today holds the same
 * two values. They answer different questions — "does this count as finished for progress" vs
 * "may the downstream task start" — and they agree by coincidence, not by rule. Collapsing them
 * into one constant would mean a future change to either silently moves the other.
 */
export const DONE_STATUSES: readonly TaskStatus[] = ['approved', 'completed'];

/**
 * Statuses excluded from the progress DENOMINATOR and from the health calculation.
 *
 * §4.1's status table: `Cancelled` is *"Scope-cut; excluded from progress and workload"*, and
 * §4.2's transition row repeats it — *"Excluded from progress and health calcs"*. A cancelled
 * task is not incomplete work, so counting it in the total would make a project that cut scope
 * look permanently behind.
 */
export const PROGRESS_EXCLUDED_STATUSES: readonly TaskStatus[] = ['cancelled'];

/**
 * §3.1.3's "open tasks" — the pool the health score is computed from: *"Computed from open
 * tasks (excludes Completed, Approved, Cancelled)"*.
 */
export const OPEN_STATUSES_FOR_HEALTH: readonly TaskStatus[] = [
  'planned',
  'in_progress',
  'blocked',
  'submitted',
  'revision_required',
];

export type ProjectHealth = 'on_track' | 'at_risk' | 'delayed' | 'critical';

/**
 * §3.1.3's health score, transcribed rather than interpreted:
 *
 * ```
 * if   overdue_count >= 4                         → "Critical"
 * elif overdue_count >= 2                         → "Delayed"
 * elif overdue_count == 1 or waiting_review >= 3  → "At Risk"
 * else                                            → "On Track"
 * ```
 *
 * Note the ORDER is load-bearing and the branches are not mutually exclusive on their own: a
 * project with 5 overdue tasks and 4 awaiting review is Critical, not At Risk, because the
 * overdue tests come first. Written as an early-return chain for exactly that reason — a
 * refactor into independent `if`s would change the answer.
 *
 * `overdueCount` counts OPEN tasks with `due_date < today` (§3.1.3's first line scopes the whole
 * block to open tasks); `waitingReview` counts `submitted`. Both are supplied by the caller,
 * which is what keeps this a pure function the thresholds can be swept exhaustively.
 */
export function projectHealth(overdueCount: number, waitingReview: number): ProjectHealth {
  if (overdueCount >= 4) return 'critical';
  if (overdueCount >= 2) return 'delayed';
  if (overdueCount === 1 || waitingReview >= 3) return 'at_risk';
  return 'on_track';
}

/** Label + chip colors for each health state. Hexes are §3.1.3's, kept as the source of truth. */
export const HEALTH_DISPLAY = {
  on_track: {
    label: 'On Track',
    // #16A34A — Tailwind green-600, so the palette carries the spec's hex rather than a
    // hand-written arbitrary value.
    className: 'bg-green-600/10 text-green-700 border-green-600/30 dark:text-green-400',
  },
  at_risk: {
    label: 'At Risk',
    // #D97706 — amber-600.
    className: 'bg-amber-600/10 text-amber-700 border-amber-600/30 dark:text-amber-400',
  },
  delayed: {
    label: 'Delayed',
    // #EA580C — orange-600.
    className: 'bg-orange-600/10 text-orange-700 border-orange-600/30 dark:text-orange-400',
  },
  critical: {
    label: 'Critical',
    // #DC2626 — red-600.
    className: 'bg-red-600/10 text-red-700 border-red-600/30 dark:text-red-400',
  },
} as const satisfies Record<ProjectHealth, { label: string; className: string }>;

/**
 * §3.1 / §14.3's progress: `X/Y · N%`.
 *
 * `done` = tasks in `DONE_STATUSES`; `total` = every task on the project EXCEPT cancelled ones
 * (§4.1). The percentage rounds to the nearest whole number, which §14.3's own example pins:
 * `9/21 · 43%` — 9/21 is 42.857…, so it rounds rather than truncating (truncation would print
 * 42%).
 *
 * A project with no countable tasks is 0%, not `NaN%`: an empty project has made no progress,
 * and 0/0 must not reach the bar as a division by zero.
 */
export function progressPct(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

/** Days in a Gregorian month. Pure arithmetic — no `Date`, per the `no-direct-date` rule. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 30;
}

/**
 * §11.2's `currentMonth`, derived rather than stored: *"months elapsed since `start_date` in
 * Asia/Dhaka (resolves review issue 'who increments it' — nobody; it's computed)"*.
 *
 * Both arguments are `YYYY-MM-DD` Asia/Dhaka calendar days and neither becomes a `Date`. The
 * caller supplies `today` (from `dhakaToday()`, which reads the clock port) rather than this
 * function reaching for it, which is what makes the month arithmetic testable at fixed dates
 * without freezing a clock.
 *
 * **Month 1 IS the start month**, and the boundary is the start DAY, not the 1st: a project
 * starting Jan 15 is in Month 1 until Feb 14 and enters Month 2 on Feb 15. That matches §13.8's
 * due-date anchor ("Month k start = `startDate` + (k−1) calendar months, day-clamped").
 *
 * The day-clamp is the subtle case and it is handled: a project starting Jan 31 has no Feb 31,
 * so Month 2 begins on Feb 28 (or 29). Comparing against the raw start day alone would keep
 * that project in Month 1 for the whole of February and then jump it to Month 3 on Mar 31.
 *
 * Clamped to a minimum of 1 — a project whose `start_date` is in the future has not reached
 * Month 1 yet, but "Month 0" and "Month -2" are not things the §14.3 crumb can render.
 */
export function retainerMonth(startDate: string, today: string): number {
  const start = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  const now = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!start || !now) return 1;

  const [startYear, startMonth, startDay] = start.slice(1).map(Number) as [number, number, number];
  const [nowYear, nowMonth, nowDay] = now.slice(1).map(Number) as [number, number, number];

  let elapsed = (nowYear - startYear) * 12 + (nowMonth - startMonth);

  // The anniversary day in the CURRENT month, clamped to that month's length.
  const anchorDay = Math.min(startDay, daysInMonth(nowYear, nowMonth));
  if (nowDay < anchorDay) elapsed -= 1;

  return Math.max(1, elapsed + 1);
}
