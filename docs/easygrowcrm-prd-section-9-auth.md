# §9. Authentication & Authorization

**Status:** Final. All decisions confirmed by the product owner.
**Stack:** Next.js (App Router, TypeScript) · PostgreSQL · Better Auth

---

## 9.1 Decision summary

| Decision | Choice |
|---|---|
| Auth library | **Better Auth** (self-hosted, MIT) |
| Sign-in method | **Google OAuth only.** No passwords, no magic links. |
| Identity store | **Our own Postgres.** No external identity provider holds our user records. |
| Session storage | **Database sessions**, not stateless JWTs. |
| Signup | **Disabled.** Invite-only by pre-provisioning. |
| Authorization | **Our code.** Better Auth answers *who you are*; EasyGrowCrm answers *what you may do*. |

**Rationale.** Every authorization question in EasyGrowCrm — who may review, who may approve leave, who is deactivated, who took an action in the audit log — is answered by a query against our own `user` table. Keeping identity in the same Postgres as the business data makes each of those a single query with real foreign keys, and makes deactivation instant.

---

## 9.2 Identity model — one table, no sync

Better Auth generates `user`, `session`, `account`, and `verification` tables via its CLI. We extend `user` with EasyGrowCrm's employee fields using Better Auth's `additionalFields` config, so there is **one row per person, in one table**.

> **DECIDED (Phase 1) — four reconciliations against Better Auth 1.7 as actually built:**
> 1. **Drizzle adapter, not the raw `Pool` below.** `drizzleAdapter(db, { provider: "pg" })` — so
>    **drizzle-kit is the single migration runner** and Better Auth's tables live in the same
>    schema history as everything else. Two migration systems over one database is the failure
>    mode this avoids.
> 2. **There is no Better Auth CLI in 1.7.** The auth tables are reconciled against our Drizzle
>    schema with `getAuthTables()` from `better-auth/db`, not by a generate command.
> 3. **The "deactivated" rejection lives in `session.create.before`, not `user.create.before`.**
>    `user.create.before` fires only for an email Better Auth has never seen, so a deactivated
>    user who had already signed in once would sail straight past it. See §9.3.
> 4. **`requireUser()` is named `getSessionUser()`** in this codebase (`lib/session.ts`) — the name
>    `authorize()` calls it by. The behaviour in §9.5 is unchanged.

```ts
// lib/auth.ts
import { betterAuth } from "better-auth";
// DECIDED (Phase 1): the Drizzle adapter, NOT a raw pg Pool — see the note above.
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),

  emailAndPassword: { enabled: false },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },

  user: {
    additionalFields: {
      role:        { type: "string", required: true, input: false },
      title:       { type: "string", required: false, input: false },
      department:  { type: "string", required: false, input: false },
      active:      { type: "boolean", defaultValue: true, input: false },
      joinDate:    { type: "date",    required: false, input: false },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,   // 7 days
    updateAge: 60 * 60 * 24,       // rolling refresh, once/day
  },
});
```

`input: false` on every EasyGrowCrm field is deliberate — it means **the OAuth flow can never set them.** Only our admin endpoints can. A user cannot promote themselves to `super_admin` by manipulating the sign-in payload.

**Roles** (unchanged from §2 of the PRD):

```
super_admin | team_leader | project_manager | admin_hr | employee
```

Store as a Postgres `enum`, not free text.

---

## 9.3 Sign-in flow

There is no signup. There is no invitation email, no token, no expiry.

1. `super_admin` or `admin_hr` creates the employee record in Employees, entering their **company Google email**, role, and title. The row is created with `active: true` and no linked OAuth account.
2. The person visits EasyGrowCrm and clicks **Sign in with Google**.
3. A Better Auth `before` hook runs. **DECIDED (Phase 1):** the *unknown email* check stays in
   `user.create.before`, but the ***deactivated*** check moved to **`session.create.before`** —
   `user.create.before` fires only for an email Better Auth has never seen, so a user deactivated
   *after* their first sign-in would never hit it. Checking at session creation catches every
   sign-in. (Both live in `lib/auth-guards.ts` as `guardProvisioned` / `guardActive`.)

```ts
// Reject anyone who wasn't pre-provisioned, or who has been deactivated.
databaseHooks: {
  user: {
    create: {
      before: async (user) => {
        const existing = await db.query(
          `select id, active from "user" where email = $1`, [user.email]
        );
        if (!existing.rows[0]) throw new APIError("FORBIDDEN", {
          message: "This email is not registered with EasyGrowCrm. Contact HR."
        });
        if (!existing.rows[0].active) throw new APIError("FORBIDDEN", {
          message: "This account has been deactivated."
        });
        return false; // do not create a new user; link to the existing row
      },
    },
  },
}
```

4. Google identity is linked to the existing row. Session created. Done.

**Also enforce:** reject any email whose domain is not the company domain (`hd` claim / email suffix check). Belt and braces — a rogue Gmail address should never reach step 3.

**Consequences for the PRD:**
- Delete `inviteExpiryHours` from §3.12 Settings. It no longer exists.
- Delete any "invitation email" flow. Provisioning *is* the invitation.
- MFA: not needed. Google Workspace already enforces it upstream. If Workspace doesn't have MFA on, **turn it on there** — that's where it belongs, not in EasyGrowCrm.

---

## 9.4 Deactivation & offboarding — MUST be a procedure, not a flag

The PRD currently says one line: *"Deactivated employees still appear in historical data but cannot be assigned new tasks and cannot log in."* That's not enough. Someone leaving mid-sprint has live state attached to them.

**`POST /api/employees/:id/deactivate` performs all of the following in one transaction:**

| Step | Action |
|---|---|
| 1 | `update "user" set active = false where id = $1` |
| 2 | `delete from session where user_id = $1` ← **kills every live session immediately** |
| 3 | End any `activeBreak`; close today's attendance row (auto sign-out) |
| 4 | Auto-reject any `pending` leave requests |
| 5 | **Reassignment gate** — see below |
| 6 | Write an `audit_log` row |

**Reassignment gate (step 5).** Before deactivation can complete, the UI must force the admin to resolve every open attachment:

- Tasks assigned to them that are **not** `Approved` / `Completed` / `Cancelled` → must be reassigned or cancelled.
- Tasks where they are the named **reviewer** on a `Submitted` item → must be re-routed to another manager.
- Tasks they **submitted** that are still awaiting review → left in the queue. Fine — the review can still happen; the submitter just isn't around to see it.

Show these as a checklist in the deactivation modal. **Do not allow deactivation with unresolved items.** Otherwise you get ghost assignments — a task routed to someone who no longer exists.

**System invariant:** deactivation is blocked if it would leave **fewer than two active users with a manager-level role** (`super_admin`, `team_leader`, `project_manager`). Below two, the no-self-approval rule deadlocks.

**Role change** is the same shape: transaction, audit_log row, and — because permissions are read from the DB on every request, not from the token — the new role takes effect on their very next click. No re-login needed.

---

## 9.5 Where authorization is enforced

**Not in middleware alone.** Next.js middleware-only session protection has been shown to be bypassable by spoofing internal headers (CVE-2025-29927). Middleware is a *convenience* redirect for unauthenticated visitors. It is **not** the security boundary. *(DECIDED Phase 1: the file is `proxy.ts` — Next 16.3 renamed the convention. It checks only that a session **cookie is present**, via Better Auth's `getSessionCookie`; it never calls `getSession` and never trusts the cookie's contents. The boundary is `requireRouteAccess` / `authorize()` inside every page and action.)*

**The security boundary is one function, called at the top of every server action and route handler:**

```ts
// lib/authz.ts
// DECIDED (Phase 1): named getSessionUser() in lib/session.ts — behaviour unchanged.
export async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new AppError("UNAUTHENTICATED");

  // Re-read from DB every request. Never trust the session payload for role/active.
  const user = await db.query(
    `select id, email, role, active from "user" where id = $1`,
    [session.user.id]
  );
  if (!user.rows[0]?.active) throw new AppError("DEACTIVATED");
  return user.rows[0];
}

export function can(user: User, action: Action, resource?: Resource): boolean {
  // Implements the table in §9.6. Pure function. Fully unit-testable.
}

export async function authorize(action: Action, resource?: Resource) {
  const user = await requireUser();
  if (!can(user, action, resource)) throw new AppError("FORBIDDEN");
  return user;
}
```

Every mutation begins with one line:

```ts
export async function approveTask(taskId: string, note: string) {
  const task = await getTask(taskId);
  const user = await authorize("project_task.review", task);   // ← the whole check
  // ...
}
```

**Rules (confirmed — non-negotiable):**

1. **Middleware is for login redirects only. It is never the security boundary.** The boundary is the `authorize()` call at the top of every server action and route handler. **Code-review rule: any mutation without an `authorize()` call as its first line is rejected in review.** No exceptions, including "internal-only" or "admin-only" endpoints.
2. The UI hides what you can't do. **The API refuses it.** The UI is a courtesy; the API is the rule.
3. `can()` is a pure function over `(user, action, resource)`. Every row in §9.6 becomes a unit test. This is the cheapest security investment available to you.
4. **`role` and `active` are read from the database on every request. Never from the session cookie.** The lookup is a single primary-key read on a ~50-row table — sub-millisecond. What it buys: deactivation and role changes take effect on the person's **next request**, not at token expiry up to 7 days later. For a system whose offboarding requirement is "cannot log in," a token-expiry ghost window is a bug, not an optimization. Do not cache this at launch. If caching is ever needed, the maximum acceptable is a 30–60 second in-memory TTL; anything longer violates the offboarding requirement. Put a comment in the code explaining this rule so it doesn't get "optimized" away.

---

## 9.6 The permission table

**Scoping model: OPEN.** Any manager can see every project, review any submission, and approve any leave request. There is no project-ownership restriction and no reporting-line restriction. Every decision is recorded in the audit log with the identity of the decider. (Decided; supersedes the contradictory language in PRD §2.3 and §3.1.4.)

Legend: **SA** super_admin · **TL** team_leader · **PM** project_manager · **HR** admin_hr · **EMP** employee
✅ allowed · ⛔ denied · **self** own records only · **assignee** only if assigned to them

### Employees

| Action | SA | TL | PM | HR | EMP |
|---|:--:|:--:|:--:|:--:|:--:|
| `employee.create` | ✅ | ⛔ | ⛔ | ✅ | ⛔ |
| `employee.read_all` | ✅ | ⛔ | ⛔ | ✅ | ⛔ |
| `employee.read_self` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `employee.update` | ✅ | ⛔ | ⛔ | ✅ | ⛔ |
| `employee.change_role` | ✅ | ⛔ | ⛔ | ⛔ | ⛔ |
| `employee.deactivate` | ✅ | ⛔ | ⛔ | ✅ | ⛔ |

### Projects

| Action | SA | TL | PM | HR | EMP |
|---|:--:|:--:|:--:|:--:|:--:|
| `project.create` | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| `project.read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `project.update` | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| `project.archive` | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| `project.delete` | ✅ | ⛔ | ⛔ | ⛔ | ⛔ |

### Project tasks

| Action | SA | TL | PM | HR | EMP |
|---|:--:|:--:|:--:|:--:|:--:|
| `project_task.create` | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| `project_task.read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `project_task.assign` | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| `project_task.be_assigned` | ⛔ | ✅ | ✅ | ⛔ | ✅ |
| `project_task.set_status_open` ¹ | ✅ | ✅ | ✅ | ⛔ | assignee |
| `project_task.set_status_protected` ² | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| `project_task.submit` | ✅ | ✅ | ✅ | ⛔ | assignee |
| `project_task.review` ³ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| `project_task.log_hours` | ✅ | ✅ | ✅ | ⛔ | assignee |
| `project_task.comment` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `project_task.subtask_manage` ⁷ | ✅ | ✅ | ✅ | ⛔ | assignee |
| `project_task.checklist_toggle` ⁷ | ✅ | ✅ | ✅ | ⛔ | assignee |
| `project_task.checklist_manage` ⁷ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| `project_task.edit_fields` | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| `project_task.delete` | ✅ | ✅ | ✅ | ⛔ | ⛔ |

¹ `Planned` / `In Progress` / `Blocked`
² `Approved` / `Completed` / `Cancelled` / `Revision Required`
³ **Hard constraint: `actor.id ≠ task.submitted_by`.** See §9.7.
⁷ `subtask_manage` = add / toggle / remove subtasks. `checklist_toggle` = tick/untick items; `checklist_manage` = add/delete items (managers only — the checklist is the definition-of-done, so employees may complete it but not redefine it). **All three are locked while the task is `Submitted`** (the §14.3.3 lock rule); `comment` is the only action that stays open in every status. Checklist completeness gates submission; subtasks never gate anything — informational only.

> **`project_task.be_assigned` is ⛔ for SA. This is not a typo.** The super_admin is the CEO. His role in delivery is to **assign and approve — never to execute.** He carries no delivery tasks, so nothing of his ever enters the QC queue, and the self-approval deadlock can never occur. This rule is absolute: hide super_admin from every assignee dropdown and reject the assignment at the API. There is no exception path (no "just this once," no secondary account).

### Reviews & Manager QA

| Action | SA | TL | PM | HR | EMP |
|---|:--:|:--:|:--:|:--:|:--:|
| `review.read` | ✅ | ✅ | ✅ | ✅ | own tasks |
| `review.meta_rate` ⁴ | ✅ | ✅ | ⛔ | ⛔ | ⛔ |
| `review.read_scorecard` | ✅ | ✅ | ⛔ | ⛔ | ⛔ |

⁴ **Hard constraint: `actor.id ≠ review.by`.** You cannot meta-rate your own review.

### Attendance, daily plan, EOD

| Action | SA | TL | PM | HR | EMP |
|---|:--:|:--:|:--:|:--:|:--:|
| `attendance.sign_in_out` | ✅ | ✅ | ✅ | ✅ | ✅ (self) |
| `attendance.break` | ✅ | ✅ | ✅ | ✅ | ✅ (self) |
| `attendance.read_all` | ✅ | ✅ | ✅ | ✅ | ⛔ |
| `daily_plan.read_all` | ✅ | ✅ | ✅ | ✅ | self |
| `eod_report.read_all` | ✅ | ✅ | ✅ | ✅ | self |
| `eod_report.acknowledge` ⁸ | ✅ | ✅ | ✅ | ✅ | ⛔ |

⁸ Mark-reviewed (✓) and Flag (🚩 + mandatory note) per §13.5.7 / §14.8. The EOD **content** itself is immutable for everyone including SA — acknowledgment is a separate record, never an edit.

### Leave

| Action | SA | TL | PM | HR | EMP |
|---|:--:|:--:|:--:|:--:|:--:|
| `leave.request` | ✅ | ✅ | ✅ | ✅ | ✅ (self) |
| `leave.read_all` | ✅ | ✅ | ✅ | ✅ | self |
| `leave.decide` ⁵ | ✅ | ✅ | ✅ | ✅ | ⛔ |
| `leave.reverse_decision` | ✅ | ⛔ | ⛔ | ✅ | ⛔ |

⁵ **Hard constraint: `actor.id ≠ leave.employee_id`.** No self-approved leave.

### Templates, Clients, Settings, Personal tasks, Audit log

| Action | SA | TL | PM | HR | EMP |
|---|:--:|:--:|:--:|:--:|:--:|
| `template.read` ⁹ | ✅ | ✅ | ✅ | ✅ | ⛔ |
| `template.create/update/delete` ⁹ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| `client.read` ¹⁰ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `client.create/update/archive` ¹⁰ | ✅ | ⛔ | ⛔ | ✅ | ⛔ |
| `personal_task.crud` ¹¹ | own | own | own | own | ⛔ |
| `settings.read/update` | ✅ | ⛔ | ⛔ | ✅ | ⛔ |
| `audit_log.read` | ✅ | ⛔ | ⛔ | scoped ⁶ | ⛔ |

⁶ **Decided.** `super_admin` reads the full log. `admin_hr` reads **only** rows where `resource_type IN ('leave_request', 'employee')` — enough to settle leave disputes and employee-record questions without CEO involvement. Task, review, project, settings, and authorization-failure rows remain super_admin only. Enforced as a `WHERE` clause in the audit query when the reader is `admin_hr`.

⁹ **HR may read templates**, but **template editing stays manager-only** — HR does not build delivery workflows. Note the prototype's `canEdit` includes `admin_hr`; that is a prototype deviation and the PRD wins (Amendment A / §16.16). `template.create/update/delete` covers the entire hierarchy: months, categories, tasks, and subtasks within a template (add / rename / reorder / delete at every level, per §14.4.2–§14.4.5).

¹⁰ Everyone can **read** clients (client names appear on projects, filters, and task titles that every employee sees). Create/update/archive is SA + HR only, consistent with its home in Settings (§14.14); archive is blocked with a `GATE` while the client has live projects.

¹¹ Private per-user checklist for manager-level roles + HR, matching the §14.1 route visibility. `own` = each user reads and writes only their own rows; no user — including SA — can read another's. **Documented exception: personal tasks are NOT audited** (§14.10 — personal scratchpad, no accountability value).

---

## 9.7 Cross-cutting invariants

These are enforced in the database and/or the API, never merely in the UI.

1. **No self-approval.** `task_review.reviewer_id ≠ task.submitted_by`. Add a `CHECK` constraint. This is the rule the whole QC system rests on.
2. **No self-meta-rating.** `review.meta_by ≠ review.by`.
3. **No self-leave-approval.** `leave.decided_by ≠ leave.employee_id`.
4. **super_admin is never a task assignee.** Enforced at the API; makes (1) always satisfiable.
5. **At least two active manager-level users at all times.** Blocks the deactivation that would deadlock reviews.
6. **Deactivated users** cannot log in, cannot hold a session, cannot be assigned, cannot be a named reviewer, and do not appear in any assignee/reviewer dropdown. They remain visible in historical records.
7. **Role and `active` are read from the database on every request.** Never from the session cookie. (Full rule and rationale: §9.5, rule 4.)

**Reviewer routing rule** (replaces the vague language in PRD §3.4.3):

> A submission may be reviewed by **any active user with a manager-level role, other than the submitter.** The reviewer dropdown at sign-out is a routing *hint* — it sets `reviewer_id` and drives the notification — but it does not lock the review. Any other eligible manager may still act on it.

Because super_admin never submits, and there are always ≥2 managers, **this set is never empty.** The deadlock is closed.

---

## 9.8 Audit log

Read access: `super_admin` (full log) and `admin_hr` (leave_request + employee rows only — see §9.6 ⁶). Write access: **system only** — no user-facing write endpoint exists.

```sql
create table audit_log (
  id            bigserial primary key,
  actor_id      text not null references "user"(id),
  action        text not null,          -- 'project_task.approved'
  resource_type text not null,          -- 'project_task'
  resource_id   text not null,
  before        jsonb,
  after         jsonb,
  created_at    timestamptz not null default now()
);

create index on audit_log (resource_type, resource_id);
create index on audit_log (actor_id, created_at desc);

-- Append-only. Enforced by the database, not by convention.
-- SUPERSEDED — see the DECIDED note below; the shipped migration uses a trigger, not this REVOKE:
revoke update, delete on audit_log from application_role;
```

> **DECIDED (Phase 1) — a trigger, not a role grant.** No `application_role` / `easygrowcrm_app`
> least-privilege login was created; the app connects as the owning user. Migration 003 enforces
> append-only with `audit_log_no_update_delete` (`BEFORE UPDATE OR DELETE ... FOR EACH ROW`),
> which blocks **every** role including the owner — a stronger guarantee than a REVOKE, with no
> second DB user to provision. The invariant in §9.7 is unchanged; only its mechanism is. See §11.8.

**Log every one of these:** task status changes, submissions, review decisions, meta-ratings, subtask add/toggle/remove, checklist add/toggle/delete, EOD acknowledgments and flags, leave requests, leave decisions and reversals, employee create/update/deactivate/reactivate, role changes, project create/archive/delete, client create/update/archive, template create/delete and every template-hierarchy edit (month/category/task/subtask add/rename/delete), settings changes, **audit-log views themselves** (`audit_log.viewed` — the §14.13 banner "Viewing this log is itself logged" must be literally true), and every failed authorization attempt (`403`). The last one is your intrusion signal. The one documented exception: `personal_task` rows are never audited (§9.6 ¹¹).

**Write it from inside the same transaction as the mutation.** If the business write commits and the log write doesn't, the log is a lie.

---

## 9.9 What this section closes

| PRD review issue | Status |
|---|---|
| #1 No auth architecture | ✅ Closed — §9.1–9.4 (Better Auth, Google OAuth only, invite-by-provisioning) |
| #1b No authorization model | ✅ Closed — §9.5–9.7 (`authorize()` in every server action; middleware for redirects only; role/active from DB every request) |
| #4 Self-review deadlock | ✅ Closed — CEO assigns and approves, never executes; invariants 1, 4, 5 |
| #5 Undefined project scoping | ✅ Closed — open model, §9.6 |
| #6 Audit log as a footnote | ✅ Closed — §9.8 |
| Deactivation with live state | ✅ Closed — §9.4 |
| `inviteExpiryHours` | ✅ Deleted — §9.3 |

**All previously open items are now resolved.** The `Completed` label rename, source-of-truth clause, atomic sign-out, attendance/timer model, break tracking, half-day leave, EOD changes, and removal of the scoring system are specified in **§10 Attendance, Breaks & Sign-Out** and the **PRD Amendment Log**.
