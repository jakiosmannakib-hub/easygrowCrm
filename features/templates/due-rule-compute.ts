// features/templates/due-rule-compute.ts — PUL-505, §13.3.2
//
// Turns each template task's `due_rule` into a real `YYYY-MM-DD` due date for a project that
// starts on `startDate`. Start Project (PUL-506) calls this inside `createProjectFromTemplate`
// and turns a failure into `GATE:no_deadline` / `GATE:bad_ref`.
//
// Pure: no DB, no clock, no I/O, and no `Date`. All day math is `lib/dates` on strings.
//
// §13.3.2's rules, month-aware:
//   - Month 1 starts on `startDate`; Month k on `startDate` + (k−1) calendar months, the day
//     clamped to that REAL month (Jan 31, 2027 → Feb 28, 2027). This is the concrete-year
//     version of the §14.4.3 cascade: `cascade.ts` keeps February at 29 because a template month
//     has no year; a project does. The month start itself is never shifted.
//   - `day` n       → month start + (n−1). Day 0 is treated as Day 1.
//   - `before_deadline` n → deadline − n. No deadline → `no_deadline`.
//   - `after` ref   → the referenced task's computed due + 1 working day. Unresolvable ref or a
//     cycle → `bad_ref`.
//   - `day` and `after` results then skip FORWARD off Fri/Sat/holidays. `before_deadline`
//     results skip BACKWARD, so a task never lands after the deadline (owner's ruling, PUL-505).

import {
  addDays,
  addMonthsClamped,
  nextWorkingDay,
  shiftBackToWorkingDay,
  shiftToWorkingDay,
} from '../../lib/dates';
import type { FlatTemplateTask } from './hierarchy';

/** What the resolver reads from a `tplAllTasks` row. A full `FlatTemplateTask` satisfies it. */
export type DueRuleTask = Pick<FlatTemplateTask, 'id' | 'dueRule' | '_monthNum'>;

export interface DueRuleContext {
  /** Project start, `YYYY-MM-DD`. Month 1's start. */
  startDate: string;
  /** Project deadline, `YYYY-MM-DD`, or `null` when the project has none. */
  deadline: string | null;
  /** Non-working `YYYY-MM-DD` days besides Fri/Sat. */
  holidays: ReadonlySet<string>;
}

export type DueRuleFailureReason = 'no_deadline' | 'bad_ref';

export type DueDatesResult =
  | { ok: true; dates: Map<string, string> }
  | { ok: false; reason: DueRuleFailureReason; taskId: string };

/** Internal: aborts the walk. Never escapes `computeDueDates`. */
class DueRuleFailure {
  constructor(
    readonly reason: DueRuleFailureReason,
    readonly taskId: string,
  ) {}
}

/**
 * The due date of every task, keyed by template task id, or the first failure in `tasks` order.
 *
 * `after` chains resolve in any input order: each task is computed on demand and memoised, and
 * a task met again while its own chain is still being resolved is a cycle. A failure names the
 * task whose rule could not be resolved (for a cycle, the task whose `ref` closes it).
 */
export function computeDueDates(
  tasks: readonly DueRuleTask[],
  ctx: DueRuleContext,
): DueDatesResult {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const dates = new Map<string, string>();
  const resolving = new Set<string>();

  function resolve(task: DueRuleTask): string {
    const known = dates.get(task.id);
    if (known !== undefined) return known;

    resolving.add(task.id);
    const rule = task.dueRule;
    let due: string;
    switch (rule.kind) {
      case 'day': {
        const monthStart = addMonthsClamped(ctx.startDate, task._monthNum - 1);
        due = shiftToWorkingDay(addDays(monthStart, Math.max(rule.n, 1) - 1), ctx.holidays);
        break;
      }
      case 'before_deadline': {
        if (ctx.deadline === null) throw new DueRuleFailure('no_deadline', task.id);
        due = shiftBackToWorkingDay(addDays(ctx.deadline, -rule.n), ctx.holidays);
        break;
      }
      case 'after': {
        const ref = byId.get(rule.ref);
        if (ref === undefined || resolving.has(ref.id)) {
          throw new DueRuleFailure('bad_ref', task.id);
        }
        // Already a working day: `nextWorkingDay` shifts forward itself.
        due = nextWorkingDay(resolve(ref), ctx.holidays);
        break;
      }
    }
    resolving.delete(task.id);

    dates.set(task.id, due);
    return due;
  }

  try {
    for (const task of tasks) resolve(task);
  } catch (err) {
    if (err instanceof DueRuleFailure) return { ok: false, reason: err.reason, taskId: err.taskId };
    throw err;
  }
  return { ok: true, dates };
}
