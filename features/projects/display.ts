// features/projects/display.ts
//
// Presentation data for project tasks. Pure — no DB, no JSX — so it is safe in both client and
// server components, and testable in the node lane without a DOM.
//
// The counterpart to features/employees/display.ts, and it follows the same discipline: the
// maps are typed off the pgEnum's `enumValues`, so adding a status or a priority to the schema
// without labelling it here is a COMPILE error rather than a blank pill in production.

import { taskPriority, taskStatus, userRole } from '../../db/schema/enums';
import { addDays, dayNumber, daysInMonth, isoDay, weekday } from '../../lib/dates';

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
 *     is a provenance distinction, not a progress one. Amendment M removed that bypass, so no
 *     new row is ever `completed`; the label stays so rows closed before it still render. The
 *     word "Completed" never appears as an employee-facing label.
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
 * The status labels the **client** Excel export prints (PUL-413, §3.1.7 / §6.3). Only used in
 * that workbook, never in the app UI.
 *
 * The export includes only `approved`, `completed` and `in_progress`. §3.1.7 relabels
 * `approved` as "Completed" for the client, because a client does not need to know whether the
 * work closed through QC or by a manager.
 *
 * **This is the one sanctioned "Completed" string in `features/**`.** CLAUDE.md bans the word
 * as an *employee-facing* label. This map is *client-facing*, and §3.1.7 requires the word
 * here. PUL-809's grep targets `features/attendance` and `features/daily-plan` (§16), so this
 * file is outside it. Do not reuse this map in any component.
 *
 * `satisfies Record<TaskStatus, string>` makes it exhaustive, so adding a status to the enum
 * without labelling it is a compile error. Statuses outside the export's filter never reach
 * the workbook, so they keep their normal §14.3.2 label.
 */
export const CLIENT_STATUS_LABEL = {
  planned: STATUS_DISPLAY.planned.label,
  in_progress: 'In Progress',
  blocked: STATUS_DISPLAY.blocked.label,
  submitted: STATUS_DISPLAY.submitted.label,
  revision_required: STATUS_DISPLAY.revision_required.label,
  approved: 'Completed',
  completed: 'Completed',
  cancelled: STATUS_DISPLAY.cancelled.label,
} as const satisfies Record<TaskStatus, string>;

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
 * **`approved` and `completed` are deliberately absent.** The action lists both (a well-formed
 * payload) but always refuses them with `GATE:use_review`: a task closes only when a manager
 * approves its submission in the Phase-6 review modal, never from the status menu (§14.3.2,
 * Amendment M). Offering either here would render a menu item whose only possible outcome is an
 * error toast.
 */
export const PROTECTED_SETTABLE_STATUSES = ['revision_required', 'cancelled'] as const;

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

// ─────────────────────────────────────────────────────────────────────────────────────────
// §14.3.1 Board — columns, grouping, overdue days (PUL-409)
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * §14.3.1's six Kanban columns, in the spec's left-to-right order.
 *
 * `completed` and `cancelled` have no column: `getFilteredTasks` already excludes both (see its
 * flagged decision), so a column for them would always be empty.
 */
export const BOARD_STATUSES = [
  'planned',
  'in_progress',
  'blocked',
  'submitted',
  'revision_required',
  'approved',
] as const satisfies readonly TaskStatus[];

export type BoardStatus = (typeof BOARD_STATUSES)[number];

/**
 * Each column's top border, in its status color (§14.3.1). The hue matches `STATUS_DISPLAY`'s
 * pill for the same status; kept as a separate map because a border wants the solid color,
 * where the pill wants a 10% tint.
 */
export const BOARD_COLUMN_BORDER = {
  planned: 'border-t-muted-foreground/40',
  in_progress: 'border-t-blue-500',
  blocked: 'border-t-red-500',
  submitted: 'border-t-amber-500',
  revision_required: 'border-t-orange-500',
  approved: 'border-t-teal-500',
} as const satisfies Record<BoardStatus, string>;

/**
 * The priority pill on a board card. §14.3.1 asks for a "priority pill" and names no colors, so
 * this is neutral for the everyday two and tinted only where a manager scanning a column should
 * notice: high (amber) and urgent (red).
 */
export const PRIORITY_PILL_CLASSNAME = {
  low: 'bg-muted text-muted-foreground border-border',
  medium: 'bg-muted text-muted-foreground border-border',
  high: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300',
  urgent: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-300',
} as const satisfies Record<TaskPriority, string>;

/** The minimum a row needs for the board to place it. `FilteredTaskRow` satisfies it. */
interface BoardPlaceable {
  status: TaskStatus;
  assignee: { id: string } | null;
}

export interface BoardGroups<T> {
  /** §14.3.1's pinned group: every matching task with no assignee, whatever its status. */
  unassigned: T[];
  /** One entry per `BOARD_STATUSES` value, in order, ALWAYS all six (empty columns included). */
  columns: { status: BoardStatus; tasks: T[] }[];
}

/**
 * Split the filtered rows into the pinned Unassigned group and the six status columns.
 *
 * **Every task lands in exactly one place.** An unassigned task goes to the Unassigned group and
 * NOT also to its status column — showing it twice would double-count it in the column chip,
 * and assigning it (the whole point of the group, §13.4.3) is what moves it into a column.
 *
 * Input order is preserved within every group, so `getFilteredTasks`' stable priority → due →
 * created ordering carries straight through to each column. A row whose status has no column
 * (`completed` / `cancelled`, which the query already excludes) is dropped rather than
 * crashing the board.
 */
export function groupBoardTasks<T extends BoardPlaceable>(rows: readonly T[]): BoardGroups<T> {
  const byStatus = new Map<TaskStatus, T[]>(BOARD_STATUSES.map((s) => [s, []]));
  const unassigned: T[] = [];

  for (const row of rows) {
    if (row.assignee === null) {
      unassigned.push(row);
      continue;
    }
    byStatus.get(row.status)?.push(row);
  }

  return {
    unassigned,
    columns: BOARD_STATUSES.map((status) => ({ status, tasks: byStatus.get(status) ?? [] })),
  };
}

/**
 * Move a `YYYY-MM-DD` Asia/Dhaka calendar day by `days`, which may be negative: `lib/dates`'s
 * `addDays` (no `Date`, so nothing can slip across a UTC offset), made lenient.
 *
 * Used for the client export windows (PUL-413): `shiftIsoDay(dhakaToday(), -6)` is the first
 * day of a 7-day inclusive window. Returns the input unchanged if it is not `YYYY-MM-DD`, where
 * `addDays` throws.
 */
export function shiftIsoDay(iso: string, days: number): string {
  return dayNumber(iso) === null ? iso : addDays(iso, days);
}

/**
 * §14.3.1's red `Overdue Nd` line: how many whole Dhaka calendar days a task is past due, or
 * `null` when it should show no overdue line at all.
 *
 * Same rule as the header's health calc (§3.1.3, `getProjectHeader`): **strictly `<` today** —
 * a task due today is not overdue — and **open tasks only**. A `DONE_STATUSES` task is finished
 * work, and finished work cannot be late, whatever its due date says.
 *
 * `today` is supplied by the caller (`dhakaToday()`, which reads the clock port) so this stays
 * pure and testable at fixed dates without freezing a clock.
 */
export function overdueDays(
  dueDate: string | null,
  today: string,
  status: TaskStatus,
): number | null {
  if (dueDate === null || DONE_STATUSES.includes(status)) return null;
  const due = dayNumber(dueDate);
  const now = dayNumber(today);
  if (due === null || now === null || due >= now) return null;
  return now - due;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// §14.3.4 List — Month → Category → Task tree, collapse state, category colors (PUL-410)
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The category color-dot palette. Full static class strings so Tailwind's scanner keeps them —
 * a template-built `bg-${hue}-500` would be purged from the production CSS.
 */
const CATEGORY_DOT_PALETTE = [
  'bg-sky-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-lime-500',
  'bg-fuchsia-500',
] as const;

/**
 * A stable color for a category NAME (§14.3.4's "color dot").
 *
 * `project_tasks.category` is free text with no stored color (§11), so the color is derived: a
 * djb2 hash of the name, modulo the palette. Stable across renders, sessions and users — "SEO"
 * is the same dot on every screen — which is the only property a category color needs. Two
 * categories can collide on a hue; with eight hues and a handful of categories per project
 * that is accepted rather than engineered around.
 */
export function categoryDotClass(category: string): string {
  let hash = 5381;
  for (let i = 0; i < category.length; i++) {
    hash = ((hash * 33) ^ category.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_DOT_PALETTE[hash % CATEGORY_DOT_PALETTE.length]!;
}

/** The minimum a row needs for the tree to place it. `FilteredTaskRow` satisfies it. */
interface TreePlaceable {
  month: number | null;
  category: string;
  status: TaskStatus;
}

export interface TaskTreeCategory<T> {
  /** Unique across the whole tree — the collapse-state key. */
  key: string;
  category: string;
  /** `DONE_STATUSES` tasks in this group. */
  done: number;
  total: number;
  tasks: T[];
}

export interface TaskTreeMonth<T> {
  /** Unique across the whole tree — the collapse-state key. */
  key: string;
  /** `null` is the Unscheduled group: one-off work with no retainer month (§11.3). */
  month: number | null;
  done: number;
  total: number;
  categories: TaskTreeCategory<T>[];
}

/** Month key → `month:3`, or `month:none` for Unscheduled. */
function monthKey(month: number | null): string {
  return month === null ? 'month:none' : `month:${month}`;
}

/**
 * Group the filtered rows into §14.3.4's Month → Category → Task tree.
 *
 * - **Months ascend; Unscheduled (`month === null`) is always LAST.**
 * - **Categories sort alphabetically within a month.** The row carries no template position, and
 *   first-appearance order would follow the query's priority sort, so a category would jump
 *   whenever one of its tasks changed priority. Alphabetical is the stable choice.
 * - **Tasks keep the input order** — `getFilteredTasks`' priority → due → created ordering.
 * - `done` counts `DONE_STATUSES`. Note what `total` can't include: `getFilteredTasks` already
 *   drops `completed` and `cancelled`, so a group's count is "approved of what's still shown",
 *   not the project header's whole-project progress.
 *
 * Keys are structural (`month:3`, `month:3/category:SEO`) so the same group keeps the same key
 * across refetches and filter changes — which is what lets collapse state survive them.
 */
export function groupTaskTree<T extends TreePlaceable>(rows: readonly T[]): TaskTreeMonth<T>[] {
  const months = new Map<number | null, Map<string, T[]>>();

  for (const row of rows) {
    let categories = months.get(row.month);
    if (categories === undefined) {
      categories = new Map();
      months.set(row.month, categories);
    }
    const tasks = categories.get(row.category);
    if (tasks === undefined) categories.set(row.category, [row]);
    else tasks.push(row);
  }

  const isDone = (t: T) => DONE_STATUSES.includes(t.status);

  return [...months.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a - b))
    .map(([month, categories]) => {
      const mKey = monthKey(month);
      const cats = [...categories.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, tasks]) => ({
          key: `${mKey}/category:${category}`,
          category,
          done: tasks.filter(isDone).length,
          total: tasks.length,
          tasks,
        }));
      return {
        key: mKey,
        month,
        done: cats.reduce((n, c) => n + c.done, 0),
        total: cats.reduce((n, c) => n + c.total, 0),
        categories: cats,
      };
    });
}

/** Every group key in the tree → whether it is expanded. Complete: no key is ever missing. */
export type TreeOpenState = Record<string, boolean>;

/**
 * Resolve the List view's collapse state — §16.10 applied to a tree whose keys come from data.
 *
 * The component holds ONE declared state object, `overrides` (starts `{}`), recording only what
 * the user has toggled. This function turns it into the COMPLETE map for the current tree: every
 * month, category and expandable-task key present, each either the user's choice or its default.
 * Nothing ever reads a key that may not exist, and nothing lazily creates one on first touch — the
 * prototype's `if (!S.collapsed[k])` pattern that made months vanish (§14.16) has no place to live.
 *
 * Defaults (UI polish, Stage 2 — replaced the PUL-410 "only the current cycle open" default):
 * - **Months: expanded.**
 * - **Categories: expanded.**
 * - **Tasks with subtasks: collapsed** under `task:<id>`, their `done/total` badge standing in for
 *   the rows. A task with no subtasks has nothing to expand and gets no key.
 */
export function treeOpenState<T extends { id: string; subtaskTotal: number }>(
  tree: readonly TaskTreeMonth<T>[],
  overrides: Readonly<Record<string, boolean>>,
): TreeOpenState {
  const state: TreeOpenState = {};
  for (const m of tree) {
    state[m.key] = overrides[m.key] ?? true;
    for (const c of m.categories) {
      state[c.key] = overrides[c.key] ?? true;
      for (const t of c.tasks) {
        if (t.subtaskTotal > 0) state[taskKey(t.id)] = overrides[taskKey(t.id)] ?? false;
      }
    }
  }
  return state;
}

/** A task's collapse-state key. Task ids are unique, so it needs no month/category prefix. */
export function taskKey(taskId: string): string {
  return `task:${taskId}`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// §14.3.4 Calendar — viewed month, month grid, tasks by day (PUL-411)
// ─────────────────────────────────────────────────────────────────────────────────────────

/** A calendar month — `month` is 1-based (1 = January). Not a retainer month. */
export interface CalendarMonth {
  year: number;
  month: number;
}

/** One cell of the month grid. */
export interface CalendarDay {
  /** `YYYY-MM-DD` — the same format as `dueDate`, so a task matches its cell by string equality. */
  iso: string;
  /** Day of the month, for the cell's number. */
  day: number;
  /** `false` for the leading / trailing days of the adjacent months, which render muted. */
  inMonth: boolean;
}

/**
 * The calendar month a `YYYY-MM-DD` day falls in — how the Calendar derives its starting month
 * from `dhakaToday()`. By splitting the string, never through a `Date`, so an Asia/Dhaka day
 * cannot drift into the previous month in a browser west of UTC+6.
 */
export function calendarMonthOf(iso: string): CalendarMonth {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
  // Unreachable for `dhakaToday()`'s output; a sane fallback beats NaN in the header.
  if (!m) return { year: 1970, month: 1 };
  return { year: Number(m[1]), month: Number(m[2]) };
}

/** Prev / Next: shift by `delta` months, rolling the year over (Dec + 1 → Jan, Jan − 1 → Dec). */
export function shiftCalendarMonth(cm: CalendarMonth, delta: number): CalendarMonth {
  const index = cm.year * 12 + (cm.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
}

/** §14.3.4's header: `September 2026` — the year is ALWAYS shown (§14.15 r.2). */
export function calendarMonthTitle(cm: CalendarMonth): string {
  return `${MONTH_NAMES[cm.month - 1] ?? ''} ${cm.year}`;
}

/** The week header, Sunday first — the agency's work week is Sun–Thu (CLAUDE.md §2). */
export const CALENDAR_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * The month grid: whole weeks (Sunday first), padded with the previous month's trailing days
 * and the next month's leading days. Between 4 and 6 weeks depending on the month.
 *
 * Pure integer arithmetic, no `Date`: the weekday comes from `lib/dates`'s `weekday`. A `Date`
 * built in the browser's zone could drift near midnight, and this file keeps every calendar day
 * a plain Asia/Dhaka string (§11.0).
 */
export function calendarGrid(cm: CalendarMonth): CalendarDay[][] {
  const { year, month } = cm;
  const leading = weekday(isoDay(year, month, 1)); // 0 = Sunday
  const inMonthDays = daysInMonth(year, month);

  const prev = shiftCalendarMonth(cm, -1);
  const next = shiftCalendarMonth(cm, 1);
  const prevDays = daysInMonth(prev.year, prev.month);

  const cells: CalendarDay[] = [];
  for (let i = leading; i > 0; i--) {
    const day = prevDays - i + 1;
    cells.push({ iso: isoDay(prev.year, prev.month, day), day, inMonth: false });
  }
  for (let day = 1; day <= inMonthDays; day++) {
    cells.push({ iso: isoDay(year, month, day), day, inMonth: true });
  }
  const trailing = (7 - (cells.length % 7)) % 7;
  for (let day = 1; day <= trailing; day++) {
    cells.push({ iso: isoDay(next.year, next.month, day), day, inMonth: false });
  }

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * Bucket rows by due day, keyed by the `YYYY-MM-DD` string exactly as stored, so a cell looks
 * its tasks up with `buckets.get(cell.iso)`. Input order is kept within a day (the query's
 * priority → due → created order, so urgent work is the first chip).
 *
 * **Undated tasks are omitted** — they have no day to sit on. So is a malformed date, rather
 * than being guessed onto a wrong one.
 */
export function bucketTasksByDay<T extends { dueDate: string | null }>(
  rows: readonly T[],
): Map<string, T[]> {
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    if (row.dueDate === null || dayNumber(row.dueDate) === null) continue;
    const day = buckets.get(row.dueDate);
    if (day === undefined) buckets.set(row.dueDate, [row]);
    else day.push(row);
  }
  return buckets;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// §14.3 tabs (moved here from the filter bar in PUL-417 so the page can validate `?tab=`)
// ─────────────────────────────────────────────────────────────────────────────────────────

const ALL_TAB_ROLES: readonly Role[] = [
  'super_admin',
  'team_leader',
  'project_manager',
  'admin_hr',
  'employee',
];
/** §14.3: "Review + Workload MGR/HR". */
const MGR_HR_TAB_ROLES: readonly Role[] = [
  'super_admin',
  'team_leader',
  'project_manager',
  'admin_hr',
];

/**
 * §14.3's tab strip, each with an explicit role list (the `lib/nav.ts` convention rather than a
 * live `can()`, which would pull lib/authz into a client bundle). Hiding a tab is cosmetic
 * (§9.5 r.2): `loadReviewQueue` and `loadWorkload` refuse on the server. Manager QA (SA + TL)
 * is PUL-604 and is deliberately not offered yet.
 */
export const PROJECT_TABS = [
  { key: 'board', label: 'Board', visibleTo: ALL_TAB_ROLES },
  { key: 'list', label: 'List', visibleTo: ALL_TAB_ROLES },
  { key: 'calendar', label: 'Calendar', visibleTo: ALL_TAB_ROLES },
  { key: 'review', label: 'Review', visibleTo: MGR_HR_TAB_ROLES },
  { key: 'workload', label: 'Workload', visibleTo: MGR_HR_TAB_ROLES },
] as const;

export type ProjectTabKey = (typeof PROJECT_TABS)[number]['key'];

/**
 * `?tab=` → a tab this role can see, else `'board'`. So an employee's link to `?tab=review`
 * opens the Board instead of a tab strip with nothing selected.
 */
export function parseProjectTab(raw: string | null | undefined, role: Role): ProjectTabKey {
  const tab = PROJECT_TABS.find((t) => t.key === raw);
  return tab && tab.visibleTo.includes(role) ? tab.key : 'board';
}

/** The tabs shown with nothing selected (§14.3 Amendment M): agency-wide Review and Workload. */
export type AgencyTabKey = Extract<ProjectTabKey, 'review' | 'workload'>;

/**
 * `?tab=` with nothing selected → `'review'` or `'workload'`, defaulting to Review. `null` when
 * the role sees neither (an employee), so the page shows its empty state instead.
 */
export function parseAgencyTab(raw: string | null | undefined, role: Role): AgencyTabKey | null {
  const visible = PROJECT_TABS.filter(
    (t): t is Extract<(typeof PROJECT_TABS)[number], { key: AgencyTabKey }> =>
      (t.key === 'review' || t.key === 'workload') && t.visibleTo.includes(role),
  );
  if (visible.length === 0) return null;
  return visible.find((t) => t.key === raw)?.key ?? visible[0].key;
}
