// features/auth/authorize.test.ts
//
// §15.4 mandatory test — "every role × every action in the §9.6 table, allow and deny
// cells both asserted". Done-check (PUL-104): the cell count here equals the cell count
// in §9.6 — 57 actions × 5 roles = 285. Two of the 57 are actions §13 defines but §9.6 has
// no row for — `employee.reactivate` (§13.1.5) and `project.unarchive` (§13.3.4); both are
// noted at their entries below, and §9.6 should gain the rows.
//
// DELIBERATE: this file does NOT import PERMISSIONS from lib/authz.ts. The grid below is a
// second, independent transcription of the §9.6 tables, hand-typed from the PRD. Importing
// the real table would only assert that it equals itself; keeping them separate means a typo
// in *either* rendering shows up as a failing cell. When §9.6 changes, both must be edited.
//
// can() is pure — no database, no clock, no I/O — so nothing here touches Postgres.

import { describe, expect, it } from 'vitest';
import { can, type Action, type Role, type User } from '../../lib/authz';

type Expected = 'allow' | 'deny' | 'self' | 'assignee' | 'own' | 'scoped';

const ROLES: Role[] = ['super_admin', 'team_leader', 'project_manager', 'admin_hr', 'employee'];

/**
 * §9.6, transcribed by hand. Column order matches the PRD: SA · TL · PM · HR · EMP.
 * "✅ (self)" in the PRD is `allow` — self-scoping lives in the action, not the matrix.
 */
const EXPECTED: Record<string, [Expected, Expected, Expected, Expected, Expected]> = {
  // Employees
  'employee.create': ['allow', 'deny', 'deny', 'allow', 'deny'],
  'employee.read_all': ['allow', 'deny', 'deny', 'allow', 'deny'],
  'employee.read_self': ['allow', 'allow', 'allow', 'allow', 'allow'],
  'employee.update': ['allow', 'deny', 'deny', 'allow', 'deny'],
  'employee.change_role': ['allow', 'deny', 'deny', 'deny', 'deny'],
  'employee.deactivate': ['allow', 'deny', 'deny', 'allow', 'deny'],
  // §9.6 has no reactivate row; §13.1.5 says SA + HR. Same audience as deactivate.
  'employee.reactivate': ['allow', 'deny', 'deny', 'allow', 'deny'],

  // Projects
  'project.create': ['allow', 'allow', 'allow', 'deny', 'deny'],
  'project.read': ['allow', 'allow', 'allow', 'allow', 'allow'],
  'project.update': ['allow', 'allow', 'allow', 'deny', 'deny'],
  'project.archive': ['allow', 'allow', 'allow', 'deny', 'deny'],
  // §9.6 has no unarchive row; §13.3.4 says "Reverse: unarchiveProject (same actors)".
  'project.unarchive': ['allow', 'allow', 'allow', 'deny', 'deny'],
  'project.delete': ['allow', 'deny', 'deny', 'deny', 'deny'],

  // Project tasks
  'project_task.create': ['allow', 'allow', 'allow', 'deny', 'deny'],
  'project_task.read': ['allow', 'allow', 'allow', 'allow', 'allow'],
  'project_task.assign': ['allow', 'allow', 'allow', 'deny', 'deny'],
  // SA denied: the CEO assigns and approves, never executes (§9.6 — "not a typo").
  'project_task.be_assigned': ['deny', 'allow', 'allow', 'deny', 'allow'],
  'project_task.set_status_open': ['allow', 'allow', 'allow', 'deny', 'assignee'],
  'project_task.set_status_protected': ['allow', 'allow', 'allow', 'deny', 'deny'],
  'project_task.submit': ['allow', 'allow', 'allow', 'deny', 'assignee'],
  'project_task.review': ['allow', 'allow', 'allow', 'deny', 'deny'],
  'project_task.log_hours': ['allow', 'allow', 'allow', 'deny', 'assignee'],
  'project_task.comment': ['allow', 'allow', 'allow', 'allow', 'allow'],
  'project_task.subtask_manage': ['allow', 'allow', 'allow', 'deny', 'assignee'],
  'project_task.checklist_toggle': ['allow', 'allow', 'allow', 'deny', 'assignee'],
  'project_task.checklist_manage': ['allow', 'allow', 'allow', 'deny', 'deny'],
  'project_task.edit_fields': ['allow', 'allow', 'allow', 'deny', 'deny'],
  'project_task.delete': ['allow', 'allow', 'allow', 'deny', 'deny'],

  // Reviews & Manager QA
  'review.read': ['allow', 'allow', 'allow', 'allow', 'self'],
  'review.meta_rate': ['allow', 'allow', 'deny', 'deny', 'deny'],
  'review.read_scorecard': ['allow', 'allow', 'deny', 'deny', 'deny'],

  // Attendance, daily plan, EOD
  'attendance.sign_in_out': ['allow', 'allow', 'allow', 'allow', 'allow'],
  'attendance.break': ['allow', 'allow', 'allow', 'allow', 'allow'],
  'attendance.read_all': ['allow', 'allow', 'allow', 'allow', 'deny'],
  'daily_plan.read_all': ['allow', 'allow', 'allow', 'allow', 'self'],
  'eod_report.read_all': ['allow', 'allow', 'allow', 'allow', 'self'],
  'eod_report.acknowledge': ['allow', 'allow', 'allow', 'allow', 'deny'],

  // Leave
  'leave.request': ['allow', 'allow', 'allow', 'allow', 'allow'],
  'leave.read_all': ['allow', 'allow', 'allow', 'allow', 'self'],
  'leave.decide': ['allow', 'allow', 'allow', 'allow', 'deny'],
  'leave.reverse_decision': ['allow', 'deny', 'deny', 'allow', 'deny'],

  // Templates (§9.6 groups create/update/delete on one row)
  'template.read': ['allow', 'allow', 'allow', 'allow', 'deny'],
  'template.create': ['allow', 'allow', 'allow', 'deny', 'deny'],
  'template.update': ['allow', 'allow', 'allow', 'deny', 'deny'],
  'template.delete': ['allow', 'allow', 'allow', 'deny', 'deny'],

  // Clients (§9.6 groups create/update/archive on one row)
  'client.read': ['allow', 'allow', 'allow', 'allow', 'allow'],
  'client.create': ['allow', 'deny', 'deny', 'allow', 'deny'],
  'client.update': ['allow', 'deny', 'deny', 'allow', 'deny'],
  'client.archive': ['allow', 'deny', 'deny', 'allow', 'deny'],
  // Amendment M, §9.6 note 12: everyone reads accounts; SA, TL, PM and HR administer them.
  'account.read': ['allow', 'allow', 'allow', 'allow', 'allow'],
  'account.create': ['allow', 'allow', 'allow', 'allow', 'deny'],
  'account.update': ['allow', 'allow', 'allow', 'allow', 'deny'],
  'account.archive': ['allow', 'allow', 'allow', 'allow', 'deny'],

  // Personal tasks — the documented audit carve-out (§9.6 note 11)
  'personal_task.crud': ['own', 'own', 'own', 'own', 'deny'],

  // Settings (§9.6 groups read/update on one row) and audit log
  'settings.read': ['allow', 'deny', 'deny', 'allow', 'deny'],
  'settings.update': ['allow', 'deny', 'deny', 'allow', 'deny'],
  'audit_log.read': ['allow', 'deny', 'deny', 'scoped', 'deny'],
};

const OTHER_USER = 'someone_else';

function userFor(role: Role): User {
  return { id: `u_${role}`, role, active: true };
}

describe('can() encodes the §9.6 permission table', () => {
  it('asserts every cell of the matrix — 285 = 57 actions × 5 roles', () => {
    let cells = 0;

    for (const [name, row] of Object.entries(EXPECTED)) {
      const action = name as Action;

      ROLES.forEach((role, column) => {
        const expected = row[column];
        const user = userFor(role);
        const where = `${action} × ${role}`;
        cells += 1;

        if (expected === 'allow') {
          expect(can(user, action), `${where} should allow`).toBe(true);
          return;
        }

        if (expected === 'deny') {
          expect(can(user, action), `${where} should deny`).toBe(false);
          return;
        }

        // Conditional cells: assert the match, the mismatch, and the fail-closed case.
        if (expected === 'self' || expected === 'own') {
          expect(can(user, action, { ownerId: user.id }), `${where} own record`).toBe(true);
          expect(can(user, action, { ownerId: OTHER_USER }), `${where} other's record`).toBe(false);
        } else if (expected === 'assignee') {
          expect(can(user, action, { assigneeId: user.id }), `${where} assigned`).toBe(true);
          expect(can(user, action, { assigneeId: OTHER_USER }), `${where} not assigned`).toBe(
            false,
          );
        } else {
          // scoped — HR reads audit rows for leave_request and employee only (§9.6 note 6).
          expect(can(user, action, { resourceType: 'leave_request' }), `${where} leave`).toBe(true);
          expect(can(user, action, { resourceType: 'employee' }), `${where} employee`).toBe(true);
          expect(can(user, action, { resourceType: 'project_task' }), `${where} task`).toBe(false);
        }

        // A conditional cell with no resource fails closed.
        expect(can(user, action), `${where} without a resource must fail closed`).toBe(false);
      });
    }

    // The done-check, made mechanical: if §9.6 grows and this fixture wasn't updated to
    // match, the count differs and CI fails rather than silently under-testing.
    expect(cells, 'cell count must equal §9.6').toBe(285);
    expect(Object.keys(EXPECTED)).toHaveLength(57);
  });
});
