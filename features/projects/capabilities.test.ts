// features/projects/capabilities.test.ts — PUL-407 Stage 3b
//
// Not a §15.4 mandatory file, but close to one in spirit: this is the client's copy of who may
// edit a task's child rows, and §15.2 says to test "the rules that silently break the business
// if wrong — permissions, invariants, gates".
//
// The sweep below is exhaustive on purpose — every role × assignee-or-not × every task status ×
// archived-or-not — because the interesting bugs here are combinations, not single cells: a
// manager wrongly locked by `submitted`, an employee wrongly unlocked on someone else's task, a
// comment box wrongly closed on an approved task.
//
// `can()` is pure (no DB, no clock), so nothing here touches Postgres.

import { describe, expect, it } from 'vitest';
import { taskStatus, userRole } from '../../db/schema/enums';
import type { Role } from '../../lib/authz';
import { taskCapabilities, type TaskCapabilities } from './capabilities';

const ROLES = userRole.enumValues;
const STATUSES = taskStatus.enumValues;
const MANAGERS: readonly Role[] = ['super_admin', 'team_leader', 'project_manager'];

const VIEWER_ID = 'u_viewer';
const OTHER_ID = 'u_other';

/** Every combination, as one flat list the assertions below filter. */
function build(
  role: Role,
  isAssignee: boolean,
  status: (typeof STATUSES)[number],
  archived: boolean,
): TaskCapabilities {
  return taskCapabilities({
    viewer: { id: VIEWER_ID, role },
    task: { status, assigneeId: isAssignee ? VIEWER_ID : OTHER_ID },
    project: { status: archived ? 'archived' : 'active' },
  });
}

function forEachCombo(
  fn: (
    caps: TaskCapabilities,
    ctx: { role: Role; isAssignee: boolean; status: string; archived: boolean; label: string },
  ) => void,
) {
  for (const role of ROLES) {
    for (const isAssignee of [true, false]) {
      for (const status of STATUSES) {
        for (const archived of [true, false]) {
          fn(build(role, isAssignee, status, archived), {
            role,
            isAssignee,
            status,
            archived,
            label: `${role}/${isAssignee ? 'assignee' : 'other'}/${status}/${archived ? 'archived' : 'active'}`,
          });
        }
      }
    }
  }
}

describe('taskCapabilities — archived project (rule 1)', () => {
  it('takes away all four capabilities from EVERY role, including managers', () => {
    forEachCombo((caps, ctx) => {
      if (!ctx.archived) return;
      expect(caps, ctx.label).toEqual({
        canToggleChecklist: false,
        canManageChecklist: false,
        canManageSubtasks: false,
        canComment: false,
      });
    });
  });

  it('closes comments too — the one case where the conversation stops (§13.3.4)', () => {
    // Deliberately asserted on its own: `addComment`'s ONLY guard is guardProjectNotArchived,
    // so this is the single status-independent way canComment goes false.
    expect(build('super_admin', true, 'in_progress', true).canComment).toBe(false);
    expect(build('employee', true, 'in_progress', true).canComment).toBe(false);
  });
});

describe('taskCapabilities — comments never lock (rule 4, §3.2.3)', () => {
  it('stays open for every role on every task status while the project is active', () => {
    forEachCombo((caps, ctx) => {
      if (ctx.archived) return;
      // §9.6 gives `project_task.comment` an unconditional allow to all five roles — including
      // a non-assignee employee and HR.
      expect(caps.canComment, ctx.label).toBe(true);
    });
  });

  it('is open specifically on submitted — what the lock banner promises', () => {
    expect(build('employee', true, 'submitted', false).canComment).toBe(true);
    expect(build('admin_hr', false, 'submitted', false).canComment).toBe(true);
  });
});

describe('taskCapabilities — the post-submission lock (rule 3)', () => {
  it('freezes checklist toggles and subtasks for the assignee employee', () => {
    const caps = build('employee', true, 'submitted', false);
    expect(caps.canToggleChecklist).toBe(false);
    expect(caps.canManageSubtasks).toBe(false);
    expect(caps.canComment).toBe(true);
  });

  it('never freezes a manager — MGR edits do not retro-gate the submission', () => {
    for (const role of MANAGERS) {
      const caps = build(role, false, 'submitted', false);
      expect(caps.canToggleChecklist, role).toBe(true);
      expect(caps.canManageSubtasks, role).toBe(true);
      expect(caps.canManageChecklist, role).toBe(true);
    }
  });

  it('applies to submitted ONLY, not to the other terminal statuses', () => {
    // approved/completed/cancelled are not part of §14.3.3's lock: the guard tests
    // `status === 'submitted'` exactly, so the modal must not invent a wider lock.
    for (const status of ['approved', 'completed', 'cancelled'] as const) {
      const caps = build('employee', true, status, false);
      expect(caps.canToggleChecklist, status).toBe(true);
      expect(caps.canManageSubtasks, status).toBe(true);
    }
  });
});

describe('taskCapabilities — permission, straight from can() (rule 2)', () => {
  it('gives an assignee employee toggle + subtasks but never checklist management', () => {
    const caps = build('employee', true, 'in_progress', false);
    expect(caps).toEqual({
      canToggleChecklist: true,
      canManageChecklist: false, // MGR-only (§13.4.10)
      canManageSubtasks: true,
      canComment: true,
    });
  });

  it('gives a NON-assignee employee nothing but comments', () => {
    const caps = build('employee', false, 'in_progress', false);
    expect(caps).toEqual({
      canToggleChecklist: false,
      canManageChecklist: false,
      canManageSubtasks: false,
      canComment: true,
    });
  });

  it('gives HR nothing but comments, even on a task it somehow owns', () => {
    // §9.6 denies HR every task-edit cell; being the assignee changes nothing.
    for (const isAssignee of [true, false]) {
      const caps = build('admin_hr', isAssignee, 'in_progress', false);
      expect(caps, `assignee=${isAssignee}`).toEqual({
        canToggleChecklist: false,
        canManageChecklist: false,
        canManageSubtasks: false,
        canComment: true,
      });
    }
  });

  it('gives every manager everything on an active project, assignee or not', () => {
    for (const role of MANAGERS) {
      for (const isAssignee of [true, false]) {
        const caps = build(role, isAssignee, 'in_progress', false);
        expect(caps, `${role}/${isAssignee}`).toEqual({
          canToggleChecklist: true,
          canManageChecklist: true,
          canManageSubtasks: true,
          canComment: true,
        });
      }
    }
  });

  it('never grants an employee checklist management in ANY combination', () => {
    forEachCombo((caps, ctx) => {
      if (ctx.role !== 'employee') return;
      expect(caps.canManageChecklist, ctx.label).toBe(false);
    });
  });

  it('never grants a non-assignee employee an edit in ANY combination', () => {
    forEachCombo((caps, ctx) => {
      if (ctx.role !== 'employee' || ctx.isAssignee) return;
      expect(caps.canToggleChecklist, ctx.label).toBe(false);
      expect(caps.canManageSubtasks, ctx.label).toBe(false);
    });
  });
});

describe('taskCapabilities — unassigned tasks', () => {
  it('gives an employee no edit rights on an unassigned task', () => {
    // `assigneeId: null` must not satisfy the §9.6 `assignee` cell — an unassigned task is not
    // everyone's task. (`can()` compares against `undefined`, which never matches an id.)
    const caps = taskCapabilities({
      viewer: { id: VIEWER_ID, role: 'employee' },
      task: { status: 'planned', assigneeId: null },
      project: { status: 'active' },
    });
    expect(caps.canToggleChecklist).toBe(false);
    expect(caps.canManageSubtasks).toBe(false);
    expect(caps.canComment).toBe(true);
  });

  it('still gives a manager full rights on an unassigned task', () => {
    const caps = taskCapabilities({
      viewer: { id: VIEWER_ID, role: 'project_manager' },
      task: { status: 'planned', assigneeId: null },
      project: { status: 'active' },
    });
    expect(caps.canToggleChecklist).toBe(true);
    expect(caps.canManageSubtasks).toBe(true);
    expect(caps.canManageChecklist).toBe(true);
  });
});
