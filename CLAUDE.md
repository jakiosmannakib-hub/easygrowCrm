# CLAUDE.md — EasyGrowCrm

You are building **EasyGrowCrm**, an internal CRM + HRM for a ~20–50-person digital agency (SEO/GEO delivery, Chattogram, Bangladesh). This is an internal operating system, not a SaaS product: no client login, no multi-tenancy, no billing.

**Read this file first, every session.** It is the operating manual. It does not repeat the spec — it tells you where the spec lives and the rules you must never break. When this file and a PRD section disagree, the PRD section wins; tell the human so this file can be fixed.

---

## 0. The one-paragraph mental model

Every meaningful change is a **server action** with the same five-step shape (validate → authorize → transaction → audit → notify), wrapped in a sixth: the **`actionResult` boundary** (PUL-111), which returns a typed `ActionResult<T>` rather than letting an expected error throw across the server-action boundary; Next.js redacts those in production. Every action checks permission as its first real line, reads the user's role from the database (never the session), writes an append-only audit row inside the same transaction as the work, and enqueues notifications only after that transaction commits. Data models are strict hierarchies walked by explicit helpers. Time never comes from `new Date()` — it comes from an injectable clock so it can be frozen in tests. The client displays; the server decides. Get those reflexes right and most of this codebase writes itself.

---

## 1. The documents (read in this order before writing code)

The PRD is split into sections §9–§17 plus a foundational §1–§8. All live alongside this file. Reading order for a new task, ~2 hours total the first time:

1. **§16 Design Principles** — the 17 principles + how to break one. The "why" behind every rule below.
2. **§9 Auth & Authorization** — roles, the permission table (§9.6), the hard invariants (§9.7), the audit event list (§9.8).
3. **§12 Tech Stack & Architecture** — the stack, folder layout, the mutation shape (§12.11 is the seed of this file).
4. **§13 API Contract** — every action and query by name, with input shape, permission, transaction, and audit row. **You implement entries from this document by name; you never invent an endpoint.**
5. **§15 Testing Strategy** — what must be tested, the 31 mandatory test files (§15.4), the CI gates (§15.9).
6. **§17 Build Plan** — 80 numbered tickets (`PUL-xyz`) with subtasks. This is the execution order. Start at the lowest open ticket.
7. **The section for the feature you're building** — §10 Attendance, §11 Schema, §14 UI Spec, as relevant.

**§1–§8 (foundational PRD)** is the narrative "why" — roles, workflows, and the reasoning behind the core decisions. It's the orientation layer; the binding technical detail lives in §9–§17. Where the two differ, §9–§17 govern — so confirm any specific behavior, field, or rule against its §9–§17 section before you build it.

**The prototype (`easygrowcrm-prototype.html`)** is **visual reference only** (Amendment A). It shows look and layout. It is *never* authoritative for behavior — it still contains patterns that were deliberately abandoned (`window.*` globals, flat task lists, HR edit rights that the PRD removed). Cite a PRD section for behavior, never the prototype.

**Precedence, absolute:** §9–§17 → §1–§8 → prototype. Never invert it.

---

## 2. Non-negotiable rules

These are the rules that, if broken, cost the most to unwind. Most are mechanically enforced; the rest are caught in review.

### Mutations
- **Every server action follows the shape:** `actionResult(async () => …)` wrapping `validate (Zod)` → `authorize()` → `withTx` → `writeAudit(tx, …)` → return, then enqueue notifications after commit. Copy `features/_example/actions.ts`; don't freehand it.
- **Actions return, they don't throw (PUL-111).** The body still throws `AppError` (that is what unwinds the transaction), but `actionResult` converts it at the boundary to `{ ok: false, code, reason?, message }`. Keep the exported function an `async function` declaration wrapping the call; `export const x = actionResult(…)` silently disables `authorize-first` for that action. Non-`AppError` throws are re-thrown on purpose and stay redacted. Every client call site must branch on `result.ok`.
- **`authorize()` is the first awaited line** after validation. No exceptions. Enforced by the `easygrowcrm/authorize-first` ESLint rule.
- **Nothing outside `features/*/actions.ts` writes to the DB.** Queries can read anywhere; writes live in actions only.
- **`writeAudit` takes the `tx`.** Never call it against the global `db` — an audit row must roll back with the work it records.
- **Notifications enqueue *after* `withTx` commits**, never inside the transaction. Work that rolls back must not notify anyone.

### Identity & permission
- **`role` and `active` are read from the DB on every request**, never trusted from the session/JWT. A user deactivated five seconds ago must be stopped now.
- **Middleware never gates mutations.** It only redirects unauthenticated visitors. Authorization happens inside the action.
- **The permission table is `lib/permissions.ts` and §9.6 — they are the same table.** When unsure who can do something, read them.
- **`super_admin` is never an assignee.** Enforced by a DB trigger *and* app check (defense in depth). ESLint won't catch this — you must.
- **≥2 active manager-level users at all times.** Enforced by a DB trigger. Deactivation/demotion that would break it must fail.

### Time
- **Never `new Date()` or `Date.now()` in `features/**`.** The clock port (`lib/clock.ts`, `clock.now()`) is the only source of "now" — enforced by `easygrowcrm/no-direct-date`. This exists so late-detection, auto-close, and the timer are testable with frozen time.
- **Working-day dates are Asia/Dhaka calendar days** (work week Sun–Thu). Use `lib/time/dhaka.ts`, never the browser locale/timezone.

### Errors
- **Every error is an `AppError` carrying a §13 code** (`GATE` / `CONFLICT` / `FORBIDDEN` / `NOT_FOUND` / `VALIDATION` / `UNAUTHENTICATED` / `DEACTIVATED`). Never a bare `Error`. Gate errors name the specific field or task. Thrown inside the body, returned at the `actionResult` boundary (PUL-111).

### Data shape
- **Templates are a strict hierarchy:** Template → Month → Category → Task → Subtask. There is no flat `tasks[]`. `tplAllTasks()` is the *only* way to flatten one. No parallel flat caches of hierarchical data.
- **State is declared upfront.** No lazy `if (!state.x) state.x = …` initializers; no `window.*` globals as state (both were prototype patterns that caused real bugs).

### Language (mechanically grepped by CI, PUL-809)
- **"Completed" never appears as an employee-facing label.** Employees see **"Done — send to review."** "Completed" is a manager-only QC-bypass status.
- **"Score" appears nowhere** in `features/**` UI strings. The scoring system was deleted (Amendment H).
- **"Stuck" never labels a status.** Revision Required displays as "Needs revision."

### Audit (the one principle with no exception)
- **Every accountability-bearing mutation writes an audit row**, inside its transaction. The audit log is append-only — `UPDATE`/`DELETE` are revoked at the database level.
- **The single designed carve-out is `personal_task.crud`** (a private scratchpad, §9.6 ¹¹). Nothing else skips audit without a PRD amendment.

### Dates in the UI
- **Every rendered date carries the year** via `fmtDate` → `Aug 8, 2026`. Bare `Aug 8` is banned. Relative labels ("Today", "3d overdue") may appear only as a suffix, never as the whole date.

---

## 3. How to run a ticket (the workflow)

1. **Open the lowest-numbered unfinished ticket** in §17. Do not skip ahead — tickets are dependency-ordered.
2. **Read every PRD section listed in the ticket's "Reads" field.** Confirm every ticket in its "Depends" field is done.
3. **Work the numbered subtasks top to bottom**, checking them off. They're ordered; later ones assume earlier ones.
4. **For anything on the §15.4 mandatory-test list, write the contract test first.** This is the one place we're test-first — the contract is what everything depends on. Everything else: implement, then add the happy-path + one-failure test.
5. **The last commit of every ticket ships its tests and audit together.** A ticket with no tests is not done.
6. **Before opening a PR, run the local gate:** `tsc --noEmit`, ESLint (both custom rules), `vitest run`, `drizzle-kit check`, the mandatory-test manifest check. CI runs the same set (§15.9) plus the forbidden-words grep.

We are doing **critical-path testing, not full TDD** (§15.2). Test the rules that silently break the business if wrong: permissions, invariants, gates, the atomic sign-out, audit emission, working-day math, due-date computation, the hierarchy walker. Don't unit-test React components in isolation or simple CRUD.

---

## 4. Stack quick reference

Next.js 16.2 LTS (App Router) · React 19.2 · TypeScript strict · PostgreSQL 16 · Drizzle · Better Auth (Google OAuth only — no passwords, no signup) · Tailwind 4 + shadcn/ui · TanStack Query v5 · pg-boss for jobs (no Redis) · vitest + Playwright · Hetzner Singapore VPS + Docker Compose.

- **Auth:** Google sign-in only. Accounts are provisioned by SA/HR — provisioning *is* the invitation. No invite emails.
- **Ports live in `lib/`:** `clock.ts`, `errors.ts`, `notifications.ts`. Feature code imports these, never the underlying library directly.
- **Feature slices own everything:** `features/<name>/` holds its actions, queries, components, and colocated tests. No global `services/` or `repositories/`.

### File layout (as built — supersedes the §12 sketch)

§12 sketches nested `lib/auth/` and `lib/db/` folders. We went **flat** instead: one file per
concern in `lib/`, with `db/` at the repo root. This is the layout to follow; §12's folder sketch
is superseded (its *rules* — ports in `lib/`, feature slices own their code — still hold).

| Path | Holds |
|---|---|
| `lib/auth.ts` | Better Auth server instance + its `databaseHooks` wiring |
| `lib/auth-guards.ts` | `guardProvisioned` / `guardActive` — the sign-in rejection rules (§9.3) |
| `lib/auth-client.ts` | Better Auth browser client |
| `lib/session.ts` | `getSessionUser()` — re-reads role + active from the DB every request (§16.5) |
| `lib/authz.ts` | The §9.6 permission table as data, `can()`, and `authorize()` |
| `lib/errors.ts` | `AppError` + the seven §13 codes (landed in PUL-103, not PUL-106) |
| `lib/action-result.ts` | `ActionResult<T>`, `actionResult()`, `unwrap()`: the PUL-111 server-action boundary |
| `lib/mutation.ts` | `withTx` |
| `lib/route-guard.ts` | `requireRouteAccess()`: the per-page server guard (§9.5) |
| `lib/nav.ts` | The §14.1 nav table + `PAGE_META`; visibility is explicit `visibleTo` lists, not live `can()` |
| `db/index.ts` | The Drizzle client |
| `db/schema/*.ts` | Table definitions, re-exported from `db/schema/index.ts` |
| `db/migrations/` | Generated SQL + `meta/` snapshots |

Nothing lives at `lib/auth/can.ts`, `lib/auth/authorize.ts`, or `lib/db/`. Don't create those
folders — imports across the codebase assume the flat paths above.

---

## 5. Common mistakes this project is prone to

Learned the hard way — don't repeat them:

- **Copying behavior from the prototype.** It's visual reference only. The prototype gives HR template-edit rights, uses `window._mwiz`/`window._tftSubs` globals, and has a flat task list — all three are wrong for the real build.
- **Bringing back a deleted feature because §1–§8 mentions it.** Scoring, selfies, IP checks, recurring-spawn, invite emails, index-based template refs — all removed. Before implementing anything you first saw in the foundational PRD, confirm it still exists in the relevant §9–§17 section.
- **`new Date()` sneaking into a break timer or "due today" check.** Always `clock.now()`.
- **An audit row written outside the transaction, or skipped "because it's a small action."** If it's accountability-bearing, it's audited, in the tx.
- **Treating subtasks like the checklist.** The checklist gates submission; subtasks never do. Different permissions, different behavior (§9.6 ⁷).
- **Position/index-based references in templates.** Use ids. Positions aren't stable in the hierarchy.
- **Optimistic UI on an accountability action** (sign-in/out, submit, review, leave decision). Those wait for the server. Optimistic UI is only for pill changes, toggles, comments, and notification reads.

---

## 6. When you're unsure

- **A behavior question** → the relevant §9–§17 section. If two sections seem to conflict, the more specific one governs; when still unsure, ask the human rather than guessing.
- **A permission question** → §9.6 / `lib/permissions.ts`.
- **"Does this action exist / what's its shape?"** → §13. If it's not there, it's not in scope — don't invent it.
- **"Is this in scope for v1?"** → §17.4's out-of-scope list. Mobile app, client portal, Slack adapters, file uploads, real-time collab are all v2.
- **A principle seems wrong for this case** → §16.17 (how to break a principle: name it, get a second opinion, amend the doc — don't accumulate silent exceptions). The audit principle (§16.4) has no exception.

Build starts at **PUL-001**.
