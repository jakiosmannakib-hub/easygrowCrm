// features/projects/status-pill.test.ts — PUL-407 Stage 2
//
// Not a §15.4 mandatory file. This is the unit-lane guard on the §14.3.2 status map: the pill's
// data, not its DOM. No render, no DB — the map is pure data typed off the pgEnum, and what can
// actually break it is a status added to the schema with no entry here, or someone "tidying" a
// label the business depends on.
//
// The exhaustiveness is already a compile error (`satisfies Record<TaskStatus, …>`); the first
// test is the runtime belt to that braces, and catches the case where the enum is widened at
// the same time as a cast is added to silence the compiler.

import { describe, expect, it } from 'vitest';
import { taskPriority, taskStatus } from '../../db/schema/enums';
import {
  DEPENDENCY_SATISFIED_STATUSES,
  OPEN_SETTABLE_STATUSES,
  PRIORITY_LABELS,
  PROTECTED_SETTABLE_STATUSES,
  STATUS_DISPLAY,
  isProtectedStatus,
  monthLabel,
  statusMenuOptions,
} from './display';

describe('STATUS_DISPLAY', () => {
  it('has an entry for every task_status enum value, and no extras', () => {
    expect(Object.keys(STATUS_DISPLAY).sort()).toEqual([...taskStatus.enumValues].sort());
  });

  it('gives every status a non-empty label and color', () => {
    for (const status of taskStatus.enumValues) {
      const display = STATUS_DISPLAY[status];
      expect(display.label, `${status} label`).not.toBe('');
      expect(display.className, `${status} className`).not.toBe('');
    }
  });

  it('uses the exact §14.3.2 display labels', () => {
    expect(STATUS_DISPLAY.planned.label).toBe('Not Started');
    expect(STATUS_DISPLAY.in_progress.label).toBe('Working on it');
    expect(STATUS_DISPLAY.blocked.label).toBe('Blocked');
    expect(STATUS_DISPLAY.submitted.label).toBe('Awaiting review');
    expect(STATUS_DISPLAY.revision_required.label).toBe('Needs revision');
    expect(STATUS_DISPLAY.approved.label).toBe('Done ✓');
    expect(STATUS_DISPLAY.completed.label).toBe('Done');
    expect(STATUS_DISPLAY.cancelled.label).toBe('Cancelled');
  });

  it('never shows an employee the banned words (CLAUDE.md §2, PUL-809)', () => {
    for (const status of taskStatus.enumValues) {
      const label = STATUS_DISPLAY[status].label.toLowerCase();
      // "Completed" is a manager-only status; its *label* is "Done".
      expect(label, `${status}`).not.toContain('completed');
      // "Stuck" collided with Blocked and was renamed to "Needs revision".
      expect(label, `${status}`).not.toContain('stuck');
      expect(label, `${status}`).not.toContain('score');
    }
  });

  it('marks only `approved` with the check-shield icon', () => {
    const withIcon = taskStatus.enumValues.filter((s) => STATUS_DISPLAY[s].icon);
    expect(withIcon).toEqual(['approved']);
  });
});

describe('PRIORITY_LABELS', () => {
  it('has an entry for every task_priority enum value, and no extras', () => {
    expect(Object.keys(PRIORITY_LABELS).sort()).toEqual([...taskPriority.enumValues].sort());
  });
});

describe('DEPENDENCY_SATISFIED_STATUSES', () => {
  it('counts approved and completed as done, and cancelled as not done', () => {
    expect(DEPENDENCY_SATISFIED_STATUSES).toEqual(['approved', 'completed']);
    expect(DEPENDENCY_SATISFIED_STATUSES).not.toContain('cancelled');
  });

  it('names only real statuses', () => {
    for (const status of DEPENDENCY_SATISFIED_STATUSES) {
      expect(taskStatus.enumValues).toContain(status);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// §14.3.2 dropdown option sets (PUL-407 Stage 3a)
//
// The pure half of the status menu: who is offered what. This is convenience logic — every
// option is re-authorized server-side — but it encodes §14.3.2's per-role table, and a menu
// offering a status the action refuses is a guaranteed error toast, so it is worth pinning.
// ─────────────────────────────────────────────────────────────────────────────────────────

const MGR = { id: 'u_mgr', role: 'project_manager' } as const;
const TL = { id: 'u_tl', role: 'team_leader' } as const;
const SA = { id: 'u_sa', role: 'super_admin' } as const;
const HR = { id: 'u_hr', role: 'admin_hr' } as const;
const EMP = { id: 'u_emp', role: 'employee' } as const;

describe('statusMenuOptions', () => {
  it('offers the assignee EMP exactly the open set — and never a submit action', () => {
    const options = statusMenuOptions('in_progress', EMP, EMP.id);
    expect(options).toEqual(['planned', 'in_progress', 'blocked']);
    // §14.3.2's "➤ Submit for review…" is Phase 6 (PUL-601) and must not appear as a status.
    expect(options).not.toContain('submitted');
  });

  it('lets the assignee move OUT of revision_required but never back INTO it', () => {
    const options = statusMenuOptions('revision_required', EMP, EMP.id);
    expect(options).toEqual(['planned', 'in_progress', 'blocked']);
    expect(options).not.toContain('revision_required');
  });

  it('offers a non-assignee EMP nothing', () => {
    expect(statusMenuOptions('in_progress', EMP, 'someone_else')).toEqual([]);
    expect(statusMenuOptions('in_progress', EMP, null)).toEqual([]);
  });

  it('offers HR nothing — no set_status cell at all (§9.6)', () => {
    expect(statusMenuOptions('in_progress', HR, HR.id)).toEqual([]);
  });

  it('offers every manager role the open set plus Needs revision and Cancelled only', () => {
    // §14.3.2 after Amendment M (PUL-416.2): "Done (Completed)" is gone from the manager set.
    for (const manager of [MGR, TL, SA]) {
      const options = statusMenuOptions('in_progress', manager, null);
      expect(options, manager.role).toEqual([
        'planned',
        'in_progress',
        'blocked',
        'revision_required',
        'cancelled',
      ]);
    }
  });

  it('never offers `completed` to anyone, from any status (Amendment M)', () => {
    for (const viewer of [MGR, TL, SA, HR, EMP]) {
      for (const status of taskStatus.enumValues) {
        expect(statusMenuOptions(status, viewer, viewer.id), `${viewer.role}/${status}`).not.toContain(
          'completed',
        );
      }
    }
  });

  it('never offers `approved` to anyone — approval is the review modal (GATE:use_review)', () => {
    for (const viewer of [MGR, TL, SA, HR, EMP]) {
      for (const status of taskStatus.enumValues) {
        expect(statusMenuOptions(status, viewer, viewer.id), `${viewer.role}/${status}`).not.toContain(
          'approved',
        );
      }
    }
  });

  it('closes the menu entirely in every locked state, for managers too', () => {
    for (const status of ['submitted', 'approved', 'completed', 'cancelled'] as const) {
      expect(statusMenuOptions(status, MGR, null), status).toEqual([]);
      expect(statusMenuOptions(status, EMP, EMP.id), status).toEqual([]);
    }
  });

  it('only ever returns statuses the two actions actually accept', () => {
    const accepted = new Set<string>([...OPEN_SETTABLE_STATUSES, ...PROTECTED_SETTABLE_STATUSES]);
    for (const viewer of [MGR, TL, SA, HR, EMP]) {
      for (const status of taskStatus.enumValues) {
        for (const option of statusMenuOptions(status, viewer, viewer.id)) {
          expect(accepted.has(option), `${viewer.role}/${status} → ${option}`).toBe(true);
        }
      }
    }
  });
});

describe('isProtectedStatus', () => {
  it('routes the manager overrides to setTaskStatusProtected and the rest to the open action', () => {
    expect(isProtectedStatus('revision_required')).toBe(true);
    expect(isProtectedStatus('cancelled')).toBe(true);
    // Not a menu status any more (Amendment M), so it routes nowhere from the pill.
    expect(isProtectedStatus('completed')).toBe(false);
    expect(isProtectedStatus('planned')).toBe(false);
    expect(isProtectedStatus('in_progress')).toBe(false);
    expect(isProtectedStatus('blocked')).toBe(false);
  });
});

describe('monthLabel — §14.3 Month ▾ (PUL-408.2)', () => {
  it('anchors Month 1 to the project start month', () => {
    expect(monthLabel('2026-03-01', 1)).toBe('Month 1 - March');
  });

  it('advances one calendar month per retainer month', () => {
    expect(monthLabel('2026-03-01', 2)).toBe('Month 2 - April');
    expect(monthLabel('2026-03-15', 6)).toBe('Month 6 - August');
  });

  it('wraps across the year boundary', () => {
    // Month 13 of a November start is November again, a year on — the label names the month,
    // not the year, exactly as §14.3's `Month N — MonthName` crumb does.
    expect(monthLabel('2026-11-01', 3)).toBe('Month 3 - January');
    expect(monthLabel('2026-11-01', 13)).toBe('Month 13 - November');
  });

  it('is unaffected by the day of the month — day-clamping cannot change the month name', () => {
    // §13.8 clamps the DAY when computing a due date (Jan 31 + 1 month = Feb 28). A month name
    // is immune to that: whichever day the clamp picks, it is still in February.
    expect(monthLabel('2026-01-31', 2)).toBe('Month 2 - February');
    expect(monthLabel('2026-01-01', 2)).toBe('Month 2 - February');
  });

  it('degrades to a bare `Month N` rather than naming the wrong month', () => {
    // A label with no month name is merely poor; a wrong one sends a manager to the wrong cycle.
    expect(monthLabel('not-a-date', 4)).toBe('Month 4');
    expect(monthLabel('', 4)).toBe('Month 4');
    expect(monthLabel('2026-03-01', -1)).toBe('Month -1');
  });

  it('labels Month 0 "Onboarding", never "Month 0" and never a calendar month (PUL-419)', () => {
    expect(monthLabel('2026-03-01', 0)).toBe('Onboarding');
    expect(monthLabel('not-a-date', 0)).toBe('Onboarding');
  });
});
