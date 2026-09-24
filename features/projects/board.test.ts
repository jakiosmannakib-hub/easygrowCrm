// features/projects/board.test.ts — PUL-409 Stage 1
//
// Not a §15.4 mandatory file. The unit-lane guard on the Board's two pure helpers in display.ts:
// `groupBoardTasks` (which column a card lands in) and `overdueDays` (the red `Overdue Nd` line).
// No render, no DB — what can break the board silently is a task landing in two places, or an
// off-by-one on a month/year/leap boundary in the day count.

import { describe, expect, it } from 'vitest';
import {
  BOARD_COLUMN_BORDER,
  BOARD_STATUSES,
  STATUS_DISPLAY,
  groupBoardTasks,
  overdueDays,
  type TaskStatus,
} from './display';

function row(id: string, status: TaskStatus, assigneeId: string | null) {
  return { id, status, assignee: assigneeId === null ? null : { id: assigneeId } };
}

describe('BOARD_STATUSES', () => {
  it('is §14.3.1’s six columns, in order, labelled from STATUS_DISPLAY', () => {
    expect(BOARD_STATUSES.map((s) => STATUS_DISPLAY[s].label)).toEqual([
      'Not Started',
      'Working on it',
      'Blocked',
      'Awaiting review',
      'Needs revision',
      'Done ✓',
    ]);
  });

  it('has a top-border color for every column', () => {
    for (const s of BOARD_STATUSES) expect(BOARD_COLUMN_BORDER[s]).toMatch(/^border-t-/);
  });
});

describe('groupBoardTasks', () => {
  it('always returns all six columns in order, even when empty', () => {
    const { unassigned, columns } = groupBoardTasks([]);
    expect(unassigned).toEqual([]);
    expect(columns.map((c) => c.status)).toEqual([...BOARD_STATUSES]);
    expect(columns.every((c) => c.tasks.length === 0)).toBe(true);
  });

  it('places assigned tasks by status and preserves input order within a column', () => {
    const rows = [
      row('a', 'in_progress', 'u1'),
      row('b', 'planned', 'u1'),
      row('c', 'in_progress', 'u2'),
      row('d', 'approved', 'u2'),
    ];
    const { columns } = groupBoardTasks(rows);
    const ids = Object.fromEntries(columns.map((c) => [c.status, c.tasks.map((t) => t.id)]));
    expect(ids).toEqual({
      planned: ['b'],
      in_progress: ['a', 'c'],
      blocked: [],
      submitted: [],
      revision_required: [],
      approved: ['d'],
    });
  });

  it('puts unassigned tasks in the pinned group ONLY — never also in a status column', () => {
    const rows = [row('a', 'planned', null), row('b', 'planned', 'u1'), row('c', 'blocked', null)];
    const { unassigned, columns } = groupBoardTasks(rows);
    expect(unassigned.map((t) => t.id)).toEqual(['a', 'c']);
    const placed = columns.flatMap((c) => c.tasks.map((t) => t.id));
    expect(placed).toEqual(['b']);
  });

  it('places every input row exactly once', () => {
    const rows = BOARD_STATUSES.flatMap((s, i) => [row(`${s}-a`, s, `u${i}`), row(`${s}-u`, s, null)]);
    const { unassigned, columns } = groupBoardTasks(rows);
    const all = [...unassigned, ...columns.flatMap((c) => c.tasks)].map((t) => t.id);
    expect(all.sort()).toEqual(rows.map((r) => r.id).sort());
  });

  it('drops a status with no column (completed / cancelled) instead of crashing', () => {
    const { unassigned, columns } = groupBoardTasks([
      row('a', 'completed', 'u1'),
      row('b', 'cancelled', 'u1'),
    ]);
    expect(unassigned).toEqual([]);
    expect(columns.flatMap((c) => c.tasks)).toEqual([]);
  });
});

describe('overdueDays', () => {
  const today = '2026-09-24';

  it('is null with no due date', () => {
    expect(overdueDays(null, today, 'in_progress')).toBeNull();
  });

  it('is null when due today — strictly `<`, same as the health calc', () => {
    expect(overdueDays('2026-09-24', today, 'in_progress')).toBeNull();
  });

  it('is null when due in the future', () => {
    expect(overdueDays('2026-09-25', today, 'planned')).toBeNull();
  });

  it('counts whole Dhaka calendar days past due', () => {
    expect(overdueDays('2026-09-23', today, 'planned')).toBe(1);
    expect(overdueDays('2026-09-21', today, 'blocked')).toBe(3);
  });

  it('is null for finished work (approved / completed), whatever the date', () => {
    expect(overdueDays('2026-09-01', today, 'approved')).toBeNull();
    expect(overdueDays('2026-09-01', today, 'completed')).toBeNull();
  });

  it('still counts submitted and revision_required — they are open work', () => {
    expect(overdueDays('2026-09-20', today, 'submitted')).toBe(4);
    expect(overdueDays('2026-09-20', today, 'revision_required')).toBe(4);
  });

  it('crosses month, year and leap-day boundaries correctly', () => {
    expect(overdueDays('2026-08-31', '2026-09-01', 'planned')).toBe(1);
    expect(overdueDays('2025-12-31', '2026-01-01', 'planned')).toBe(1);
    expect(overdueDays('2028-02-28', '2028-03-01', 'planned')).toBe(2); // 2028 is a leap year
    expect(overdueDays('2026-02-28', '2026-03-01', 'planned')).toBe(1);
    expect(overdueDays('2025-09-24', '2026-09-24', 'planned')).toBe(365);
  });

  it('is null for a malformed date rather than a wrong number', () => {
    expect(overdueDays('Sep 1', today, 'planned')).toBeNull();
  });
});
