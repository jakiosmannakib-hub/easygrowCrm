# §13. API / Server Action Contract — EasyGrowCrm

**Status:** Final.
**Purpose:** the complete list of server actions (mutations) and queries. Claude Code implements entries from this document by name — it never invents an endpoint. Every build-plan subtask references contract IDs (e.g. "implement 13.4.6 `submitTask`").

**Universal rules (apply to every mutation; not repeated per entry):**
1. Shape: **`actionResult(async () => …)` wrapping validate (Zod) → `authorize()` → `withTx` → `writeAudit(tx,…)` → commit → notify** (§12.4). *(DECIDED Phase 1, PUL-111: the five steps sit inside the `actionResult` boundary.)*
2. `authorize()` is the first statement after input parsing. Role/`active` read from DB (§9.5).
3. Audit rows are written **inside** the transaction. Notifications/webhooks are enqueued **after** commit via `webhook_outbox` / `notifications` (§12.7).
4. Soft-deleted rows (`deleted_at IS NOT NULL`) are invisible to every query and rejected as targets of every mutation.
5. All date logic uses Asia/Dhaka helpers (§12.8).
6. Errors carry typed codes: `UNAUTHENTICATED` · `DEACTIVATED` · `FORBIDDEN` · `NOT_FOUND` · `VALIDATION` (Zod) · `GATE` (business precondition failed, with a machine-readable `reason`) · `CONFLICT` (optimistic-lock/version or unique-index collision). The UI maps codes to human messages; server messages are terse and never leak other users' data. **Errors are RETURNED, not thrown across the boundary** *(DECIDED Phase 1, PUL-111: was "Errors are thrown as typed codes")*: `AppError` is still thrown inside the action body, and the `actionResult` wrapper converts it to `{ ok: false, code, reason?, message, details? }` so that `code`, `reason` and `message` all survive Next.js's production error redaction (§12.4). The code list above is unchanged. Anything that is not an `AppError` is re-thrown and reaches the client as an opaque digest.
7. Notification templates referenced as `N:<name>` are defined once in `lib/notifications/templates.ts` — text lives there, not in actions.

Actor legend: **SA** super_admin · **TL** team_leader · **PM** project_manager · **HR** admin_hr · **EMP** employee · **MGR** = SA|TL|PM · **Sys** = pg-boss job.

---

## 13.1 Employees

### 13.1.1 `createEmployee`
- **Who:** SA, HR (`employee.create`)
- **Input:** `{ email: string.email, name: string.min(1), role: user_role, title?: string, department?: string, joinDate?: date }`
- **Guards:** email unique. *(PUL-103: the "email domain = company domain" guard is **dropped**: the team signs in with personal Gmail and there is no Workspace tenant, so the OAuth gate it mirrored does not exist. The provisioned `"user"` row is itself the allowlist; see §9.3.)*
- **Tx:** insert `"user"` row (`active: true`, no OAuth account yet; provisioning *is* the invitation).
- **DEFERRED to PUL-701**: leave-balance initialization against `leave_quotas`. That table is migration 011, so there is nothing to initialize against yet. **§13.1.1's intent stands unchanged: PUL-701.2's on-add hook lands INSIDE this action's transaction, not in a second action.**
- **Audit:** `employee.created` (after = full row minus nothing sensitive; there is no sensitive data).
- **Notify:** none (the person is told out-of-band to sign in with Google).

### 13.1.2 `updateEmployee`
- **Who:** SA, HR (`employee.update`)
- **Input:** `{ userId, name?, title?, department?, joinDate? }` — **role is NOT updatable here** (see 13.1.3).
- **Audit:** `employee.updated` (before/after of changed fields).

### 13.1.3 `changeRole`
- **Who:** SA only (`employee.change_role`)
- **Input:** `{ userId, role: user_role }`
- **Guards:** target ≠ actor (SA cannot demote themselves — prevents lockout); if demoting **out of** a manager-level role, the ≥2-active-managers invariant (§9.7-5) must still hold; if the new role is `super_admin`, target must have no open task assignments (Amendment E) — `GATE:sa_has_assignments` otherwise.
- **Tx:** update role. Takes effect on target's next request (DB-read rule) — no session action needed.
- **Audit:** `employee.role_changed` (before/after role).
- **Notify:** `N:role_changed` → target.

### 13.1.4 `deactivateEmployee`
- **Who:** SA, HR (`employee.deactivate`)
- **Input:** `{ userId, reassignments: Array<{taskId, newAssigneeId | "cancel"}>, rerouted: Array<{taskId, newReviewerId}> }`
- **Guards (§9.4 — ALL checked inside the tx, atomically):**
  - target ≠ actor;
  - ≥2 active manager-level users remain after this (`GATE:last_managers`);
  - `reassignments` covers **every** open task (`status NOT IN (approved, completed, cancelled)`) assigned to target — `GATE:unresolved_assignments` listing the missing task IDs otherwise;
  - `rerouted` covers every `submitted` task whose latest submission names target as `reviewer_id` — `GATE:unresolved_reviews` otherwise;
  - new assignees/reviewers must be active and (for reviewers) manager-level and ≠ the task's submitter.
- **Tx:** apply reassignments (or set `cancelled`); apply reviewer reroutes; auto-reject target's `pending` leave (`manager_comment: "auto-rejected on deactivation"`); if an attendance row is open today → end open break, close it as `auto_closed` now; set `active=false`; `DELETE FROM session WHERE user_id=target`.
- **Audit:** one `employee.deactivated` row + one row per reassignment/reroute/leave auto-reject.
- **Notify:** `N:task_reassigned` → each new assignee; `N:review_rerouted` → each new reviewer.

> **As built (PUL-205 / PUL-206): the contract above is the target; most of the transaction is
> DEFERRED to the tickets that create the tables it touches.** The action's **shape is final**,
> including the two (currently always empty) input arrays and the blocker check, so each ticket
> below adds statements inside this transaction rather than reshaping the action.
>
> **Ships today:** target ≠ actor (`GATE:self_deactivate`); the `user_min_managers` trigger from
> migration 004 evaluated inside the `UPDATE` itself, translated to `GATE:last_managers`; the
> blocker check (`GATE:unresolved_assignments` / `GATE:unresolved_reviews`, against empty sets);
> `active=false`; `DELETE FROM session WHERE user_id=target`; the `employee.deactivated` audit row.
>
> | Deferred piece | Owning ticket | Why it cannot ship yet |
> |---|---|---|
> | Apply reassignments / cancellations, reviewer reroutes, and one audit row per row resolved | **PUL-401** | `project_tasks` is migration 008 |
> | `N:task_reassigned` / `N:review_rerouted` | **PUL-401** | nothing to announce until there are reassignments |
> | Auto-reject the target's `pending` leave (+ its audit row) | **PUL-701** | `leave_requests` is migration 011 |
> | Close today's open attendance row and any open break as `auto_closed` | **Phase 3 (attendance)** | `attendance` / `breaks` are migrations 005–006 |
>
> **Notify is therefore none in Phase 2**: §13.1.4's only notifications announce reassignments and
> reroutes, and there are none. The target is not notified of their own deactivation; they are told
> out of band and cannot sign in to read it.

### 13.1.5 `reactivateEmployee`
- **Who:** SA, HR. **Input:** `{ userId }`. **Tx:** `active=true`. **Audit:** `employee.reactivated`.

---

## 13.2 Clients

Client management lives on its own page, `/clients` (§14.12a; moved out of Settings 2026-09-30), and is SA + HR only. TL/PM open that page too, but only to manage accounts (§9.6 ¹²): they pick clients when starting projects and don't administer the client list.

### 13.2.1 `createClient` — **Who:** SA, HR (`client.create`). **Input:** `{ name, contact?, notes? }`. **Audit:** `client.created`.
### 13.2.2 `updateClient` — **Who:** SA, HR (`client.update`). **Input:** `{ clientId, name?, contact?, notes? }`. **Audit:** `client.updated`.
### 13.2.3 `archiveClient` — **Who:** SA, HR (`client.archive`). **Guards:** no non-archived projects reference it (`GATE:client_in_use`). *(Amendment M: no live **accounts** reference it; same code.)* **Tx:** soft delete. **Audit:** `client.archived`. (`client.read` is open to all roles per §9.6 ¹⁰.)

**Accounts (Amendment M).** A client's end businesses. Unlike clients, managers administer them too (§9.6 ¹²), from `/clients` (§14.12a) today and from the Projects workspace (§14.3) once PUL-417 lands.

### 13.2.4 `createAccount` — **Who:** SA, TL, PM, HR (`account.create`). **Input:** `{ clientId, name, location?, website?, notes? }`. **Guards:** client exists and is live (`NOT_FOUND`). **Audit:** `account.created`.
### 13.2.5 `updateAccount` — **Who:** SA, TL, PM, HR (`account.update`). **Input:** `{ accountId, name?, location?, website?, notes? }` (moving an account to another client is not supported). **Audit:** `account.updated` (diff only).
### 13.2.6 `archiveAccount` / `unarchiveAccount` — **Who:** SA, TL, PM, HR (`account.archive`). **Guards:** archive: no non-archived projects reference it (`GATE:account_in_use`); unarchive: its client is live (`NOT_FOUND`). **Tx:** set / clear `deleted_at`. **Audit:** `account.archived` / `account.unarchived`.

---

## 13.3 Projects & Templates

### 13.3.1 `createProject` (manual)
- **Who:** MGR (`project.create`)
- **Input:** `{ accountId, name, type, startDate, deadline? }` *(Amendment M: `accountId` replaces `clientId`; the account and its client must both be live, `NOT_FOUND` otherwise. The same swap applies to 13.3.2's input and 13.3.3's `clientId?`, which becomes `accountId?`.)*
- **Audit:** `project.created`. **Notify:** `N:project_started` → all MGR.

### 13.3.2 `createProjectFromTemplate` (the Start Project Wizard's final step)
- **Who:** MGR
- **Input:** `{ templateId, clientId, name, startDate, deadline?, assignments: Record<roleHint, userId | null>, taskOverrides?: Array<{templateTaskId, dueDate?, assigneeId?}> }` (overrides are keyed by `templateTaskId`, not position — positions are per-category and don't identify a task globally)
- **Guards:** template exists & not deleted; every named assignee is active & not SA; every `after.ref` resolves to a task in the same template, acyclic (`GATE:bad_ref`); `before_deadline` requires deadline (`GATE:no_deadline`).
- **Due-date computation (month-aware, PUL-505):** each task's dates anchor to its **month's start**: Month 1 start = `startDate`; Month k start = `startDate` + (k−1) calendar months, day-clamped (the §14.4.3 cascade). Then `day` = month start + (n−1); `after` = referenced task's computed due + 1 working day; `before_deadline` = deadline − n. `day` and `after` results skip **forward** off Fri/Sat/holidays; `before_deadline` results skip **backward** to the previous working day, never forward, so a task never lands after the deadline *(owner's ruling at PUL-505: a Friday deadline with n = 0 → the Thursday before)*.
  *As built (PUL-505, `computeDueDates` in `features/templates/due-rule-compute.ts`):* the month
  clamp uses the **real** calendar of the project's year (Jan 31, 2027 → Feb 28, 2027), unlike
  the yearless §14.4.3 cascade, which keeps February at 29. The month start is not itself
  shifted; only the final due date is. `day` 0 is treated as Day 1. The resolver returns a
  failure (`no_deadline` / `bad_ref` + the task id) and does not throw; the action maps it to the
  GATE above.
- **Tx:** insert project; **walk the hierarchy via `tplAllTasks`** (§16.7 — the only flattener) and insert one `project_tasks` row per template task with `category` = the category's name, `month` = the month's `num`, the title tokens `{{ClientName}}`, `{{AccountName}}`, `{{ProjectName}}` and `{{MonthName}}` interpolated in title; expand `checklist[]` into `task_checklist_items`; **clone each `template_task_subtasks` row into `task_subtasks` (`done=false`)**; `depends_on` resolved from `templateTaskId` refs to the new live task IDs; unmatched roles → `assignee_id NULL` (unassigned).
- **Audit:** `project.created_from_template` + one `project_task.created` per task (batched: a single audit row with `after: {taskIds: […]}` is acceptable — decide in implementation, be consistent).
- **Notify:** `N:task_assigned` → each distinct assignee (batched per person, not per task); `N:project_started` → all MGR.

> **As built (PUL-506 Stage 1), `features/projects/actions.ts`,** beside `createProject`, whose
> `requireLiveClient` / `requireAssignableUser` / `managerRecipients` it shares. Contract test:
> `features/templates/start-project.test.ts`. Where the build settles points this entry leaves
> open:
> - **Guard order**, all on the tx: client live (`NOT_FOUND`) → template live (`NOT_FOUND`) →
>   every named assignee in `assignments` *and* `taskOverrides` active & not SA
>   (`GATE:inactive_assignee` / `GATE:sa_assignee`, including a role no task uses) → every
>   override's `templateTaskId` is in the template (`VALIDATION` otherwise) → due rules
>   (`GATE:no_deadline` / `GATE:bad_ref`, with `templateTaskId` + `title` in the details).
> - **Holidays:** an empty set until the `holidays` table exists (PUL-301, Phase 3 not built),
>   so only Fri/Sat are skipped. `TODO(PUL-301)` in the action.
> - **Title tokens:** exactly four: `{{ClientName}}` (the white-label partner), `{{AccountName}}`
>   (the end business the work is for; Amendment M, PUL-415), `{{ProjectName}}` and
>   `{{MonthName}}`, where MonthName is the calendar month of the task's month start (`startDate` + (k−1) months, day-clamped): a
>   Sep 10 project's Month 2 is "October". Any other `{{…}}` is left as typed. One helper,
>   `projectTaskTitle` in `features/templates/start-project.ts`, is shared with the wizard's
>   preview.
> - **Assignment:** `assignments[roleHint.trim()]`; a role that is unmapped, mapped to `null`,
>   or absent from the task leaves it unassigned. `roleHint` is copied onto the live task.
> - **`projects.type`:** the template's `category` (§11.2's third arm), else `'Retainer'`.
>   `projects.template_id` records the template.
> - **Copied per task:** due date, priority, estimate, `qc_required`, `proof_required`,
>   `client_visible`, `sop_url`, `expected_output`. Subtasks keep the tree's `position` order.
> - **`taskOverrides` apply last:** an overridden due date does not move the tasks scheduled
>   `after` it; `assigneeId: null` unassigns that one task.
> - **Audit:** the batched form. `project.created_from_template` (the project row +
>   `taskCount`, `monthCount`) and ONE `project_task.created` row, `resource_type = 'project'`,
>   `after: { taskIds }`.
> - **`task_assigned` payload (batched):** `{ projectId, projectName, taskIds, taskCount,
>   assignedBy }`, not `createTask`'s single-task shape.
> - **Returns** `{ projectId, taskCount, monthCount }`. `monthCount` counts the months that
>   produced tasks, so a wizard template with 11 empty scaffold months reports 1.
> - All tasks go in one multi-row INSERT; `depends_on` may point later in the same statement
>   (a non-deferrable FK is checked at statement end).

### 13.3.3 `updateProject` — **Who:** MGR. **Input:** `{ projectId, name?, clientId?, startDate?, deadline? }`. **Guards:** changing `deadline` does **not** recompute existing task due dates (they were materialized at instantiation; changing them is a per-task edit). **Audit:** `project.updated`.

### 13.3.4 `archiveProject` — **Who:** MGR. **Guards:** no `submitted` tasks (`GATE:pending_reviews`). **Tx:** `status='archived'`. Archived projects: read-only everywhere, hidden from default dropdowns. **Audit:** `project.archived`. Reverse: `unarchiveProject` (same actors).

### 13.3.5 `deleteProject` — **Who:** SA only. **Guards:** same as archive. **Tx:** soft-delete project **and** its tasks. **Audit:** `project.deleted`.

### 13.3.6 Template CRUD — the hierarchy set

All **Who:** MGR (`template.create/update/delete`; HR reads only, §9.6 ⁹). All hierarchy edits are audited per §9.8. `due_rule.kind ∈ {day, before_deadline, after}` only (Amendment D); `after.ref` = a `template_task_id` in the same template, no self-ref, no cycles (`GATE:bad_ref`).

- **13.3.6a `createTemplate`** — `{ name, description?, category?, roles: string[] }`. Creates an **empty** template (no months); the UI navigates straight to detail (§14.4.1). **Audit:** `template.created`.
- **13.3.6b `updateTemplate`** — header fields + roles. **Audit:** `template.updated`.
- **13.3.6c `deleteTemplate`** — soft delete; running projects unaffected (they hold copies). **Audit:** `template.deleted`.
- **13.3.7a `createTemplateMonths`** — **the Add Month wizard's save (§14.4.3 / PUL-504): creates all 12 months in one transaction.** Input: `{ templateId, startMonth: 0..11, startDay: 1..31, month1: { cats: Array<{name, tasks: Array<{title, roleHint, priority, estHours, dueRule, qcRequired, proofRequired, checklist?, subtasks?: string[]}>} > } }`. Tx: insert Month 1 (num = next available) fully populated — categories, tasks, subtasks — then Months 2–12 as **empty scaffolds** with cascaded, day-clamped dates. **Audit:** `template.months_created` (`after: {monthIds, taskCount, subtaskCount}`).
- **13.3.7b month ops** — `renameTemplateMonth { monthId, name }` · `deleteTemplateMonth { monthId }` (cascades categories→tasks→subtasks; the §14.4.5 confirm names this). **Audit:** `template.month_renamed|month_deleted`.
- **13.3.7c category ops** — `addTemplateCategory { monthId, name }` · `renameTemplateCategory { categoryId, name }` · `deleteTemplateCategory { categoryId }` (cascades). **Audit:** `template.category_added|renamed|deleted`.
- **13.3.7d task ops** — `addTemplateTask { categoryId, …task fields, subtasks?: string[] }` · `updateTemplateTask { templateTaskId, version-free (small table), …fields, subtasks: full replacement list }` (the §14.4.4 modal saves task + subtasks in one call) · `deleteTemplateTask { templateTaskId }`. **Audit:** `template.task_added|updated|deleted`.
- **13.3.7e subtask ops** — `addTemplateSubtask { templateTaskId, title }` · `renameTemplateSubtask { subtaskId, title }` · `deleteTemplateSubtask { subtaskId }` (the inline `└ + Add subtask` affordances, §14.4.2). **Audit:** `template.subtask_added|renamed|deleted`.

> **As built (PUL-503), `features/templates/actions.ts`.** Built: 13.3.6a, 13.3.6c, 13.3.7b,
> 13.3.7c, 13.3.7d. **Not built yet:** 13.3.6b `updateTemplate`, 13.3.7a `createTemplateMonths`
> (PUL-504) and 13.3.7e (the §14.4.4 modal edits subtasks through `updateTemplateTask`'s
> replacement list instead). Where the build goes beyond the entries above:
> - **`addTemplateMonth { templateId, name?, startMonth?, startDay? }`** is NOT listed here. It
>   adds one blank month (`num` = max + 1, default name `Month {num}`, start 0 / 1), audited as
>   `template.month_added`, so a template can be built before PUL-504's wizard exists. **Needs a
>   row here, or removal once the wizard ships.**
> - **`GATE:task_has_dependents`** blocks `deleteTemplateTask`, `deleteTemplateCategory` and
>   `deleteTemplateMonth` when a task outside what is being deleted has an `after` rule pointing
>   at a task inside it. Dependents inside the deleted part do not block. Without it, a delete
>   would leave a dangling `after.ref` that only surfaces as `GATE:bad_ref` at Start Project
>   (§13.3.2).
> - **`bad_ref`** is checked in the write's transaction on `addTemplateTask` and on
>   `updateTemplateTask` when the rule changes (same template, no self-reference, no cycle).
> - **Task fields** on both task actions: `title, roleHint, priority, estHours, dueRule,
>   qcRequired, proofRequired, clientVisible, sopUrl, expectedOutput, checklist`. There is no
>   category field: a task cannot move between categories. Edits follow the PUL-203
>   partial-update convention with a diff-only audit row. *(PUL-416: `qcRequired` is
>   `z.literal(true)`, defaulting to true on add and optional on update, here and in
>   13.3.7a. `false` fails validation, and a DB CHECK backs it.)*
> - **Audit rows are keyed on the template** (`resource_type = 'template'`), each naming the
>   month / category / task it touched. Every hierarchy edit locks the template row, and a
>   soft-deleted template is NOT_FOUND for all of them.

---

## 13.4 Project Tasks

### 13.4.1 `createTask`
- **Who:** MGR (`project_task.create`)
- **Input:** `{ projectId, title, category, month?, description?, assigneeId?, dueDate?, priority?, estimatedHours?, expectedOutput?, sopUrl?, qcRequired?, proofRequired?, clientVisible?, dependsOn?, checklist?: string[] }`
- **Guards:** project active; assignee active & not SA (trigger backs this); `dependsOn` in same project, no cycle. *(PUL-416, Amendment M: `qcRequired` accepts only `true` or omitted; `false` is a `VALIDATION` failure, backed by the `project_tasks_qc_required_check` CHECK. Review is mandatory.)*
- **Audit:** `project_task.created`. **Notify:** `N:task_assigned` → assignee if set.

### 13.4.2 `updateTaskFields`
- **Who:** MGR (`project_task.edit_fields`)
- **Input:** `{ taskId, version, …any 13.4.1 fields }`
- **Guards:** optimistic lock on `version` (`CONFLICT` on mismatch). Editing checklist/subtasks while `submitted` is allowed for MGR (PRD §4.3 "managers can override anything") — but doing so does **not** re-open the submission.
- **Audit:** `project_task.updated` (changed fields only).

### 13.4.3 `assignTask`
- **Who:** MGR (`project_task.assign`)
- **Input:** `{ taskId, assigneeId | null }` (null = unassign)
- **Guards:** assignee active, not SA. **Decision recorded:** there is **no employee self-claim flow** — unassigned tasks are assigned by managers from the Board's "Unassigned" group. (If self-claim is ever wanted, it's a new contract entry, not a widening of this one.)
- **Audit:** `project_task.assigned`. **Notify:** `N:task_assigned` → new assignee.

### 13.4.4 `changeTaskStatusOpen` (the employee-reachable pill statuses)
- **Who:** MGR anywhere; EMP only if assignee (`project_task.set_status_open`)
- **Input:** `{ taskId, version, status: planned|in_progress|blocked }`
- **Guards:** current status must be an open status (`planned|in_progress|blocked|revision_required`); locked states (`submitted|approved|completed|cancelled`) are not exitable here (`GATE:locked`); `revision_required → planned/in_progress` allowed (getting back to work).
- **Audit:** `project_task.status_changed`.

### 13.4.5 `setTaskStatusProtected` (manager overrides)
- **Who:** MGR (`project_task.set_status_protected`)
> **Amendment M: the `completed` bypass is removed.** `status: completed` is refused for every
> role with `GATE:use_review`, the same refusal as a direct `approved`. The only way to close a
> task is a manager approving its submission through `reviewTask` (13.4.7). The text below is
> kept for history; where it describes `completed` as allowed, this note wins.

- **Input:** `{ taskId, version, status: approved|completed|cancelled|revision_required, note?: string }`
- **Guards:** `completed` from any non-terminal state = the QC-bypass override (PRD §4.2) — allowed, that's its purpose; `cancelled` from `submitted` also resolves the open submission (it will simply never receive a review — the queue query excludes non-`submitted` tasks so it disappears cleanly); direct `revision_required` requires `note` (`GATE:note_required`); direct `approved` outside `reviewTask` is **not allowed** — approving a submitted task must go through 13.4.7 so the review row exists (`GATE:use_review`).
- **Audit:** `project_task.status_overridden` (records the bypass explicitly — this is the "silent QC bypass" made loud).
- **Notify:** `N:task_status_changed` → assignee.

### 13.4.6 `submitTask` ("Done — send to review" and the Submit modal are both this)
- **Who:** assignee, or MGR submitting their own assigned task (`project_task.submit`)
- **Input:** `{ taskId, version, summary: string.min(1), hours?: number, issues?: string, proofType?: proof_type, proofValue?: string, reviewerId?: userId }`
- **Guards (PRD §4.3, in order — each failure is `GATE:<name>`):**
  - `status ∈ {planned, in_progress, revision_required}` (`GATE:bad_state`)
  - dependency satisfied: `depends_on` is null or that task ∈ {approved, completed} (`GATE:dependency`)
  - all checklist items done (`GATE:checklist`)
  - `proofValue` present if `proof_required` (`GATE:proof`)
  - `reviewerId`, if given: active, manager-level, ≠ actor (`GATE:bad_reviewer`); if omitted, default = active manager-level user (≠ actor) with the fewest open `submitted` items routed to them.
- **Tx:** insert `task_submissions`; task → `submitted`; version bump.
- **Audit:** `project_task.submitted`.
- **Notify:** `N:task_submitted` → reviewer; webhook.

### 13.4.7 `reviewTask` (Approve / Request Revision — one action, two decisions)
- **Who:** any active MGR ≠ submitter (`project_task.review`; §9.7-1)
- **Input:** `{ taskId, version, decision: approved|revision_requested, note?: string, rating?: 1..5 }`
- **Guards:** task `submitted` with a latest submission (`GATE:no_submission`); `note` required when `revision_requested` (`GATE:note_required`); DB constraints back the self-review ban; the `one_review_per_submission` unique index turns a simultaneous second reviewer into `CONFLICT` — surface as "already reviewed by X just now".
- **Tx:** insert `task_reviews` (submitter copied from submission); task → `approved` (+`quality_rating`) or `revision_required` (+`revision_note = note`); version bump. **No spawn logic exists** (Amendment D) — `approved` is terminal.
- **Audit:** `project_task.approved` | `project_task.revision_requested`.
- **Notify:** `N:task_approved` | `N:task_revision` (includes note) → submitter; webhook.

### 13.4.8 `metaRateReview`
- **Who:** SA, TL (`review.meta_rate`)
- **Input:** `{ reviewId, metaRating: 1..5 }`
- **Guards:** actor ≠ review's reviewer (DB constraint `no_self_meta_rating` backs it); overwriting an existing meta-rating is allowed (latest wins) and audited.
- **Audit:** `review.meta_rated` (before/after).

### 13.4.9 `addSubtask` / `toggleSubtask` / `deleteSubtask`
- **Who:** assignee or MGR (`project_task.subtask_manage`, §9.6 ⁷ — v1's "anyone with read access" conflicted with the permission table; HR and non-assignee EMPs are ⛔).
- **Guards:** **locked for the assignee while `submitted`** (§14.3.3 lock); MGR edits remain possible via the manager-override path (13.4.2) and never retro-gate. Subtasks **never** gate submission — informational only (§9.6 ⁷).
- **Audit:** `project_task.subtask_added|toggled|removed` (audited, like checklist events).

### 13.4.10 `toggleChecklistItem` / `addChecklistItem` / `deleteChecklistItem`
- **Who:** toggle = assignee or MGR (`project_task.checklist_toggle`); add/delete = MGR only (`project_task.checklist_manage`, §9.6 ⁷ — the checklist is the definition-of-done; employees complete it, managers define it).
- **Guards:** post-submission lock for EMP; MGR items added after submission do **not** retro-gate the already-made submission.
- **Audit:** `project_task.checklist_toggled` for toggles and `project_task.checklist_edited` for add/delete.

### 13.4.11 `addComment`
- **Who:** anyone with read access (`project_task.comment`) — comments never lock (PRD §3.2.3). **Input:** `{ taskId, body: string.min(1) }`. **Audit:** none. **Notify:** `N:task_comment` → assignee + task's latest submitter/reviewer if ≠ author.

### 13.4.12 `logActualHours`
- **Who:** assignee or MGR (`project_task.log_hours`). **Input:** `{ taskId, version, actualHours: number ≥ 0 }`. **Guards:** post-submission lock for EMP. **Audit:** `project_task.hours_logged` (before/after — this feeds reporting; it's accountability-bearing).

---

## 13.5 Attendance (§10)

### 13.5.1 `signIn`
- **Who:** any active user, self only (`attendance.sign_in_out`)
- **Input:** `{ workType: work_type, plan: Array<{title, clientId?, category?, priority?, estimatedHours?, expectedOutput?, projectTaskId?}> }` — the modal pre-fills `plan` from assigned tasks due today with `status ∈ {planned, in_progress, revision_required}` (§10.2); user may add/remove rows.
- **Guards:** no attendance row for (me, today) — unique constraint backs it (`CONFLICT` → "already signed in"); linked `projectTaskId`s must be assigned to me.
- **Tx:** insert `attendance` (late = local time > `settings.grace_in`); insert `daily_tasks`; linked project tasks with status `planned` → `in_progress` (others untouched, §10.2).
- **Audit:** `attendance.signed_in`.
- **Notify:** `N:signed_in_late` → HR only if late; webhook.

### 13.5.2 `startBreak`
- **Who:** self, signed in, no open break (`one_open_break` index backs it → `CONFLICT`)
- **Input:** `{ type: break_type }`
- **Tx:** insert `attendance_breaks` (open). **Audit:** none (break totals are the record; per-break start/stop audit is noise). **Notify:** none.

### 13.5.3 `endBreak`
- **Who:** self. **Guards:** an open break exists (`GATE:no_open_break`). **Tx:** close break, set `minutes`, add to `attendance.break_minutes`. **Audit/Notify:** none.

### 13.5.4 `signOut` — **the atomic one (§10.5)**
- **Who:** self (`attendance.sign_in_out`)
- **Input:** `{ taskUpdates: Array<{dailyTaskId, status: daily_task_status, actualHours?, proofType?, proofValue?, submit?: {summary, hours?, issues?, proofType?, proofValue?, reviewerId?}}>, explanation?: string, blockers?, issues?, tomorrow?, remarks? }`
- **Guards:**
  - open attendance row exists (`GATE:not_signed_in`);
  - **net minutes ≥ `work_target_min`**, or ≥ `half_target_min` with an approved half-day leave for today (`GATE:target_not_met`, returns remaining minutes) — server-computed, never client-supplied;
  - `explanation` required if any planned task is not `done` (`GATE:explanation_required`, PRD §7.2's surviving rule);
  - every `submit` payload passes all 13.4.6 gates (dependency/checklist/proof/reviewer) — first failure aborts the whole sign-out with the task named.
- **Tx (all or nothing):** close open break if any → set `sign_out_at`, `sign_out_type` (`normal` or `half_day`), finalize `net_minutes` → apply `daily_tasks` updates → for each `submit`: full 13.4.6 insert+status change → insert `eod_reports` (unique per day backs double-sign-out → `CONFLICT`) → audit rows.
- **Audit:** `attendance.signed_out` + one `project_task.submitted` per submission.
- **Notify (after commit):** `N:task_submitted` per submission → reviewers; `N:eod_submitted` → MGR digest; webhook.

### 13.5.5 `earlySignOut`
- Same as 13.5.4 with: **Input** adds `{ reason: string.min(1) }`; the net-minutes gate is **skipped**; `sign_out_type='early'`, `early_reason` stored.
- **Audit:** `attendance.signed_out_early` (reason in `after`). **Notify:** `N:early_signout` (with reason) → all MGR; webhook. *(This is the escape hatch — always available, loudly flagged.)*

### 13.5.6 `Sys: attendance.auto-close` (pg-boss, every 5 min — §12.7)
- Finds open rows ≥ 10h since sign-in → close open break → `sign_out_type='auto_closed'`, `net_minutes` capped at shift end → **no** EOD report is fabricated (the absence of one is itself the signal). **Audit:** `attendance.auto_closed` (actor = a reserved system user `u_system` — `audit_log.actor_id` is a FK to `"user"`, so `u_system` must exist as a seeded, `active=false`, non-assignable row, seeded in migration 004 alongside the user-hardening work, PUL-201). **Notify:** `N:auto_closed` → the employee + HR.

### 13.5.7 `acknowledgeEodReport`
- **Who:** MGR, ≠ report owner (`no_self_ack` constraint backs it)
- **Input:** `{ reportId, flagged?: boolean, managerNote?: string }`
- **Tx:** set `reviewed_at=now(), reviewed_by=actor`, plus flag/note. Re-acknowledgment allowed (latest wins), audited.
- **Audit:** `eod_report.acknowledged` (records flag + note). **Notify:** `N:eod_flagged` → report owner **only if** `flagged` (a quiet read stays quiet).

### 13.5.8 `addDailyTask` / `updateDailyTaskStatus`
- **Who:** self, while signed in (before sign-out). Ad-hoc rows added mid-day; status/pill changes on the plan during the day. Linked rows keep project-task sync one-directional here: mid-day daily-status changes do **not** mutate the project task (project statuses move via 13.4.4/13.4.6 only; sign-out is where daily outcomes get applied). **Audit:** none.

---

## 13.6 Leave

### 13.6.1 `requestLeave`
- **Who:** self (`leave.request`)
- **Input:** `{ type: leave_type, startDate, endDate, halfSelection?: half_selection, reason: string.min(1) }`
- **Guards:** `half_day` ⇒ single date + `halfSelection` (DB constraint backs it); dates not in the past (today allowed — emergencies); no overlap with an existing `pending|approved` leave (`GATE:overlap`); `days` computed server-side = working days (Sun–Thu) minus `holidays`, × 0.5 for half-day; quoted types: computed remaining balance must cover `days` (`GATE:quota_exceeded`, returns balance) — unquoted types skip this.
- **Audit:** `leave.requested`. **Notify:** `N:leave_requested` → all MGR + HR; webhook.

### 13.6.2 `cancelLeaveRequest` — **Who:** requester, while `pending` only (`GATE:not_pending`). **Tx:** delete row (a never-decided request has no audit value beyond the log). **Audit:** `leave.cancelled_by_requester`.

### 13.6.3 `decideLeave`
- **Who:** any MGR or HR, ≠ requester (`leave.decide`; §9.7-3, DB-backed)
- **Input:** `{ leaveId, decision: approved|rejected, managerComment?: string }`
- **Guards:** status `pending` (`GATE:already_decided` — also protects two simultaneous deciders: the `decision_complete` constraint + status check inside the tx make the second decider fail cleanly).
- **Tx:** set status/decided_by/decided_at/comment.
- **Audit:** `leave.approved|leave.rejected`. **Notify:** `N:leave_decided` → requester; webhook. Approved `half_day` needs no further action — 13.5.4 reads it live when computing the target.

### 13.6.4 `reverseLeaveDecision`
- **Who:** SA, HR (`leave.reverse_decision`)
- **Input:** `{ leaveId, newStatus: approved|rejected, managerComment: string.min(1) }` (comment mandatory — a reversal always explains itself)
- **Guards:** status is decided (`GATE:not_decided`); if reversing an approval whose dates are in the past → allowed but audited as retroactive.
- **Tx:** set status, `reversed_by`, `reversed_at`, append comment.
- **Audit:** `leave.reversed` (before/after status + who originally decided). **Notify:** `N:leave_reversed` → requester + original decider.

---

## 13.7 Notifications, Settings, Holidays

### 13.7.1 `markNotificationRead` — **Who:** recipient only. `{ notificationId | "all" }`. No audit.
### 13.7.2 `updateSettings` — **Who:** SA, HR (`settings.update`). **Input:** partial of the settings row; times validated (`shift_end` > `shift_start`, targets sane). **Audit:** `settings.updated` (before/after — settings changes are high-value audit rows).
### 13.7.3 `upsertHoliday` / `deleteHoliday` — **Who:** SA, HR. `{ date, name }`. **Audit:** `holiday.upserted|deleted`.

---

## 13.8 Queries (reads)

Reads go through `queries.ts` per feature; every query calls `requireUser()` and applies role scope from §9.6. No audit rows for reads **except** `audit_log` reads themselves (`audit.viewed`, so viewing the log is in the log). Key queries and their scope notes:

| Query | Scope |
|---|---|
| `getDashboard` | role-branched: EMP = own day/tasks/notifs; MGR = agency KPIs, attendance snapshot, overdue submissions |
| `getProjects / getProjectBoard / getProjectList / getProjectCalendar` | all roles read all active projects (open model); archived visible via explicit filter |
| `getReviewQueue` | **one canonical query** (Amendment F): `status='submitted'`, optional filters `{projectId?, routedToMe?}` — the standalone Review page, the project Review tab, and the dashboard card all call this |
| `getTaskDetail` | full task + subtasks + checklist + comments + submissions + reviews |
| `getManagerQaScorecard` | SA, TL only — aggregates `task_reviews` by reviewer (count, revisions, avg rating given, avg meta received) + review log |
| `getAttendanceToday / getAttendanceHistory` | self for EMP; all for MGR+HR; history paginated server-side, filters `{employeeId?, from, to, flaggedOnly?}` |
| `getMyTimer` | server-computed `{netMinutes, breakMinutesToday, target, state}` — polled by the dashboard timer; client renders, never computes |
| `getEodReports` | self for EMP; all for MGR+HR; `{unreviewedOnly?}` uses the partial index |
| `getLeave / getLeaveBalances` | self for EMP; all for MGR+HR; balances computed live from approvals + quotas + holidays |
| `getEmployees` | SA/HR full; MGR gets the minimal active-user directory needed for assignee/reviewer dropdowns (id, name, title, role — nothing else) |
| `getTemplates / getTemplate` | MGR + HR (§9.6 ⁹: HR reads templates; edit stays MGR) |
| `getClients` | all roles (`client.read`, §9.6 ¹⁰) — feeds the filter bar and Start Project wizard |
| `getWorkspaceTree` | all roles (`account.read` / `project_task.read`) — Amendment M: live clients → live accounts → active projects, each project with open / awaiting-review / done / total task counts. Feeds the §14.3 workspace tree and the client and account overviews. One read, nested, never a flat list. **As built (PUL-417):** `getWorkspaceTree({ includeArchived? })` in `features/projects/queries.ts`. A fixed two queries at any size (the session read, then one select with a grouped task-count subquery). Each project node also carries `overdueTaskCount` (open tasks due before today in Asia/Dhaka, the §3.1.3 count the header uses, so the overviews can show health) and `startDate` (for Month ▾ labels), plus `awaitingReview` as a boolean for the tree's dot. Clients with no accounts and accounts with no projects are returned. `includeArchived` adds archived clients, accounts and projects, each flagged `archived`; soft-deleted projects never appear. Requires an authenticated, active session and fails closed with `FORBIDDEN` if either permission cell is tightened; no per-role row filter |
| `getDailyPlan` | self for EMP; any employee + date for MGR/HR (§14.7) |
| `getWorkload` | MGR + HR — per-person open task count + est hours + on-break dot (§14.3.6); dependency-blocked counts as open |
| `previewLeave` | self — server-computed `{days, remaining}` for the live modal preview (PUL-703.2); **same function** as 13.6.1's computation, so preview and submission can never disagree |
| `getAuditLog` | SA all; HR auto-scoped `resource_type IN ('leave_request','employee')` (§9.6 ⁶); filters `{actorId?, resourceType?, resourceId?, from?, to?}`; paginated; **read is audited** |
| `getNotifications` | recipient only |
| `exportClientTasks (weekly/monthly)` | MGR; server-side XLSX (§12); client-safe rules from PRD §3.1.7 (only completed/approved/in-progress; `approved` relabeled "Completed" for the client; proof link only, no internal fields). **As built (PUL-413):** `GET /api/export/client-tasks?period=weekly\|monthly`, a route handler because the response is a file. It returns plain HTTP (400 bad period / 403 not a manager / `{empty:true}` for zero rows), not `ActionResult`. Reads via `getClientExportRows({from,to})`; the window is `dhakaToday()−6` or `−29` through today, inclusive. **Gap:** §9.6 has no export row, so the gate is `isManagerRole` on the DB-read role until §9.6 adds one (§17 PUL-413). **Amendment M (PUL-418):** scoped, exactly one of `?clientId=` / `?accountId=` required (400 otherwise; 404 for an unknown or archived scope). A client export has a summary sheet plus one sheet per account; an account export has one sheet. Rows gain the account name; still no internal fields. **As built (PUL-418):** refusals run 400 (bad period, neither or both ids), then 403, then 404, so a non-manager cannot probe which ids exist; an account under an archived client is also 404. Reads via `getClientExportRows(range, scope)`, joined through accounts and ordered by account; tasks under an archived account are excluded. Every sheet opens with the report title, the client or account name and the period (`Sep 9, 2026 - Sep 15, 2026`). White-label: no agency name in any cell, sheet name, the filename (`<slug>-<weekly\|monthly>-report-<today>.xlsx`) or the document properties (creator, company and last-modified-by blank; title = the scope name). A task with no time logged gets an empty cell. Handler: `features/projects/client-export-response.ts`; the buttons sit in the client and account overviews |
| `exportAttendance` | MGR/HR; server-side XLSX |

---

## 13.9 Notification template registry (referenced above)

`task_assigned` · `task_submitted` · `task_approved` · `task_revision` · `task_status_changed` · `task_comment` · `review_rerouted` · `task_reassigned` · `project_started` · `signed_in_late` · `early_signout` · `auto_closed` · `eod_submitted` · `eod_flagged` · `leave_requested` · `leave_decided` · `leave_reversed` · `role_changed`

Every template renders (a) an in-app `notifications` row per recipient and (b) one `webhook_outbox` payload (§8.14 rule: all notifications mirror to the webhook; per-user preferences are a later addition, filtered at render not at source).

> **DECIDED (Phase 1) — delivery is Discord + email, and the `notify()` interface is fixed.**
> The outbox payload is delivered to a **Discord** webhook (not Slack) and to **email** as a second
> channel (adapter TBD in PUL-801). Both ride the same `webhook_outbox` + Render worker mechanism.
> The 18 template names above are the `NotificationType` union in `lib/notifications.ts`, and the
> port's signature — `notify({ to, type, data? })` — is **unchanged** by the delivery decision: a
> caller names a template and supplies its payload; the template owns the copy, per channel.

---

## 13.10 Coverage check

Every §9.6 permission row (including `subtask_manage`, `checklist_toggle/manage`, `eod_report.acknowledge`, `client.*`, `personal_task.crud`) maps to at least one entry above; every §10 flow (sign-in, breaks, green unlock, normal/early/half-day/auto-close exits, EOD acknowledge) has its action; every §11 table — including the five template-hierarchy tables — has the actions that write it. Actions deliberately **not** in this contract, so nobody "helpfully" adds them: employee self-claim of unassigned tasks (13.4.3), recurring spawn (Amendment D), EOD approve/revise (§11.10-2), EOD content edit (immutable, §11.6), any selfie/location capture (Amendment C), any score computation (Amendment H).

**Cross-reference alias:** other documents occasionally cite "the 13.4.5 submission gates" — the submit action is **13.4.6** and review is **13.4.7**; 13.4.5 is the manager status override. When in doubt, the action *names* (`submitTask`, `reviewTask`) are the stable identifiers, not the numbers.

*(`personal_task.crud` is deliberately contract-light: plain owner-scoped CRUD, no audit (§9.6 ¹¹), no gates — implemented in `features/my-tasks/actions.ts` with `authorize()` like everything else.)*
