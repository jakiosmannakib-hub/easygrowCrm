// lib/authz.ts
//
// The §9.6 permission table, as data, plus the pure `can()` that reads it.
//
// Layout note: §12 sketches lib/auth/can.ts + lib/auth/authorize.ts. This project is flat
// (lib/auth.ts, lib/session.ts, lib/errors.ts, db/ at root), so everything for PUL-104 lives
// here. See CLAUDE.md "File layout".

import { userRole } from '../db/schema';
import { AppError } from './errors';
import { getSessionUser } from './session';

/** The five roles, taken from the `user_role` DB enum so the two can never drift. */
export type Role = (typeof userRole.enumValues)[number];

/** The minimum a permission decision needs to know about the actor. */
export interface User {
  id: string;
  role: Role;
  active: boolean;
}

/** The subject of a conditional cell. Omitted entirely for unconditional actions. */
export interface Resource {
  ownerId?: string;
  assigneeId?: string;
  resourceType?: string;
}

/**
 * One cell of the §9.6 table.
 *
 * `allow` / `deny` are unconditional. The rest are conditional and need a `resource`:
 * `self` and `own` compare `ownerId`, `assignee` compares `assigneeId`, and `scoped` is
 * the narrowed HR audit-log read.
 */
export type Cell = 'allow' | 'deny' | 'self' | 'assignee' | 'own' | 'scoped';

const A = 'allow';
const D = 'deny';

/**
 * Pure encoding of the §9.6 permission table. Every cell is unit-tested in
 * features/auth/authorize.test.ts. Source of truth: §9.6 — change the table there first.
 *
 * A "yes (self)" cell in §9.6 is an `allow` here: self-scoping is enforced inside the action
 * (an employee signs *themselves* in), not by the matrix. Only the bare self/assignee/own/
 * scoped markers are conditional.
 */
export const PERMISSIONS = {
  // ── Employees ────────────────────────────────────────────────────────────────
  'employee.create':      { super_admin: A, team_leader: D, project_manager: D, admin_hr: A, employee: D },
  'employee.read_all':    { super_admin: A, team_leader: D, project_manager: D, admin_hr: A, employee: D },
  'employee.read_self':   { super_admin: A, team_leader: A, project_manager: A, admin_hr: A, employee: A },
  'employee.update':      { super_admin: A, team_leader: D, project_manager: D, admin_hr: A, employee: D },
  'employee.change_role': { super_admin: A, team_leader: D, project_manager: D, admin_hr: D, employee: D },
  'employee.deactivate':  { super_admin: A, team_leader: D, project_manager: D, admin_hr: A, employee: D },
  // NOT in the §9.6 grid — §9.6 lists no reactivate row, but §13.1.5 defines the action and
  // names its audience ("Who: SA, HR"). Encoded to match `employee.deactivate` exactly, since
  // undoing an offboarding is the same authority as performing one. §9.6 needs the row added.
  'employee.reactivate':  { super_admin: A, team_leader: D, project_manager: D, admin_hr: A, employee: D },

  // ── Projects ─────────────────────────────────────────────────────────────────
  'project.create':  { super_admin: A, team_leader: A, project_manager: A, admin_hr: D, employee: D },
  'project.read':    { super_admin: A, team_leader: A, project_manager: A, admin_hr: A, employee: A },
  'project.update':  { super_admin: A, team_leader: A, project_manager: A, admin_hr: D, employee: D },
  'project.archive': { super_admin: A, team_leader: A, project_manager: A, admin_hr: D, employee: D },
  'project.delete':  { super_admin: A, team_leader: D, project_manager: D, admin_hr: D, employee: D },

  // ── Project tasks ────────────────────────────────────────────────────────────
  'project_task.create': { super_admin: A, team_leader: A, project_manager: A, admin_hr: D, employee: D },
  'project_task.read':   { super_admin: A, team_leader: A, project_manager: A, admin_hr: A, employee: A },
  'project_task.assign': { super_admin: A, team_leader: A, project_manager: A, admin_hr: D, employee: D },
  // SA is denied on purpose (§9.6): the CEO never executes work.
  'project_task.be_assigned': { super_admin: D, team_leader: A, project_manager: A, admin_hr: D, employee: A },
  'project_task.set_status_open':      { super_admin: A, team_leader: A, project_manager: A, admin_hr: D, employee: 'assignee' },
  'project_task.set_status_protected': { super_admin: A, team_leader: A, project_manager: A, admin_hr: D, employee: D },
  'project_task.submit':               { super_admin: A, team_leader: A, project_manager: A, admin_hr: D, employee: 'assignee' },
  'project_task.review':               { super_admin: A, team_leader: A, project_manager: A, admin_hr: D, employee: D },
  'project_task.log_hours':            { super_admin: A, team_leader: A, project_manager: A, admin_hr: D, employee: 'assignee' },
  'project_task.comment':              { super_admin: A, team_leader: A, project_manager: A, admin_hr: A, employee: A },
  'project_task.subtask_manage':       { super_admin: A, team_leader: A, project_manager: A, admin_hr: D, employee: 'assignee' },
  'project_task.checklist_toggle':     { super_admin: A, team_leader: A, project_manager: A, admin_hr: D, employee: 'assignee' },
  'project_task.checklist_manage':     { super_admin: A, team_leader: A, project_manager: A, admin_hr: D, employee: D },
  'project_task.edit_fields':          { super_admin: A, team_leader: A, project_manager: A, admin_hr: D, employee: D },
  'project_task.delete':               { super_admin: A, team_leader: A, project_manager: A, admin_hr: D, employee: D },

  // ── Review ───────────────────────────────────────────────────────────────────
  // EMP sees their own tasks only.
  'review.read':           { super_admin: A, team_leader: A, project_manager: A, admin_hr: A, employee: 'self' },
  'review.meta_rate':      { super_admin: A, team_leader: A, project_manager: D, admin_hr: D, employee: D },
  'review.read_scorecard': { super_admin: A, team_leader: A, project_manager: D, admin_hr: D, employee: D },

  // ── Attendance ───────────────────────────────────────────────────────────────
  // EMP "yes (self)" → allow; the action scopes it to the caller.
  'attendance.sign_in_out': { super_admin: A, team_leader: A, project_manager: A, admin_hr: A, employee: A },
  'attendance.break':       { super_admin: A, team_leader: A, project_manager: A, admin_hr: A, employee: A },
  'attendance.read_all':    { super_admin: A, team_leader: A, project_manager: A, admin_hr: A, employee: D },

  // ── Daily plan / EOD ─────────────────────────────────────────────────────────
  'daily_plan.read_all':    { super_admin: A, team_leader: A, project_manager: A, admin_hr: A, employee: 'self' },
  'eod_report.read_all':    { super_admin: A, team_leader: A, project_manager: A, admin_hr: A, employee: 'self' },
  'eod_report.acknowledge': { super_admin: A, team_leader: A, project_manager: A, admin_hr: A, employee: D },

  // ── Leave ────────────────────────────────────────────────────────────────────
  'leave.request':          { super_admin: A, team_leader: A, project_manager: A, admin_hr: A, employee: A },
  'leave.read_all':         { super_admin: A, team_leader: A, project_manager: A, admin_hr: A, employee: 'self' },
  'leave.decide':           { super_admin: A, team_leader: A, project_manager: A, admin_hr: A, employee: D },
  'leave.reverse_decision': { super_admin: A, team_leader: D, project_manager: D, admin_hr: A, employee: D },

  // ── Templates ────────────────────────────────────────────────────────────────
  'template.read':   { super_admin: A, team_leader: A, project_manager: A, admin_hr: A, employee: D },
  'template.create': { super_admin: A, team_leader: A, project_manager: A, admin_hr: D, employee: D },
  'template.update': { super_admin: A, team_leader: A, project_manager: A, admin_hr: D, employee: D },
  'template.delete': { super_admin: A, team_leader: A, project_manager: A, admin_hr: D, employee: D },

  // ── Clients ──────────────────────────────────────────────────────────────────
  'client.read':    { super_admin: A, team_leader: A, project_manager: A, admin_hr: A, employee: A },
  'client.create':  { super_admin: A, team_leader: D, project_manager: D, admin_hr: A, employee: D },
  'client.update':  { super_admin: A, team_leader: D, project_manager: D, admin_hr: A, employee: D },
  'client.archive': { super_admin: A, team_leader: D, project_manager: D, admin_hr: A, employee: D },

  // ── Personal tasks (the one audit carve-out, §9.6 note 11) ───────────────────
  'personal_task.crud': { super_admin: 'own', team_leader: 'own', project_manager: 'own', admin_hr: 'own', employee: D },

  // ── Settings / audit ─────────────────────────────────────────────────────────
  'settings.read':   { super_admin: A, team_leader: D, project_manager: D, admin_hr: A, employee: D },
  'settings.update': { super_admin: A, team_leader: D, project_manager: D, admin_hr: A, employee: D },
  // HR reads audit rows for leave_request and employee resources only.
  'audit_log.read':  { super_admin: A, team_leader: D, project_manager: D, admin_hr: 'scoped', employee: D },
} as const satisfies Record<string, Record<Role, Cell>>;

/** Every action name in the §9.6 table. */
export type Action = keyof typeof PERMISSIONS;

/** Resource types HR may read audit rows for (the `scoped` cell of `audit_log.read`). */
const HR_AUDIT_SCOPE = ['leave_request', 'employee'];

/**
 * Pure encoding of the §9.6 permission table. Every cell is unit-tested in
 * features/auth/authorize.test.ts. Source of truth: §9.6 — change the table there first.
 *
 * No DB, no I/O, no clock. A conditional cell with no `resource` fails closed.
 */
export function can(user: User, action: Action, resource?: Resource): boolean {
  const cell: Cell = PERMISSIONS[action][user.role];

  switch (cell) {
    case 'allow':
      return true;
    case 'deny':
      return false;
    case 'self':
    case 'own':
      return resource?.ownerId !== undefined && resource.ownerId === user.id;
    case 'assignee':
      return resource?.assigneeId !== undefined && resource.assigneeId === user.id;
    case 'scoped':
      return (
        action === 'audit_log.read' &&
        resource?.resourceType !== undefined &&
        HR_AUDIT_SCOPE.includes(resource.resourceType)
      );
  }
}

/**
 * The security boundary. First line of every server action / route handler (§9.5 rule 1).
 *
 * Throws UNAUTHENTICATED (no session), DEACTIVATED (inactive), or FORBIDDEN (role/resource
 * fails the §9.6 matrix). Never trust the UI — the UI hides, the API refuses (§9.5 rule 2).
 *
 * Returns the caller so actions can use it: `const user = await authorize('project.create')`.
 */
export async function authorize(action: Action, resource?: Resource): Promise<User> {
  // getSessionUser() owns the UNAUTHENTICATED and DEACTIVATED throws and re-reads role +
  // active from the DB on every request (§16.5). Not re-checked here.
  const user = await getSessionUser();

  if (!can(user, action, resource)) {
    throw new AppError('FORBIDDEN');
  }

  return user;
}
