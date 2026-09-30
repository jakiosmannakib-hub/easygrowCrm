// features/projects/capabilities.ts — PUL-407 Stage 3b
//
// What one viewer may DO to one task's child rows, as four booleans the §14.3.3 modal renders
// from. Pure: no DB, no clock, no I/O.
//
// ── This mirrors the server. It is not the gate. ─────────────────────────────────────────
// Every capability here has a server-side twin — `authorize()` plus `guardTaskChildEdit` /
// `guardProjectNotArchived` — and the server's copy is the one that decides (§9.5 r.2, §16:
// "the client displays; the server decides"). This exists so the UI can hide an affordance
// nobody may use, not so the UI can permit anything.
//
// The permission half is DERIVED from `can()` rather than re-stated: re-implementing the §9.6
// table here would be a second source of truth that drifts. Only the two LOCKS — archived
// project, and the post-submission lock — are layered on top, because they are row-state rules
// that live in the guards rather than in the permission table.
//
// ── Why this is called on the server ─────────────────────────────────────────────────────
// `lib/authz` imports `authorize()` → `lib/session` → `next/headers` and the db client, so it
// must never cross into a client bundle. `loadTaskDetail` therefore calls this and returns the
// four booleans with the task, the same way it returns `viewer` and `assignable` (Stage 3a).
// The modal consumes plain booleans and never imports authz.

import { can, type Role, type User } from '../../lib/authz';
import { isManagerRole, type TaskStatus } from './display';
import type { WorkspaceMenuFlags } from './workspace-tree';

/** Everything a capability decision needs. Deliberately the shape `getTaskDetail` already has. */
export interface CapabilityInput {
  viewer: { id: string; role: Role };
  task: { status: TaskStatus; assigneeId: string | null };
  project: { status: 'active' | 'archived' };
}

export interface TaskCapabilities {
  /** Tick/untick a checklist item — §13.4.10 `project_task.checklist_toggle`. */
  canToggleChecklist: boolean;
  /** Add/remove checklist items — §13.4.10 `project_task.checklist_manage`, MGR only. */
  canManageChecklist: boolean;
  /** Add/toggle/remove subtasks — §13.4.9 `project_task.subtask_manage`. */
  canManageSubtasks: boolean;
  /** Post a comment — §13.4.11 `project_task.comment`. */
  canComment: boolean;
}

const NOTHING: TaskCapabilities = {
  canToggleChecklist: false,
  canManageChecklist: false,
  canManageSubtasks: false,
  canComment: false,
};

/**
 * The four booleans §14.3.3's body renders from.
 *
 * The rules, in the order they apply:
 *
 *  1. **Archived project → everything false, for every role including a manager.** §13.3.4 makes
 *     an archived project read-only everywhere, and `guardProjectNotArchived` runs before the
 *     manager early-return in `guardTaskChildEdit`. It takes `canComment` down too, which is the
 *     ONE case that closes the conversation: `addComment`'s only guard is
 *     `guardProjectNotArchived`. Un-archiving is the way back.
 *
 *  2. **Permission, from `can()`**, passing the task as the resource so §9.6's conditional
 *     `assignee` cells resolve. That is what makes a non-assignee employee read-only and HR
 *     read-only on subtasks and the checklist, without any of it being restated here.
 *
 *  3. **The post-submission lock, for NON-MANAGERS only.** While a task is `submitted`, its
 *     checklist and subtasks are frozen (§14.3.3's banner). A manager is never locked by it —
 *     §13.4.9/§13.4.10: "MGR edits remain possible via the manager-override path and never
 *     retro-gate" the pending submission. `canManageChecklist` is manager-only to begin with, so
 *     the lock cannot reach it, which is why it is not subtracted there.
 *
 *  4. **Comments never lock** (§3.2.3). On a `submitted`, `approved`, `completed` or `cancelled`
 *     task the comment box stays live for anyone with read access — that is exactly what the
 *     lock banner promises ("Comments stay open"). Only rule 1 closes it.
 *
 * `active: true` is supplied to `can()` because reaching this code at all means the session
 * survived `getSessionUser()`, which throws DEACTIVATED for an inactive account. `can()` does
 * not read the flag; it is in `User` for callers that do.
 */
export function taskCapabilities({ viewer, task, project }: CapabilityInput): TaskCapabilities {
  // Rule 1 — archived binds everyone, before any per-role reasoning.
  if (project.status === 'archived') return NOTHING;

  const actor: User = { id: viewer.id, role: viewer.role, active: true };
  // §9.6's conditional `assignee` cells compare against this. `undefined` (not `null`) is what
  // `can()` treats as "no assignee to match", so an unassigned task never satisfies the cell.
  const resource = { assigneeId: task.assigneeId ?? undefined };

  // Rule 3 — the lock applies to everyone who is not manager-level. Written as "not a manager"
  // rather than "is an employee" so it fails closed for any role added later.
  const childLocked = task.status === 'submitted' && !isManagerRole(viewer.role);

  return {
    canToggleChecklist: can(actor, 'project_task.checklist_toggle', resource) && !childLocked,
    canManageChecklist: can(actor, 'project_task.checklist_manage'),
    canManageSubtasks: can(actor, 'project_task.subtask_manage', resource) && !childLocked,
    // Rule 4 — no lock term, deliberately.
    canComment: can(actor, 'project_task.comment'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// The workspace tree's ⋯ menu (PUL-417.2, §14.3 Amendment M)
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The §9.6 cells behind the tree's per-node menu, for the /projects page to hand down. Same
 * rule as `taskCapabilities`: derived from `can()`, computed on the server, display only.
 * `nodeMenuItems` (workspace-tree.ts) turns these into the items each node shows.
 */
export function workspaceMenuFlags(viewer: User): WorkspaceMenuFlags {
  return {
    clientUpdate: can(viewer, 'client.update'),
    clientArchive: can(viewer, 'client.archive'),
    accountCreate: can(viewer, 'account.create'),
    accountUpdate: can(viewer, 'account.update'),
    accountArchive: can(viewer, 'account.archive'),
    projectCreate: can(viewer, 'project.create'),
    projectUpdate: can(viewer, 'project.update'),
    projectArchive: can(viewer, 'project.archive'),
    // The wizard starts from the template list, so the viewer must be able to open it too.
    startFromTemplate: can(viewer, 'project.create') && can(viewer, 'template.read'),
  };
}
