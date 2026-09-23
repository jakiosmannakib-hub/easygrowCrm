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
import { DEPENDENCY_SATISFIED_STATUSES, PRIORITY_LABELS, STATUS_DISPLAY } from './display';

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
