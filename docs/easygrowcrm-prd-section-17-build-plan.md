# §17. Build Plan — EasyGrowCrm

**Status:** Final.
**Unit of work:** the **ticket**. One ticket ≈ one Claude Code session. Every ticket has a number (`PUL-xyz`), numbered subtasks (checkboxes — tick them as you go), a session budget, explicit dependencies, and a done-check. If a ticket is on this list, it ships. If it's not on this list, it's out of scope for v1.

**Ticket numbering:** `PUL-<phase><serial>` — the first digit(s) of the number tell you the phase. `PUL-104` = Phase 1, ticket 04. `PUL-1003` = Phase 10, ticket 03. Subtasks are `<ticket>.<n>` (e.g. `104.2`).

---

## 17.1 How this plan is structured

The unit of work is the **ticket**. Tickets are numbered `PUL-<phase><serial>` — the leading digit(s) name the phase (`PUL-104` = Phase 1, ticket 04; `PUL-1003` = Phase 10, ticket 03), and subtasks are `<ticket>.<n>` (e.g. `104.2`). Work top to bottom: tickets are dependency-ordered, so start at the lowest open number and don't begin a phase until the previous one is green.

The plan is **83 tickets across 11 phases**, with 340+ checkable subtasks *(originally 80; PUL-111, PUL-112 and PUL-113 were added to Phase 1 after it closed)*:

| Phase | Focus                                                       | Tickets             |
| ----- | ----------------------------------------------------------- | ------------------- |
| 0     | Environments & project setup                                | PUL-001 … PUL-004   |
| 1     | Foundation (auth, `authorize()`, audit, mutation shape, CI) | PUL-101 … PUL-113   |
| 2     | Employees & clients                                         | PUL-201 … PUL-207   |
| 3     | Attendance                                                  | PUL-301 … PUL-308   |
| 4     | Projects & tasks                                            | PUL-401 … PUL-413   |
| 5     | Templates & Start Project                                   | PUL-501 … PUL-506   |
| 6     | QC, review & EOD                                            | PUL-601 … PUL-607   |
| 7     | Leave                                                       | PUL-701 … PUL-707   |
| 8     | Dashboards, notifications & polish                          | PUL-801 … PUL-809   |
| 9     | Reports, audit & settings                                   | PUL-901 … PUL-903   |
| 10    | Pre-launch hardening                                        | PUL-1001 … PUL-1006 |

Each ticket carries **Budget · Reads · Depends · Done when**, and its numbered subtasks. The last subtask of every ticket is always its tests + audit in the same commit — a ticket without its tests is not done. A full ticket index is in §17.3.

---

## 17.2 How to run a ticket

1. Open the ticket. Read every PRD section listed in **Reads** — do not skip this.
2. Confirm every ticket in **Depends** is done (its checkboxes all ticked).
3. Work the subtasks top to bottom, ticking as you go. Subtasks are ordered — later ones assume earlier ones.
4. The last subtask of every ticket is always tests + audit in the same commit. If tests aren't shipped, the ticket is not done.
5. Tick the ticket's **Done when** line only when it is literally true.

**Budget legend:** **S** ≈ 30–90 min · **M** ≈ half-day sitting · **L** ≈ full sitting. Nothing is bigger than L — anything bigger was split during planning.

---

# Phase 0 — Environments & Project Setup (4 tickets)

Runs before all feature work. PUL-004 can run in parallel with Phase 1.

---

### PUL-001 — Repository scaffold

**Budget:** M · **Reads:** §12.1–§12.5 · **Depends:** —

- [x] 001.1 Init Next.js 16.2 LTS + React 19.2 + TypeScript strict; pnpm workspace
- [x] 001.2 Tailwind 4 + shadcn/ui installed; one demo button renders
- [x] 001.3 Folder skeleton: `features/`, `lib/`, `components/ui/`, `db/`, `tests/` (vertical-slice layout per §16.1)
- [x] 001.4 `pnpm dev`, `pnpm build`, `pnpm test` (vitest, zero tests) all succeed
- [x] 001.5 `.editorconfig`, base ESLint + Prettier, `README.md` with the §16.18 reading order

**Done when:** a fresh clone runs `pnpm i && pnpm dev` to a rendered page with zero warnings.

---

### PUL-002 — Local Docker environment

**Budget:** S · **Reads:** §12.6 · **Depends:** PUL-001

- [x] 002.1 `docker-compose.yml`: Postgres 16 with named volume + healthcheck
- [x] 002.2 `.env.example` documenting every env var the app will ever read (added to as we go)
- [x] 002.3 `pnpm db:up` / `pnpm db:down` scripts
- [x] 002.4 Second Postgres schema `easygrowcrm_test` + `pnpm test:db:reset` script

**Done when:** `pnpm db:up && pnpm test:db:reset` gives a clean empty test schema in under 10 seconds.

---

### PUL-003 — CI pipeline skeleton

**Budget:** M · **Reads:** §15.9 · **Depends:** PUL-001, PUL-002

- [x] 003.1 Workflow on push/PR: `tsc --noEmit` → ESLint → `vitest run` (with Postgres service container)
- [x] 003.2 `drizzle-kit check` job stub (activates in PUL-101)
- [x] 003.3 §15.4 mandatory-file check script (`scripts/check-mandatory-tests.ts`) — reads a manifest, fails if any listed file is missing; manifest starts empty and grows with each phase
- [x] 003.4 Branch protection: merge to `main` requires green CI — _CI gate verified (deliberately broken PR goes red). Branch protection NOT enforced on free plan / personal account; team relies on manual no-merge-on-red discipline. Enable rulesets if EasyGrow upgrades to a Team org._

**Done when:** a deliberately broken PR (type error) is blocked; a clean PR merges.

---

### PUL-004 — Staging server provisioning

**Budget:** L · **Reads:** §12 (hosting) · **Depends:** PUL-001 (can run parallel to Phase 1)

- [ ] 004.1 Hetzner Singapore VPS (~$9/mo tier per §12): Docker + Docker Compose installed, non-root deploy user, SSH keys only, firewall (80/443/22)
- [ ] 004.2 Domain + DNS for `staging.<domain>`; Caddy or Traefik with auto-SSL
- [ ] 004.3 Deploy script or minimal GitHub Action: push to `main` → build image → deploy to staging
- [ ] 004.4 Staging Postgres container with its own volume; staging `.env`
- [ ] 004.5 Uptime ping (any free monitor) on staging URL

**Done when:** merging to `main` auto-deploys to `https://staging.<domain>` and the page loads over SSL.

> **STATUS: DEFERRED** — intentionally parked until after Phase 3 (per §17, 004 can run parallel to Phase 1). Requires paid VPS + domain; revisit when meaningful features exist to test end-to-end.

---

# Phase 1 — Foundation (10 tickets — blocks all feature work)

---

### PUL-101 — Drizzle + migration runner + migration 001

**Budget:** M · **Reads:** §11 (order), §12.6 · **Depends:** PUL-002

- [x] 101.1 Drizzle config for app + test schemas
- [x] 101.2 Migration 001: extensions + `role` enum (SA/PM/TL/HR/EMP) exactly per §11
- [x] 101.3 `pnpm db:migrate`, `pnpm db:generate` scripts; migration applies cleanly; re-application is a no-op
- [x] 101.4 Activate `drizzle-kit check` in CI (PUL-003.2)

**Done when:** fresh DB → migrate → schema matches §11 for migration 001; CI migration job green.

---

### PUL-102 — Audit log + `writeAudit(tx)` (migration 003)

**Budget:** M · **Reads:** §9.7, §11 (003), §16.4 · **Depends:** PUL-101, **PUL-103**

> Ordering: `audit_log.actor_id references "user"(id)`. The `user` table is migration 002
> (PUL-103), so PUL-103 must land first — matches the §11.9 migration numbering (002 → 003).

> **Deviation as built — append-only by trigger, not by `REVOKE` (Amendment G).** §11.8 / §9.7
> enforce append-only by revoking `UPDATE, DELETE` from a least-privilege login. We did not
> create that login. Instead a `BEFORE UPDATE OR DELETE` trigger (`audit_log_no_update_delete`,
> calling `audit_log_block_mutation()`) rejects both statements for **every** role, the owner
> included — a stronger guarantee than the REVOKE, with no second DB user to provision and no
> special role needed in the immutability test. 102.0 and 102.2 are therefore **superseded**,
> not skipped. §11.8 and §9.7 should be amended to match.
>
> **Migration numbering:** spec calls this "migration 003"; Drizzle numbers 0-based, so the file
> is `db/migrations/0002_audit_log.sql`. Correct as-is. drizzle-kit does not track triggers, so
> the hand-appended trigger SQL is absent from the snapshot — `drizzle-kit check` stays green.

- [x] ~~102.0 Create least-privilege app role `easygrowcrm_app`~~ — **superseded** by the trigger (see note).
- [x] 102.1 Migration `0002_audit_log.sql`: `audit_log` table per §11.8 — before any feature table. `db/schema/audit.ts`; FK to `"user"(id)`, `audit_resource_idx`, `audit_actor_idx` (`actor_id, created_at DESC`).
- [x] ~~102.2 `REVOKE UPDATE, DELETE ON audit_log`~~ — **superseded**: `audit_log_no_update_delete` trigger in the same migration.
- [x] 102.3 `writeAudit(tx, input)` in `features/audit/write-audit.ts` — typed; `Tx` derived from `db.transaction`'s callback arg, so passing the base `db` is a **compile error**; runtime guard for bad casts; never catches, never opens its own tx, never reads the clock (`created_at` is a DB default).
- [x] 102.4 Tests: `features/audit/audit-immutability.test.ts` (UPDATE + DELETE rejected by the trigger, row survives unchanged) + `features/audit/audit-write.test.ts` (writes in-tx; row vanishes when the tx throws) → both in the CI manifest.

**Done when:** ✅ both tests pass against the real test DB; no mock anywhere. Mutation-checked: dropping the trigger fails the immutability test (3 failed), and swapping `tx.insert` for `db.insert` fails the rollback test — neither is vacuously green. (`vitest.config.ts` now sets `fileParallelism: false`: test files share one real database and TRUNCATE between cases.)

---

### PUL-103 — Better Auth + Google OAuth + sign-in screen

**Budget:** L · **Reads:** §9.2–§9.3, §14.1.1 · **Depends:** PUL-101

> **DECIDED (Phase 1) — five reconciliations against Better Auth 1.7 as actually built.** §9.2/§9.3
> have been amended to match; recorded here so the ticket and the spec agree.
>
> 1. **Drizzle adapter, not §9.2's raw `Pool`** — `drizzleAdapter(db, { provider: "pg" })`, so
>    **drizzle-kit is the single migration runner**. Two migration systems over one database is the
>    failure mode this avoids.
> 2. **No Better Auth CLI exists in 1.7** — the auth tables are reconciled against our Drizzle
>    schema via `getAuthTables()` from `better-auth/db`, not a generate command.
> 3. **The company-domain check (§9.3 step 5) is DROPPED** — the team signs in with personal Gmail
>    and there is no Workspace domain to check, so the provisioned `user` row is the sole gate.
>    Re-add if EasyGrow moves to Workspace.
> 4. **"Deactivated" is rejected in `session.create.before`, not `user.create.before`** — the
>    latter fires only for an email Better Auth has never seen, so someone deactivated _after_
>    their first sign-in would sail past it. Both guards live in `lib/auth-guards.ts`.
> 5. **`requireUser()` is named `getSessionUser()`** (`lib/session.ts`) — the name `authorize()`
>    calls it by. Behaviour per §9.5 is unchanged.

- [x] 103.1 Better Auth (≥1.6): Google provider only; signup disabled; sessions in Postgres. External OAuth app — team uses personal Gmail (no Google Workspace); each user added as an OAuth test user.
- [x] 103.2 `/sign-in` page per §14.1.1: logo + one Google button, nothing else
- [x] 103.3 Unknown email → _"This email is not registered with EasyGrowCrm. Contact HR."_; deactivated → _"This account has been deactivated."_ — Company-domain check (§9.3 step 5) **DROPPED**: no shared Workspace domain, so the provisioned `user` row is the sole gate. Re-add if EasyGrow moves to Workspace.
- [x] 103.4 Session helper `getSessionUser()` — re-reads role + active from DB every request (never trusts the session payload; §16.5)
- [x] 103.5 Test: `features/auth/session-from-google.test.ts` (unknown email, deactivated user) → CI manifest
- [x] 103.6 Seed the first `super_admin` by hand (Employees UI is Phase 2) — first sign-in has no other route onto the guest list.
- [x] 103.7 **`AppError` lands here, not in PUL-106.** `lib/errors.ts` — the class plus the seven §13 codes — was built in this ticket because `getSessionUser()` (103.4) throws `UNAUTHENTICATED`/`DEACTIVATED` and `authorize()` (PUL-104) throws `FORBIDDEN`, both before 106 exists. **PUL-106 adds only the toast mapper on top** (and one `reason` getter); it does not create the class. §17's PUL-106.1 is worded accordingly.

**Done when:** manual Google sign-in works locally with a hand-seeded super_admin; both rejection paths render their exact copy.
---

### PUL-104 — `authorize()` + `can()` permission core

**Budget:** L · **Reads:** §9.5, §16.5 · **Depends:** PUL-103

> **The matrix is §9.6, not §9.5.** This ticket's subtasks say "the §9.5 matrix"; §9.5 is the
> _rules_ (authorize-first, UI hides / API refuses, role re-read every request) and §9.6 is the
> _table_. Built against §9.6; §9.5 supplies the surrounding rules.

> **Deviation as built — flat file layout.** §12 sketches `lib/auth/can.ts` + `lib/auth/authorize.ts`.
> This project is flat (`lib/auth.ts`, `lib/session.ts`, `lib/errors.ts`, `db/` at root), so
> `can()`, `authorize()`, and the table all live in **`lib/authz.ts`**; no `lib/auth/` folder was
> created. The actual layout is now recorded in CLAUDE.md §4 "File layout (as built)", which
> supersedes §12's folder sketch — §12's _rules_ (ports in `lib/`, feature slices own their code)
> still hold.

- [x] 104.1 `can(user, action, resource?): boolean` in `lib/authz.ts` — pure (no DB, no clock, no I/O). The §9.6 table is data: `PERMISSIONS`, 51 actions × 5 roles, cells `allow`/`deny`/`self`/`assignee`/`own`/`scoped`. `as const satisfies Record<string, Record<Role, Cell>>` makes a missing role or an invalid cell a **compile error**, and `Role` derives from the `user_role` DB enum so the two cannot drift. Conditional cells with no resource fail closed.
- [x] 104.2 `authorize(action, resource?): Promise<User>` — calls `getSessionUser()` (which owns the `UNAUTHENTICATED` / `DEACTIVATED` throws and re-reads role + active from the DB every request, §16.5), throws `AppError('FORBIDDEN')` when `can()` is false, and returns the caller. `getSessionUser`'s row was already assignable to `User` — its `role` is the enum's literal union, not `string` — so no narrowing and no `as` was needed.
- [x] 104.3 Test: `features/auth/authorize.test.ts` — all 255 cells → CI manifest (4 files now). **The test does not import `PERMISSIONS`**: its expected grid is a second, independent transcription of §9.6, so a typo in either rendering fails. Conditional cells are asserted three ways (match → true, other user → false, no resource → false).
- [x] 104.4 JSDoc on `can()` and `authorize()` naming §9.6 as the source of truth ("change the table there first") and restating §9.5 rule 2 — the UI hides, the API refuses.

**Done when:** ✅ the matrix test is exhaustive — `expect(cells).toBe(255)` and `expect(actions).toHaveLength(51)` make the cell-count check mechanical, so a §9.6 row added without updating the fixture fails CI. Mutation-checked: flipping `employee.change_role` for `admin_hr` from deny to allow fails on exactly that cell (`employee.change_role × admin_hr should deny`) and nothing else; restored.

---

### PUL-105 — Mutation shape + `withTx` + `authorize-first` ESLint rule

**Budget:** M · **Reads:** §12.11, §16.2 · **Depends:** PUL-102, PUL-104

> **Deviation as built — the rule is "authorize before `withTx`", not "first await" (Amendment I).**
> §12.5 and 105.3 phrase it as "`authorize()` must be the first await after validation". Taken
> literally that rejects **§12.4's own canonical example**, which awaits a resource fetch
> (`await getTaskForApproval(...)`) before `authorize(...)` — you often cannot authorize until the
> subject is loaded. A read decides nothing; mutating before authorizing is the actual hole. So the
> enforced rule is: an exported async function in `features/**/actions.ts` must call `authorize()`,
> and that call must precede any `withTx()` call. Reads before `authorize` stay legal; a function
> that never calls `withTx()` is not policed. §12.5 should be amended to this wording.

> **Deviation as built — flat layout.** §12 sketches `lib/db/tx.ts`; `withTx` lives in
> **`lib/mutation.ts`** per the ticket title and CLAUDE.md §4 "File layout (as built)".
>
> `writeAudit` (PUL-102) keeps its own local `Tx` type — structurally identical to `withTx`'s, so
> the handle passes through unchanged. Merged code was not refactored.
>
> **New dependency:** `zod@4.5.4` — step 1 of the mutation shape is Zod validation.

- [x] 105.1 `lib/mutation.ts`: `withTx(fn)` — `Tx` derived from `db.transaction`'s callback arg; delegates to `db.transaction(fn, { isolationLevel: 'read committed' })` (§12.6). Drizzle already rolls back on throw / commits on return, so `withTx` pins the isolation level and gives the codebase one named, greppable entry point.
- [x] 105.2 Reference action `features/_example/actions.ts` — all five steps under numbered comments (validate → authorize → withTx → writeAudit → notify-after-commit), plus the §11.3 optimistic-lock `throw new AppError('CONFLICT')` snippet and the "a read may go here before `authorize`" note. Zero dead imports and no `eslint-disable` comments: everything a copy doesn't need (`AppError`, `notify`) appears only inside commented copy-ready snippets, so a new action inherits none of it.
- [x] 105.3 Custom ESLint rule `easygrowcrm/authorize-first` in `eslint-rules/authorize-first.mjs` — AST-based, no path logic inside the rule (scoping is the config glob). Async functions are tracked on a stack and each `authorize()` / `withTx()` call is attributed by source position to **every** enclosing async function, so `withTx(async (tx) => …)` still counts against the exported action. Two messages: `missingAuthorize`, `authorizeAfterTx`.
- [x] 105.4 Rule wired into `eslint.config.mjs` as `"error"` for `files: ["features/**/actions.ts"]` (so it runs in the existing CI lint job). Tested by ESLint's `RuleTester` in `eslint-rules/authorize-first.test.ts`, driven through vitest (`RuleTester.describe/it` assigned from vitest — globals are off here) so it runs in `pnpm test`: 3 valid (the `_example` shape; read → authorize → withTx per §12.4; a read-only action) + 3 invalid (`withTx` with no `authorize`; `authorize` after `withTx`; the same in arrow form). **PUL-105 is not on the §15.4 mandatory list**, so `scripts/check-mandatory-tests.ts` is unchanged (still 4 files).

**Done when:** ✅ copying `_example` is the documented way to start any new action — it is lint-clean, type-clean, and passes the rule that guards it. Mutation-checked: moving `authorize()` in the real `_example` to _after_ the `withTx` block fails `pnpm lint` with exactly `authorize() must run before withTx() in "exampleAction"` on that file (exit 1); restored. Gates green: `tsc --noEmit` 0 · `eslint .` 0 (no warnings) · `vitest run` 5 files / 16 tests · `drizzle-kit check` 0 · mandatory-test manifest 0.

---

### PUL-106 — Error codes + toast mapper

**Budget:** S · **Reads:** §13 (codes), §14.15 · **Depends:** PUL-001

> **Scope note — the mapper is transport-agnostic; the server-action boundary is deferred.**
> `errorToToast` takes a structural `ErrorLike { code, reason?, message?, meta? }`, **not** an
> `AppError` instance. Once an error crosses a server-action boundary it is a plain object, not a
> class instance, so accepting the shape means the mapper works unchanged on both sides with no
> re-hydration step — and **how** an `AppError` crosses that boundary is deliberately left to the
> first Phase 2 action rather than guessed at here. The dev route constructs `AppError`s directly
> and so does not pre-empt that decision.

> **Deviation as built — four codes ignore the server's message.** `UNAUTHENTICATED`,
> `DEACTIVATED`, `FORBIDDEN` and `NOT_FOUND` always render their fixed wording: a server message on
> those is an internal detail (`"user 7f3a lacks project.update on project 91"`) and the fixed line
> already says everything the user can act on. Only `VALIDATION`, `GATE` and `CONFLICT` prefer
> `err.message`. A `default` branch does the same for any non-§13 code, so a raw `ECONNREFUSED`
> string can never reach a user. Both are asserted by tests.

> **New dependency:** `sonner@2.0.8`. Neither sonner nor a shadcn toast was installed (PUL-001 left
> only `components/ui/button.tsx`), and sonner is what shadcn/ui's own `toast` component wraps
> today — so this is the shadcn path, not a detour from it.

- [x] 106.1 `lib/errors.ts` **verified, not recreated** — `AppError` already carried the seven §13 codes, an optional `message` and optional `meta` (built in PUL-103). Added one small typed getter: `reason` returns `meta.reason` when it is a string, so the mapper and future gate tests switch on GATE's machine-readable reason (§13 line 12) without casting.
- [x] 106.2a Pure mapper `lib/error-toast.ts`: `errorToToast(err): { message, refresh }`. Per-code defaults as specified; `refresh: true` for **`CONFLICT` only** (§14.15 r.3), asserted by a test that loops the other six codes. Exported `GATE_REASONS` registry seeded with the eight PRD reasons (`checklist_incomplete`, `proof_required`, `pending_reviews`, `client_in_use`, `last_managers`, `unresolved_assignments`, `sa_has_assignments`, `use_review`), each naming the blocked thing per §14.15 r.3; unknown reason → `err.message` → `"This action is blocked."`. **Feature tickets extend this registry** as they add gates — the file says so in a comment.
- [x] 106.2b `components/providers/toast-provider.tsx` (client, wraps sonner's `<Toaster position="top-right" richColors closeButton />`) mounted once in `app/layout.tsx`, plus client helper `lib/show-error-toast.tsx` → `showErrorToast(err)`. CONFLICT toasts use `duration: Infinity` — a toast offering an action the user must click shouldn't expire out from under them; every other code auto-dismisses at 6s. Refresh calls `window.location.reload()`, not `router.refresh()`: a CONFLICT means client state disagrees with the server, and only a full reload is guaranteed to discard it.
- [x] 106.3 Dev-only `app/dev/errors/page.tsx` (client component) — ten buttons: the seven codes, `VALIDATION` both with and without a server message, two known GATE reasons, an unknown GATE reason, and `CONFLICT` so the Refresh action can be eyeballed. **Prod-guarded:** `notFound()` when `process.env.NODE_ENV === "production"`, before anything renders.
- [x] 106.4 Test `tests/error-toast.test.ts` (19 cases): every code maps to its message; the four fixed-wording codes ignore a leaky server message; an unrecognised code yields the generic line; GATE resolves from the registry via top-level `reason`, via `meta.reason`, and off a real `AppError` getter; unknown reason falls back both with and without a message; every seeded reason is asserted to be specific rather than the generic fallback (so §14.15 r.3 can't rot as the registry grows); `CONFLICT` sets `refresh` and no other code does. **Not a §15.4 mandatory test** — `scripts/check-mandatory-tests.ts` unchanged (still 4 files).

**Done when:** ✅ each thrown code renders its distinct toast with correct copy — eyeballable at `/dev/errors`, and the wording is pinned by unit test rather than by looking at it. Gates green: `tsc --noEmit` 0 · `eslint .` 0 (no warnings) · `vitest run` 9 files / 57 tests · `next build` compiles clean with `/dev/errors` in the route table · mandatory-test manifest 0.

---

### PUL-107 — `notify()` port (stub adapter)

**Budget:** S · **Reads:** §13.9, §16.11 · **Depends:** PUL-001

> **Deviation as built — object input, typed against the §13.9 registry.** The ticket sketches
> `notify(userId, text, meta?)`: positional, with the message text passed in by the caller. Built
> instead as `notify({ to, type, data? })`, matching how §12.4 step 5 calls it and how §13.9 works —
> the _template_ owns the copy, the caller names a template and supplies its payload. A caller that
> passes prose would put user-facing wording in `features/**`, where the §2 forbidden-words grep
> and the §13.9 registry can't govern it. `NotificationType` is a union of the 18 §13.9 names, so
> an invented type is a **compile error** at the call site. The ticket's wording should be amended.

- [x] 107.1 `lib/notifications.ts`: `NotificationType` (the 18 §13.9 template names, no more and no fewer — verified against §13.9), `NotifyInput { to, type, data? }`, `notify(input): Promise<void>`. One recipient per call; loop for several.
- [x] 107.2 v1-stub adapter: pushes `{ ...input, sentAt }` onto a module-level array and `console.debug`s it. No DB, no webhook — `notifications` + `webhook_outbox` land in PUL-801 and **this interface does not change then** (§16.11). Test-only `__resetNotifications()` (clears; call it in setup) and `__sentNotifications()` (returns a **copy**, so the live array is never handed out). `sentAt` uses `Date.now()` for now — `lib/` is outside the `features/**` clock ban; it moves to `clock.now()` in PUL-108.
- [x] 107.3 Test helper `expectNotified(to, matcher)` in `tests/notifications.ts`. Object matcher = equal `type` when given plus a **subset** match on `data` (extra payload keys are fine); function matcher = predicate. On no match it throws listing every notification that _was_ sent — recipient, type and payload per line — or `(nothing was sent)`, so a failing integration test diagnoses itself.
- [x] 107.4 Test `tests/notifications.test.ts` (10 cases): notify records; reset clears; the accessor doesn't leak the live array; type / data-subset / predicate matches pass; and four failure paths (wrong type, wrong recipient, differing `data` value, nothing sent), with the wrong-type case asserting the error names what _was_ sent. **Not a §15.4 mandatory test** — `scripts/check-mandatory-tests.ts` is unchanged (still 4 files).
- [x] 107.5 `features/_example/actions.ts` step 5 updated to a real registry call — `await notify({ to: actor.id, type: 'task_approved', data: { taskId: parsed.resourceId } })`, still commented — so the copy-source can't teach a wrong shape. Two now-stale "port not built yet" notes in that file refreshed.

**Done when:** ✅ any Phase 2+ action can call `notify()` after its `withTx` commits and assert on it with `expectNotified`. Gates green: `tsc --noEmit` 0 · `eslint .` 0 (no warnings) · `vitest run` 6 files / 26 tests · mandatory-test manifest 0.

---

### PUL-108 — Clock port _(moved earlier so Phase 1–2 tests have frozen time)_

**Budget:** S · **Reads:** §16.6, §15.5 · **Depends:** PUL-001

> **Deviation as built — a swappable source behind a stable facade, not a reassigned export.**
> `clock` is an ordinary exported object whose `now()` reads a module-level source; tests call
> `setClock(testClock)` and `resetClock()` in teardown. The obvious alternative — `export let clock`
> reassigned by the test — was rejected because feature code does `import { clock }` at module
> scope, and a live reassigned binding only survives under native ESM; under transpilation or
> bundling it silently freezes at the original value and the test passes against the **real** clock.
> Full constructor injection was rejected as a large permanent cost (a clock argument on every
> action signature) for an ambient value. The facade gives freeze/advance at zero call-site cost.

> **Deviation as built — audit timestamps stay on the DB default, so 108.3 and the Done-when
> needed amending.** The ticket says "all timestamps everywhere (audit included) go through the
> port", and the Done-when asks for an audit row carrying the _frozen_ timestamp. That is the wrong
> target: `writeAudit` omits `created_at` and Postgres fills it from `now()` (`db/schema/audit.ts`,
> `.defaultNow().notNull()`), which is deliberate — audit time should be database commit-side time,
> not an app instant, and it means a frozen test clock cannot skew the append-only log. So the port
> governs _business_ time (late detection, timer unlock, auto-close); the audit clock is the
> database's. The ticket wording should be amended to say so.

- [x] 108.1 `lib/clock.ts`: `Clock { now(): Date }`; `systemClock` (the production adapter, and the **only** permitted `new Date()` in the codebase); `clock`, the facade every caller imports; `createTestClock(initial?)` → `now()` / `set(d)` / `advance(ms)`, handing out a **copy** each `now()` so a test can't mutate the frozen instant by accident; `setClock` / `resetClock` to swap the source.
- [x] 108.2 ESLint rule `easygrowcrm/no-direct-date` in `eslint-rules/no-direct-date.mjs`, registered in the **same** local plugin as `authorize-first` and wired as `"error"` for `files: ["features/**"]` — broader than `authorize-first`'s `actions.ts` glob, since any feature code can read a clock. No path logic inside the rule: `lib/clock.ts` is exempt purely by falling outside the glob. **Deliberate narrowing:** only the _zero-argument_ `new Date()` is banned — `new Date(row.startedAt)` is parsing a stored value, not asking what time it is. `Date.now()` is banned outright (it has no parsing form). Three `valid` test cases pin this narrowing so it isn't "fixed" later.
- [x] 108.3 Audit path confirmed clock-free — see the deviation note above; `writeAudit` is correct as-is and was not touched. A grep of `features/**` finds zero real `new Date()` / `Date.now()`; `_example` references the clock only in comments.
- [x] 108.4 Tests. `eslint-rules/no-direct-date.test.ts` — RuleTester via vitest (globals are off here): 3 valid (`clock.now()`; `new Date(row.startedAt)`; `someDate.getTime()`) + 3 invalid (`new Date()`; `Date.now()`; both in one file, both reported). `tests/clock.test.ts` — freeze is stable across calls, `advance(1000)` moves 1s, `set(d)` jumps absolute, `now()` hands out a copy, `setClock` makes code holding `clock` (not the test adapter) see the advance, `resetClock` restores real time. **Neither is a §15.4 mandatory test** — `scripts/check-mandatory-tests.ts` unchanged (still 4 files).

**Done when:** ✅ a test freezes time and any `features/**` code reading `clock.now()` sees the frozen instant — audit rows keep the database's `now()` by design (see the note above). Mutation-checked: adding `const x = new Date();` to the real `features/_example/actions.ts` fails `pnpm lint` with exit 1 and exactly `Use clock.now() from lib/clock — direct Date access is banned in features/** (§16.6)  easygrowcrm/no-direct-date` on line 23; removed, and `git diff --stat` on that file is empty. Gates green: `tsc --noEmit` 0 · `eslint .` 0 (no warnings) · `vitest run` 8 files / 38 tests · `drizzle-kit check` 0 · mandatory-test manifest 0.

---

### PUL-109 — Test fixtures: `seedMinimal` / `seedFull`

**Budget:** M · **Reads:** §15.5 · **Depends:** PUL-101

> **Scope deviation — user cast now, client/project when the tables exist (intentional).** §15.5's
> `seedMinimal` is "1 SA, 2 managers, 3 employees, 1 client, 1 project". The `client` and `project`
> tables are Phase 2 and do not exist yet, so this ticket builds the **user cast + guard + reset**;
> client and project rows get appended to `seedMinimal` when those tables land. `seedFull` is a
> skeleton that delegates to `seedMinimal` — flow tests don't exist yet, and no Phase 2 data is
> invented. Both facts are recorded in comments at the top of `tests/seed.ts`.

> **Interpretation — "2 managers" = `team_leader` + `project_manager`.** The two _delivery_ manager
> roles: the pair §9.6 distinguishes for task and project work, and the pair the "≥2 active
> manager-level users" invariant (§9.7) is about. `admin_hr` is manager-level too but stays out of
> the minimal cast — its permission set is orthogonal (people-ops), so a test needing HR adds one
> explicitly rather than inheriting one by accident and passing for the wrong reason.

> **Deviation as built — one file, not a `tests/fixtures/` folder.** §17 sketches
> `tests/fixtures/seedMinimal.ts` + `seedFull.ts`; built as a single `tests/seed.ts` exporting
> `isTestDbName` / `assertTestDb` / `reset` / `seedMinimal` / `seedFull`. The guard and the reset
> are shared by both seeds, and splitting six short exports across a folder buys nothing. Consistent
> with the flat layout of CLAUDE.md §4.

- [x] 109.1 `tests/seed.ts` → `seedMinimal()`: 1 `super_admin`, 1 `team_leader`, 1 `project_manager`, 3 `employee` — all active with `email_verified` true, deterministic ids (`seed_sa`/`seed_tl`/`seed_pm`/`seed_e1..e3`) and `@test.local` emails, so a failing test names a recognisable user instead of a random uuid. Returns typed handles `{ superAdmin, teamLeader, projectManager, employees: [e1, e2, e3] }` so tests use real ids. Deactivated/unverified users are what individual tests set up, never the shared fixture.
- [x] 109.2 `seedFull()` — skeleton delegating to `seedMinimal()`, so callers written against it keep working when it grows into the realistic org (§15.5).
- [x] 109.3 **Isolation choice, documented: truncate-and-reseed per file, not a rolled-back transaction.** `reset()` runs `TRUNCATE "audit_log", "session", "account", "verification", "user" RESTART IDENTITY CASCADE`, and `seedMinimal()` calls it first, so any file can seed at any point and get the same state. A rolled-back wrapping tx was rejected: the code under test calls `withTx` itself, and nesting real transactions inside a test-owned one turns every rollback assertion into a savepoint question — exactly the behaviour the audit-immutability tests exist to check. `vitest.config.ts` already sets `fileParallelism: false`, so files share one real database without racing. `verification` is truncated too though §17 lists four tables — leaving the fifth would make "every seed starts clean" quietly untrue.
- [x] 109.4 Guard: `isTestDbName(name)` — pure, `name.includes('test')`, deliberately crude so the rule everything rests on is trivially auditable (a false negative is an inconvenience; a false positive truncates a real database). `assertTestDb()` extracts the name with `new URL()` rather than a regex, so a `?sslmode=require` query string or a `/` in a password can't fool it, and throws `Refusing to seed: DATABASE_URL is not a test database (name must contain 'test')`. Called at the top of **every** seed function — per call, not once at import — since it is the only thing between a stray `pnpm test` and a wiped dev database.
- [x] 109.5 Test `tests/seed.test.ts` (13 cases): `isTestDbName` accepts `easygrowcrm_test` and rejects `easygrowcrm`/`prod`; `assertTestDb` throws when `DATABASE_URL` is repointed at the dev database; `seedMinimal` yields exactly 6 users with the right role distribution, correct handle ids/roles, and everyone active+verified; a second `seedMinimal()` doesn't duplicate (count stays 6); `reset()` twice in a row succeeds. **Not a §15.4 mandatory test** — `scripts/check-mandatory-tests.ts` unchanged (still 4 files).
- [x] 109.6 **TRUNCATE vs the append-only audit trigger — re-confirmed empirically, not by reading the migration.** The trigger is `FOR EACH ROW ... UPDATE OR DELETE` (`db/migrations/0002_audit_log.sql:23`); TRUNCATE fires neither, and **is not blocked**. Two tests pin it: one inserts a real audit row and asserts `reset()` resolves and empties the table; the other asserts a plain `DELETE` on a fresh audit row still rejects _after_ a truncate — so TRUNCATE is not a back door that disarms §16.4, and adding a TRUNCATE statement-trigger later fails here rather than in whichever suite happens to seed first.

**Done when:** ✅ two test files using `seedMinimal` run in any order with identical results — each seed truncates first, so order cannot matter. Gates green: `tsc --noEmit` 0 · `eslint .` 0 (no warnings) · `vitest run` 10 files / 70 tests (existing suite unaffected) · mandatory-test manifest 0.

---

### PUL-110 — App shell: sidebar + header + role-based nav

**Budget:** L · **Reads:** §14.1 · **Depends:** PUL-103, PUL-104

> **DECIDED (Phase 1) — nav visibility is the §14.1 list, NOT a live `can()` call.** 110.2 as
> written derives the sidebar from `can()`; that produces the wrong sidebar in both directions,
> because §14.1's "Visible to" column is **curated**: Audit Log is `scoped` for HR (a narrowed
> read — the item still shows), and Review is hidden from employees even though `review.read` is
> `self` for them. So `NAV_ITEMS` in `lib/nav.ts` carries an explicit `visibleTo: Role[]`
> transcribed from the §14.1 table. This costs nothing in security: the boundary is the per-page
> `requireRouteAccess` guard (404 on a forbidden route), exactly as §14.1's "the sidebar is
> cosmetic" intends.

> **Deviation as built — `proxy.ts`, not `middleware.ts`.** Next 16.3 deprecated the `middleware`
> file convention in favour of `proxy` (the build warns on the old name). Same hook, same
> convenience-only semantics: it checks that a session **cookie is present** via Better Auth's
> `getSessionCookie`, never calling `getSession` and never trusting the cookie's contents
> (CVE-2025-29927, §9.5).

- [x] 110.1 Sidebar `components/shell/sidebar.tsx` (client — needs `usePathname` for the active highlight): logo, the 13 items per §14.1, lucide icon + label, active highlight, Logout pinned bottom via `authClient.signOut()` → `/sign-in`. **No user-switcher** — confirmed by sweep: the only match for "switcher" in the whole codebase is the comment recording that it must not ship.
- [x] 110.2 Nav visibility from the explicit §14.1 `visibleTo` lists (see the note above), hidden items don't render at all. `lib/nav.ts` is pure and stores the icon **name** as a string, not a component, so the server route guard can import it without dragging client code along; `components/shell/nav-icon.tsx` resolves names to lucide components on the client.
- [x] 110.3 `PAGE_META` (in `lib/nav.ts`) → header title + subtitle per route. The header matches the **longest** route prefix, so a future `/projects/42` keeps its header rather than falling back to the app name.
- [x] 110.4 Header bell icon + unread badge — hard-coded `0`, no panel and no click behaviour; the Notifications slide-in lands in **PUL-802**, noted in the component.
- [x] 110.5 Route guards: `lib/route-guard.ts` → `requireRouteAccess(route)` is the **first line of every page**. Unauthenticated/deactivated → `/sign-in`; role not permitted → `notFound()` (404, not 403 — a 403 confirms the page exists and tells an employee which admin surfaces to go looking for). `canAccessRoute` also denies an **unknown** route, so adding a page but forgetting its nav entry fails closed. The `(app)` layout does **authentication** (so the sidebar has a role to render); each page does its own **role** check, since a layout cannot know which route rendered beneath it.
- [x] 110.6 Route group `app/(app)/` — shell layout + 13 placeholder pages (one per `lib/nav.ts` route), `/sign-in` deliberately outside the group. `/` redirects to `/dashboard`.
- [x] 110.7 Test `tests/nav.test.ts` (14 cases): the expected route set per role is transcribed from §14.1 **independently** of `lib/nav.ts` (reading `visibleTo` back would only prove the table agrees with itself), and `canAccessRoute` is cross-checked against `visibleNavItems` for all 65 role × route pairs so the cosmetic list and the security predicate cannot drift. **Not a §15.4 mandatory test** — `scripts/check-mandatory-tests.ts` unchanged (still 4 files).

**Done when:** ✅ each of the 5 roles resolves to exactly the §14.1 item set — mechanical, not eyeballed: super_admin **13**, admin_hr **13**, project_manager **10**, team_leader **10**, employee **6**. Deep-linking a forbidden route 404s via `requireRouteAccess`. Gates green: `tsc --noEmit` 0 · `eslint .` 0 (no warnings) · `vitest run` 11 files / 84 tests · `next build` compiles with all 13 routes in the table.

---

### PUL-113 — Signed-in user in the top header (§14.1 addition)

**Budget:** S · **Reads:** §14.1 · **Depends:** PUL-110

> Added after Phase 1 closed, like PUL-111 and PUL-112. §14.1 specced the top header as page
> title + subtitle + bell only, with no indication of *who you are signed in as* anywhere in
> the shell — the sidebar shows Logout but not the account it would log out of. This ticket
> adds that block and amends §14.1 to match.

- [x] 113.1 Right-aligned user block in `components/shell/header.tsx`: Google profile picture, name, role label. The avatar falls back to `initials()` from `features/employees/display.ts` when `image` is null — the normal state for a provisioned user who has not yet signed in, not an error. The role label comes from the shared `ROLE_LABELS` map in the same file, so the header and the PUL-206 card grid cannot drift on wording.
- [x] 113.2 **Read-only, no switcher.** §14.1 says the prototype's user-switcher dropdown must NOT ship, so the block is a plain `<div>` — no dropdown, no menu, no account switching, no click behaviour. Logout keeps its single home at the sidebar bottom and is **not** duplicated here. Responsive: the name and role collapse below `sm`, the avatar always survives.
- [x] 113.3 No new query. The `(app)` layout already resolves the user via `getSessionUser()` to pick the sidebar's role; it now passes that row to `<Header>`. `lib/session.ts`'s select gains `name` and `image` — two more columns on a read that already happens. They are read from the DB rather than `session.user` deliberately: an HR name edit (PUL-203) then lands on the person's next request instead of waiting up to 7 days for the token to refresh, the same reasoning §16.5 applies to `role`/`active`.
- [x] 113.4 Amend §14.1's "Top header" bullet to describe the addition and record that it is read-only.
- [x] 113.5 **Fix: Google profile pictures were never stored.** Shipped in this ticket because 113.1 is what made the empty column visible — `"user".image` was NULL for all 6 dev users, the daily-signing-in super admin included. See the as-built note below.

**Done when:** ✅ the header names the signed-in user on every page, with a real Google picture once they have signed in and initials before that. No automated test (UI, no new data path) — the image *backfill* is tested, see below. Gates green: `tsc --noEmit` 0 · `eslint .` 0 · `vitest run` 20 files / 152 tests · `drizzle-kit check` clean · manifest 13 files · `next build` compiles.

> **As-built — the profile-picture backfill (113.5).** A third instance of the same family as
> PUL-202's `requireLocalEmailVerified` bug: **this app provisions users before Google exists,
> so every Better Auth behaviour that fires on user *creation* is dead code here.** Sign-in
> always takes the *link* branch of `handleOAuthUserInfo`, which defers to
> `applyUpdateUserInfoOnLink` — whose first line returns early unless
> `accountLinking.updateUserInfoOnLink` is true. It was not set, so `image` had no path to the
> database at all. Fixed with the library's own extension points:
> `accountLinking.updateUserInfoOnLink` (first link) + `google.overrideUserInfoOnSignIn` (every
> later sign-in, so a changed photo propagates).
>
> **Neither option is image-only** — both call `updateUser({ name, image, … })` — so a third
> piece was needed: a `databaseHooks.user.update.before` hook forcing `name: undefined`, which
> the adapter strips. Without it Google's name silently reverts an HR correction made through
> `updateEmployee` on the employee's next sign-in, and because the callback route coerces a
> missing provider name to `''`, a Google account with no name would blank the column outright
> (verified: `undefined` preserves, `''` writes). **`name` is HR-owned; Google never writes it.**
> Safe to apply to every Better Auth user update, because `createEmployee` and `updateEmployee`
> both write the `user` table through Drizzle directly and never reach the hook. No audit row —
> profile plumbing carries no accountability.
>
> `next.config.ts` is deliberately untouched: the header renders base-ui's `AvatarImage`, a
> plain `<img>`, not `next/image`, so `remotePatterns` does not apply. **If anyone swaps it for
> `next/image`, avatars break instantly** until `lh3.googleusercontent.com` is added there.
>
> Tests: 3 cases added to `features/auth/oauth-link-provisioned.test.ts` (not a §15.4 mandatory
> file; manifest unchanged at 13). The load-bearing one asserts `name` is UNCHANGED when Google
> offers a different spelling. Both halves mutation-proofed. One trap worth remembering: the
> helper must read `overrideUserInfo` off the *configured* provider the way the callback route
> does — hardcoding `true` made the image assertions pass with the fix fully backed out, pinning
> Better Auth's behaviour instead of ours.
>
> **Still unproven:** the real Google round-trip. The tests supply the profile Google would
> return; a genuine `lh3` URL arriving in a real ID token needs a manual sign-in.

---

**Phase 1 exit:** all 10 tickets done. CI enforces types, lint (both custom rules), tests, migrations, and the manifest. Only now do features begin. *(PUL-111, PUL-112 and PUL-113 were added afterwards, against a closed phase — see each ticket for why.)*

---

# Phase 2 — Employees & Clients (7 tickets)

---

### PUL-201 — User hardening + min-managers trigger (migration 004)

**Budget:** M · **Reads:** §11 (004), §9.4 inv. 7 · **Depends:** PUL-101

> **As-built:** the ticket title said "Employee table". There is no `employees` table and never
> was one — the employee entity is Better Auth's `"user"` (migration 002), extended with
> `role`/`title`/`department`/`active`/`join_date` via `additionalFields` (§11.1). §11.9 already
> names this migration "user hardening"; the title now matches. Because there is no schema diff,
> 0003 is a **journaled `--custom`** migration (`drizzle-kit generate --custom`) holding
> hand-written SQL only. Functions and triggers sit outside drizzle's snapshot — same as
> `0002_audit_log` — so `drizzle-kit check` stays green.

- [x] 201.1 Migration 004 (file 0003_user_hardening.sql): user hardening per §11.9 — NO employees table; the entity is Better Auth's "user" (migration 002). enforce_min_two_managers() + trigger, plus forbid_super_admin_assignee() function def (its pt_no_sa_assignee trigger attaches in 008/PUL-401).
- [x] 201.2 DB trigger user_min_managers BEFORE UPDATE OF active, role ON "user": rejects any UPDATE that sets active or role and would leave <2 active manager-level users. Narrower than "any UPDATE" by design and complete — count can only drop via an active/role change, and users are never hard-deleted (§9.4/§11), so no other path exists. Verified against the live DB: `pg_get_triggerdef` matches §11.1 verbatim, message `'operation would leave fewer than two active manager-level users'`. `CREATE TRIGGER` has no `OR REPLACE` in PG16, so the file does `DROP TRIGGER IF EXISTS` first — both routines are `CREATE OR REPLACE`, keeping 0003 re-runnable.
- [x] 201.3 Test: `features/employees/min-two-managers.test.ts` — real test DB, no mocks, every statement raw SQL straight at the table. 3 cases: **block deactivate** (raw-deactivate PM 3→2, allowed — the boundary is legal — then raw-deactivate TL → rejected, TL still active), **block demote** (PM out, then SA `role→'employee'` → rejected, SA still super_admin), **allow ≥2** (raw-promote `seed_e1` to project_manager → succeeds). The third case is load-bearing: it proves the trigger *runs and permits*, so the other two are rejections rather than a trigger that never fired. Registered as the **5th** CI manifest entry. Mutation-proofed for real — dropping `user_min_managers` fails exactly the two block cases.
- [x] 201.4 ~~Extend `seedMinimal` with real employee rows~~ — **no change needed.** `tests/seed.ts` `seedMinimal()` (PUL-109) is already the §15.5 cast: `seed_sa` / `seed_tl` / `seed_pm` + 3 employees, deterministic ids and `@test.local` emails. Shrinking it to the 2-manager floor was considered and rejected — PUL-102/103/104 tests depend on this fixture, and the below-2 boundary is a test-*arrange* concern, not a seed concern (the test steps down to 2 itself). Client + project seed rows stay deferred to PUL-207 (migration 007), per the scope note in `tests/seed.ts`.

**Done when:** ✅ the trigger is unbreakable even via `psql` — both block paths raise on raw SQL, the pass path succeeds. Gates green: `tsc --noEmit` 0 · `eslint .` 0 (no warnings, both custom rules) · `vitest run` 12 files / 87 tests · `drizzle-kit check` clean · manifest 5 files.

---

### PUL-202 — Add-employee action + modal (§13.1.1)

**Budget:** M · **Reads:** §13.1.1, §14.12 · **Depends:** PUL-105, PUL-201 _(also PUL-106 toast mapper, PUL-110 route + shell — both already done)_

> **Built in two stages:** Stage 1 the action + contract test, Stage 2 the modal. The stage
> split is a review convenience, not a scope change — both ship in this branch.

- [x] 202.1 Action in the 5-step shape: email, name, role, title, dept, join date; **no email sent**. `features/employees/actions.ts` → `createEmployee`, copied from `features/_example/actions.ts`. Direct Drizzle insert into `"user"` (`active: true`, `emailVerified: false`, id `usr_<uuid>`); **no** Better Auth create-user call — `guardProvisioned` rejects any email without a pre-existing row, so this row *is* what unlocks the OAuth path, and Better Auth links by email on first sign-in, not by id. Audit `employee.created` in the same tx. Notify: none (§13.1.1).
- [x] 202.2 Duplicate email → `CONFLICT`; validation via zod. Defended twice: a pre-check `SELECT` inside the tx for the clean error, plus a `23505` unique-violation catch outside `withTx` as the race backstop (reads the pg code off `error.cause`, which is where Drizzle keeps it). Each was disabled in turn to confirm both independently produce `CONFLICT`.
- [x] 202.3 Modal per §14.12 with the copy _"They'll sign in with their company Google account. No invitation email is sent."_ — shadcn Dialog behind **+ Add Employee** on `/employees`, six fields incl. role ▾ (all 5 `user_role` values). Join date is `<input type="date">`, so it is a `YYYY-MM-DD` string end to end and never a `Date` a timezone could shift across a Dhaka day boundary (§11.0). Inline validation reuses the same zod schema; the action re-parses as the real gate (§9.5 r.2). Success → toast + close; every error → the PUL-106 mapper, so a duplicate shows the `CONFLICT` toast with its Refresh action (§14.15 r.3). Not optimistic — adding a person waits for the server (§14.15 r.5). No automated test (UI); **manual QA per PUL-206.4**. PUL-206 builds the card grid + filters around this button.
- [x] 202.4 Tests: happy path + duplicate + audit row + HR-allowed/EMP-forbidden — `features/employees/create-employee.test.ts`, 4 cases, real test DB, **6th** CI manifest entry. `authorize()` is NOT mocked (§15.8 forbids it) and neither is the DB; the only stub is `auth.api.getSession`, the HTTP envelope, since a vitest node run has no cookie to read. `getSessionUser()` underneath still re-reads role/active from Postgres (§16.5), so the HR case works by genuinely promoting a seeded row to `admin_hr`. Mutation-proofed: flipping the action to `authorize('employee.read_self')` fails the FORBIDDEN case.

**Done when:** ✅ SA and HR can add; new employee can immediately Google-sign-in. Gates green: `tsc --noEmit` 0 · `eslint .` 0 · `vitest run` 13 files / 91 tests · `drizzle-kit check` clean · manifest 6 files · `next build` compiles.

> **As-built notes (three deviations, all deliberate):**
> 1. **No company-domain guard.** §13.1.1 requires "email domain = company domain (same check as
>    the OAuth gate, §9.3)" — but that gate was **dropped in PUL-103**; `lib/auth-guards.ts` has no
>    domain check to mirror. Provisioning is the gate. §13.1.1 needs the clause struck.
> 2. **No leave-balance initialization.** §13.1.1 puts PUL-701.2's on-add hook in this tx.
>    `leave_quotas` is migration 011 (PUL-701), so it lands there instead — **PUL-701.2 must add it
>    to this action**, not to a second one.
> 3. **Modal copy is two sentences, no em dash** (owner's call), where §14.12 reads
>    _"…Google account — no invitation email is sent."_ Docs-update candidate.
>
> **Schema location:** the zod input lives in `features/employees/schema.ts`, not `actions.ts` — a
> `'use server'` file may only export async functions, so a client component importing the schema
> from `actions.ts` is a build error. Follow this split for every action with a form.
>
> **shadcn gotcha:** adding `dialog/input/label/select` made the CLI install a junk npm package
> named `cn` and import from `"cn"` instead of `@/lib/utils`. Removed and corrected. This project's
> style is **base-mira (Base UI, not Radix)**: triggers take `render={<Button/>}` not `asChild`, and
> `Select`'s `onValueChange` yields `string | null`.

---

### PUL-203 — Edit-employee action (§13.1.2)

**Budget:** S · **Reads:** §13.1.2 · **Depends:** PUL-202

- [x] 203.1 Action: name, title, dept, join date editable (role NOT here — that's PUL-204; email immutable)
- [x] 203.2 Audit row carries before→after diff
- [x] 203.3 Tests: happy path + role-not-editable-here + audit diff shape

**Done when:** field edits round-trip; role and email untouchable via this action.

---

### PUL-204 — Change-role action, SA only (§13.1.3)

**Budget:** S · **Reads:** §13.1.3 · **Depends:** PUL-202

- [x] 204.1 Action: SA only; HR gets `FORBIDDEN`
- [x] 204.2 Next request by the affected user reflects the new role (DB re-read proof, §16.5)
- [x] 204.3 Test: `features/employees/role-change.test.ts` → CI manifest

**Done when:** demote-a-manager attempt that breaks min-2 is rejected by the PUL-201 trigger.

---

### PUL-205 — Deactivate + offboarding checklist (§13.1.4)

**Budget:** L · **Reads:** §13.1.4, §14.12 · **Depends:** PUL-203 _(fully testable after Phase 4 adds tasks; blocker-list query ships now against empty sets)_

- [x] 205.1 Blocker query: open assignments + routed reviews for the target user (returns empty pre-Phase-4; shape is final)
- [x] 205.2 Offboarding modal per §14.12:每 blocker row with reassign ▾ / cancel; Deactivate disabled until zero blockers
- [x] 205.3 Hard block + explanation if deactivation would leave <2 managers
- [x] 205.4 Deactivated users: muted "(deactivated)" in history, excluded from every dropdown (shared `activeUsersQuery`)
- [x] 205.5 Test: `features/employees/deactivate.test.ts` (happy, min-managers-block; open-task-block extended in Phase 4) → CI manifest

**Done when:** deactivation is impossible while blockers exist; sessions of the deactivated user die on next request.

---

### PUL-206 — Employees page UI

**Budget:** L · **Reads:** §14.12 · **Depends:** PUL-202…PUL-205, PUL-110

- [x] 206.1 Card grid: avatar, name, title, dept chip, role badge, Active/Deactivated pill
- [x] 206.2 Filters: dept ▾, status ▾, name search
- [x] 206.3 Detail drawer: edit fields (203), Change role (SA-only visible, 204), Deactivate (205)
- [x] 206.4 Manual QA as all 5 roles (EMP/PM/TL don't see the page at all — nav + route guard)

**Done when:** every §14.12 affordance works through the real actions.

---

### PUL-207 — Clients CRUD

**Budget:** M · **Reads:** §11 (clients table), §14.3 filter bar · **Depends:** PUL-105

- [x] 207.1 Clients table lands with migration 007 prep or its own mini-migration — name, contact, active flag (v1-minimal per §11)
- [x] 207.2 Actions: create / edit / archive-client (archive blocked if live projects exist → `GATE`)
- [x] 207.3 Minimal UI: managed from a section in Settings or a lightweight `/clients` list (owner's call — default: Settings section)
- [x] 207.4 Tests: CRUD + archive gate + audit

**Done when:** the Phase 4 filter bar and Phase 5 Start Project wizard have real clients to select.

> **Status: merged.** Landed on `main` in PR #26 (merge commit `515981b`) — migration
> `0004_clients.sql`, `features/clients/*`, the Settings section, and `clients.test.ts` in the CI
> manifest. *(This note previously read "built, NOT yet merged"; it was left stale after the
> merge and is corrected here.)*
>
> `clients` shipped **alone** rather than with `projects` + `personal_tasks` as §11.9's logical
> migration 007 groups them, because `projects` belongs to PUL-401. That split is where the
> logical-vs-drizzle file numbering diverges — see the mapping table under PUL-401.

---

**Phase 2 exit:** org management complete; min-managers unbreakable; clients exist.

---

# Phase 3 — Attendance (8 tickets)

---

### PUL-301 — Attendance + breaks + holidays tables (migrations 005–006)

**Budget:** M · **Reads:** §11 (005–006), §10 · **Depends:** PUL-101

- [ ] 301.1 Migrations 005–006: `attendance`, `attendance_breaks`, `holidays` per §11
- [ ] 301.2 Partial unique index: one open break per attendance row (DB-level invariant)
- [ ] 301.3 Indices per §11; extend `seedMinimal`

**Done when:** schema diff vs §11 is empty.

---

### PUL-302 — Sign-in action + late detection (§13.5.1)

**Budget:** M · **Reads:** §13.5.1, §10 · **Depends:** PUL-301, PUL-108

- [ ] 302.1 Action: creates today's row, work type, sign-in time via clock port
- [ ] 302.2 Late flag when past grace (settings-driven; hardcode default until PUL-903, note it)
- [ ] 302.3 Already-signed-in → `CONFLICT`
- [ ] 302.4 Sign-In modal per §14.6.1: work type ▾ + daily-plan pre-fill (plan rows link to tasks after Phase 4; ad-hoc rows work now)
- [ ] 302.5 Test: `features/attendance/sign-in.test.ts` (frozen-clock on-time / late / conflict) → CI manifest

**Done when:** all three paths pass with a frozen clock.

---

### PUL-303 — Break start/end + one-open-break (§13.5.2–3)

**Budget:** M · **Reads:** §13.5.2–3, §14.6.2 · **Depends:** PUL-302

- [ ] 303.1 Start-break (type ▾) and end-break actions
- [ ] 303.2 App-level `CONFLICT` "You're already on a break" + the DB index from 301.2 as backstop
- [ ] 303.3 Break-exceeded computation (total vs allowance) server-side
- [ ] 303.4 Test: `features/attendance/break.test.ts` (start/end/conflict/exceeded) → CI manifest

**Done when:** invariant enforced at both layers; exceeded flag flips at exactly allowance+1min under a frozen clock.

> **Inherited from PUL-412:** `getWorkload`'s `onBreak` is stubbed `false` until this ticket
> lands (`TODO(Phase 3 / attendance)` in `features/projects/queries.ts`). Wire it to "has an open
> `attendance_breaks` row right now" and the Workload tab's dot lights up with no UI change. That
> also closes 412.3.

---

### PUL-304 — `getMyTimer` + timer card component

**Budget:** M · **Reads:** §14.2 (centerpiece), §16.6 · **Depends:** PUL-303

- [ ] 304.1 `getMyTimer` query: server-authoritative net time, target, on-break, break totals, sign-out eligibility
- [ ] 304.2 Timer card: SVG ring, poll 30s + cosmetic client tick between polls; green at target; break clock blue → red past allowance; Sign-Out enables **only** on server-said-so
- [ ] 304.3 v1 target = full day (7h); half-day target wiring deferred to **PUL-707** (cross-phase dependency) — `TODO(PUL-707)` in code
- [ ] 304.4 Test: `features/attendance/timer.test.ts` — client cannot unlock sign-out early → CI manifest

**Done when:** advancing the frozen clock to exactly 7h flips eligibility server-side.

---

### PUL-305 — Sign-out atomic transaction (§13.5.4)

**Budget:** L · **Reads:** §13.5.4, §14.6.3, Amendment I · **Depends:** PUL-304

- [ ] 305.1 Sign-Out modal: per-task rows (plan-linked rows fully wire in Phase 4; ad-hoc rows complete now), status ▾, actual `HMInput`, proof
- [ ] 305.2 Project-linked done option reads **"Done — send to review"** — the word "Completed" appears nowhere (CI grep lands in PUL-809; honor it now)
- [ ] 305.3 Any row not done → Explanation textarea required (inline error)
- [ ] 305.4 One atomic tx: attendance close + task updates + EOD row + audit; **any failure = full rollback**, single toast naming the first failing gate and task
- [ ] 305.5 Test: `features/attendance/sign-out.test.ts` — happy + each gate + mid-tx crash rollback → CI manifest

**Done when:** killing the tx mid-flight leaves zero partial state.

---

### PUL-306 — Early sign-out (§13.5.5)

**Budget:** M · **Reads:** §13.5.5, §14.6.4 · **Depends:** PUL-305

- [ ] 306.1 Quiet "Sign out early" text-link always visible while signed in (§14.2 — the escape hatch is never hidden)
- [ ] 306.2 Modal: required reason + warning copy + same per-task rows; flags attendance `early`
- [ ] 306.3 All managers notified via `notify()`
- [ ] 306.4 Test: `features/attendance/early-sign-out.test.ts` → CI manifest

**Done when:** early exit shows the ⚠ Early badge with reason tooltip in Attendance.

---

### PUL-307 — pg-boss setup + auto-close job

**Budget:** L · **Reads:** §13.5.6, §12 (pg-boss) · **Depends:** PUL-305

- [ ] 307.1 pg-boss installed, schema migrated, worker boot wired into the app process (first job-queue use in the codebase — document the pattern)
- [ ] 307.2 Cron: any attendance ≥10h after sign-in with no sign-out → auto-close, exit `auto`, reason "No sign-out", audited
- [ ] 307.3 Idempotent: re-runs skip already-closed rows
- [ ] 307.4 Test: `features/attendance/auto-close.test.ts` (frozen clock advanced past 10h) → CI manifest

**Done when:** the job closes exactly the right rows and never double-closes.

---

### PUL-308 — Attendance page: Today + History + export

**Budget:** L · **Reads:** §14.5, §14.15 r.1–2 · **Depends:** PUL-304…PUL-307, PUL-110

- [ ] 308.1 Today tab: own timer card, team grid (work type, sign-in + Late, live break indicator, break total red past allowance, sign-out + exit badge), "Not signed in yet" list
- [ ] 308.2 History tab: filters (employee ▾ MGR/HR-only, from/to, Flagged-only), summary line, table — **all dates with year** (`Aug 6, 2026`)
- [ ] 308.3 EMP sees self only; MGR/HR see all (server-scoped)
- [ ] 308.4 **Export (Excel)** — server-side full-range export; on-screen 400-row cap
- [ ] 308.5 Manual QA all roles

**Done when:** the daily loop (in → break → out) works end-to-end from this page for a real employee.

---

**Phase 3 exit:** attendance is live on staging and used by at least one real person daily.

---

# Phase 4 — Projects & Tasks (13 tickets)

---

### PUL-401 — Project-side tables (migrations 007–009)

**Budget:** M · **Reads:** §11 (007–009) · **Depends:** PUL-101, PUL-207

- [x] 401.1 Migrations: `projects`, `personal_tasks`, `project_tasks`, `task_subtasks`, `task_checklist_items`, `task_comments`, `task_submissions`, `task_reviews` per §11. **Table names corrected:** this line originally read `project_task_subtasks` / `project_task_checklist` / `project_task_comments`; §11.3.1 is authoritative on schema and names them `task_subtasks` / `task_checklist_items` / `task_comments`, which is what shipped. The line also omitted `personal_tasks` (§11.9 puts it in logical 007) and the §11.3.2 QC pair (logical 009) even though the ticket header covers 007–009 — both are built.
- [x] 401.2 FK chain + indices per §11, including the four `project_tasks` partial indices, the `task_submissions`/`task_reviews` `desc` indices, and the UNIQUE `one_review_per_submission`. **"No denormalized shortcuts" holds with the two exceptions §11.3.2 mandates** — `task_reviews.task_id` (scorecard speed) and `task_reviews.submitter_id` (copied at write time). The second is not an optimization: a CHECK constraint sees only the row being written, so without the copy `no_self_review` could not exist in the database at all and §9.7-1 would rest on application code alone. §11 is the more specific document and governs; both columns are documented as deliberate in `db/schema/task-reviews.ts`. **§16.7 should be amended to name these two**, so the next reader does not "fix" them.
- [x] 401.3 DB trigger `pt_no_sa_assignee` attached in drizzle file 0006. The FUNCTION `forbid_super_admin_assignee()` already existed from PUL-201 (file 0003), which deliberately left it unattached until `project_tasks` existed — so this ticket attaches only, never redefines. `DROP TRIGGER IF EXISTS` first, since PG16 has no `CREATE OR REPLACE TRIGGER` and every migration must stay re-runnable.
- [x] 401.4 `seedMinimal` extended with 1 project + 3 tasks (varied status/priority: unassigned `planned`, employee `in_progress`, TL `submitted`), `seedFull` with a second project + 3 more (`approved`, `revision_required`, unassigned `urgent`) and a new `FullSeed extends MinimalSeed` return type. **No assignee is ever `seed_sa`** — 401.3's trigger would reject it and every suite would fail at fixture time. `reset()` truncates all eight new tables FK-safe. The QC tables stay empty until PUL-603 seeds a real submission.

**Done when:** ✅ schema diff vs §11 empty (`drizzle-kit generate` reports no changes; `drizzle-kit check` green); SA-assignee rejected by raw SQL — probed in a rolled-back transaction on INSERT *and* on `UPDATE OF assignee_id`, both raising `super_admin cannot be a task assignee`.

> **Migration numbering: §11.9's logical numbers are not the drizzle file numbers.** They diverged
> when PUL-207 shipped `clients` alone, and this ticket inherits the offset. The mapping:
>
> | §11.9 logical | drizzle file | Contents | Ticket |
> |---|---|---|---|
> | 007 | `0004_clients.sql` | `clients` | PUL-207 |
> | 007 (rest) | `0005_projects_personal_tasks.sql` | `projects`, `personal_tasks` | PUL-401 |
> | 008 | `0006_project_tasks.sql` | `project_tasks` + 3 children + `pt_no_sa_assignee` | PUL-401 |
> | 009 | `0007_qc_trail.sql` | `task_submissions`, `task_reviews` | PUL-401 |
>
> Always read `db/migrations/meta/_journal.json` for the next free index rather than inferring it
> from a §11.9 number. Generated files are renamed to descriptive slugs (drizzle emits names like
> `0006_hard_karma`), with the journal `tag` updated to match.

> **Built in three stages on `feat/pul-401-project-side-tables`; merged in PR #27.** All four
> subtasks are implemented and the full local gate was green (`tsc --noEmit`, ESLint, `vitest run`
> 152 passing, `drizzle-kit check`, mandatory-test manifest).
>
> **No test file was added, and the manifest is unchanged at 13.** This ticket is schema +
> fixtures, and §15.4 lists nothing for it; the constraint probes above were throwaway SQL, not
> regression tests. Three invariants now live only in the database and still owe a test:
> `pt_no_sa_assignee` → **PUL-403.5** (`assign.test.ts`, which §17 already requires to prove
> "both layers"), and `one_review_per_submission` + `no_self_review` → **PUL-603.3**
> (`one-review-per-submission.test.ts`). Do not let those two tickets close without them.

> **Phase-order note.** PUL-401 was taken ahead of Phase 3 (PUL-301…308, all still open) at the
> owner's direction. Its own `Depends` — PUL-101 and PUL-207 — were both satisfied, so nothing
> was built on missing foundations, but §17's "lowest open ticket" rule was knowingly set aside
> rather than overlooked. Phase 3 remains unstarted and Phase 4's later tickets do not depend on
> it; **PUL-305 (atomic sign-out) is still the blocker for PUL-605/606 and the whole EOD chain.**

---

### PUL-402 — Project CRUD + Archive

**Budget:** M · **Reads:** §13.3, §14.3 header · **Depends:** PUL-401

- [x] 402.1 Create-project action (client, name, type, start month) — the manual path; template path is Phase 5
- [x] 402.2 Edit-project action (name, dates)
- [x] 402.3 Archive action: `GATE:pending_reviews` when any task is `submitted`; archived projects read-only, out of default filters. Reverse `unarchiveProject` (§13.3.4) shipped alongside.
- [x] 402.4 Tests: CRUD + archive gate + audit — `create-project`, `update-project`, `archive-project`, `unarchive-project` `.test.ts` in `features/projects/`

**Done when:** ✅ archiving with a pending review is impossible and the toast names the task (the GATE message names the first `submitted` task; the full list rides in `meta.tasks`).

> **Merged in PR #28.** 402.3's **UI landed in PUL-408.2** — Archive sits in the project header's
> ⋯ overflow (MGR only, hidden rather than disabled), and `GATE:pending_reviews` reaches the user
> through `showErrorToast` verbatim, since the action's message already names the blocking task.
> `unarchiveProject` still has no UI: nothing surfaces archived projects yet, because
> `activeProjectsQuery` keeps them out of every picker by design.

---

### PUL-403 — Create-task + assign-task actions (§13.4.1, §13.4.3)

**Budget:** M · **Reads:** §13.4.1, §13.4.3 · **Depends:** PUL-401

- [x] 403.1 Create-task: full §13.4.1 field set; category pre-fill support (server side: `category` is a free-text input; the pre-filled picker is UI and lands with the Task Detail / create-task UI)
- [x] 403.2 Assign: active non-SA only; app check + DB trigger (401.3) both
- [x] 403.3 No self-claim exists anywhere (§13.4.3 — managers assign; verify no such action) — verified and recorded in the `assignTask` docblock; `assign.test.ts` doubles as the proof
- [x] 403.4 Assignment notifies the assignee
- [x] 403.5 Test: `features/projects/assign.test.ts` (SA rejected at both layers) → CI manifest

**Done when:** ✅ both enforcement layers proven in one test file.

> **Merged in PR #29.** Also ships `create-task.test.ts`.

---

### PUL-404 — Status pill + transition matrix + dependency guard

**Budget:** L · **Reads:** §14.3.2, §13.4.4, §13.4.6 · **Depends:** PUL-403

- [x] 404.1 Shared `<StatusPill>`: exact labels/colors per §14.3.2 (Approved gets the check-shield; Completed doesn't) — **built in PUL-407** (`features/projects/components/status-pill.tsx`; label/color map in `display.ts`, typed `as const satisfies Record<TaskStatus, …>` so an unlabelled status is a compile error)
- [x] 404.2 Dropdown option sets per role; locked states read-only; "Done (Approved)" **absent** from the dropdown (`GATE:use_review`) — **server half in PR #30, UI in PUL-407.** `statusMenuOptions()` in `display.ts` is the pure per-role option table (unit-tested); the locked states return `[]` so the pill renders read-only.
- [x] 404.3 MGR "Completed" = explicit QC bypass, audited as `status_overridden`
- [ ] 404.4 Dependency guard: unresolved dependency renders Blocked + lock + tooltip naming the dependency; server rejects transitions on blocked tasks — **UI half done in PUL-407** (`<StatusPill dependencyBlocked>` renders the Blocked color + lock icon + a tooltip naming the upstream task, driven by `DEPENDENCY_SATISFIED_STATUSES`). **The server half is still open and is the real gap:** `changeTaskStatusOpen` does not read `depends_on`, and §13.4.6's dependency gate must land before PUL-601 `submitTask`. (The stored `blocked` status is a separate thing; the dependency lock is display-only and never stored. See the `OPEN_STATUSES` docblock.)
- [x] 404.5 Revision requires a note (modal) — **server half in PR #30, modal in PUL-407.** `RevisionNoteDialog` collects the note; empty is blocked client-side and `GATE:note_required` remains the enforcement.
- [x] 404.6 Test: `features/projects/status-transitions.test.ts` — every legal + illegal transition per role → CI manifest

**Done when:** ✅ the transition test enumerates the full matrix (open §13.4.4 and protected §13.4.5, per role, plus the optimistic lock).

> **Merged in PR #30 — server half only.** `changeTaskStatusOpen` (the reference optimistic-lock
> implementation) and `setTaskStatusProtected` shipped with their mandatory test, so the "Done
> when" is met.
>
> **UI half landed in PUL-407**, as predicted: 404.1 (`StatusPill`), 404.2 (per-role dropdown),
> 404.4's *render*, and 404.5's modal all shipped with the Task Detail modal.
>
> **404.4's server guard is the one thing still open on this ticket** — `changeTaskStatusOpen`
> still does not read `depends_on`. It must land before PUL-601 `submitTask`, whose §13.4.6 gates
> include the dependency check. Until then the dependency lock is display-only: the modal shows a
> blocked pill, but nothing server-side refuses a transition on an unmet dependency.

---

### PUL-405 — Subtask + checklist actions

**Budget:** M · **Reads:** §14.3.3, §16.8 · **Depends:** PUL-403

- [x] 405.1 Subtasks: add / toggle / remove (assignee + MGR); audited (`subtask_added/_toggled/_removed`) — actions in PR #31; UI in PUL-407 Stage 3b
- [x] 405.2 Checklist: toggle (assignee/MGR), add/delete (MGR only); audited — actions in PR #31; UI in PUL-407 Stage 3b (the add/delete affordances are **hidden**, not merely disabled, for anyone without `checklist_manage`)
- [x] 405.3 Both locked while `submitted` — enforced by `guardTaskChildEdit` (`GATE:locked`) and mirrored in the UI by `taskCapabilities()`. **Managers are deliberately exempt** from the lock; non-managers are not.
- [ ] 405.4 **Checklist gates submission; subtasks never do** — the distinction from §14.3.3, asserted in tests — **half done.** `checklistComplete()` (the predicate §13.4.6 will consume) shipped with tests, and no subtask ever gates anything. The *gate itself* cannot be asserted until PUL-601 `submitTask` exists.
- [x] 405.5 Integration tests for all six actions + locks — `features/projects/subtask.test.ts` (22 cases) and `checklist.test.ts` (22 cases), covering permissions, the submitted lock and archived projects

**Done when:** the gate/informational distinction is proven by a test that submits with unchecked subtasks (passes) and unchecked checklist (refused).

> **Actions merged in PR #31; UI in PUL-407 Stage 3b.** Everything on this ticket is done except
> **405.4's submit-gate assertion, which is blocked on PUL-601** — there is no `submitTask` to
> call, so the "Done when" test cannot be written yet. Leave this ticket open until PUL-601 lands
> and that test is added; the predicate and both actions are ready for it.

---

### PUL-406 — Comments action

**Budget:** S · **Reads:** §14.3.3 · **Depends:** PUL-403

- [x] 406.1 Add-comment action — **always open regardless of status** (the one thing never locked) — UI composer in PUL-407 Stage 3b
- [x] 406.2 Notifies assignee when commenter ≠ assignee — plus the latest submission's reviewer (scoped in `c1b0d00`)
- [x] 406.3 Tests: comment on a `submitted` task succeeds; notification asserted — `features/projects/comment.test.ts` (20 cases)

**Done when:** comments post on locked tasks; assignee is notified. ✅

> **Merged in PR #32; UI in PUL-407 Stage 3b.** The one state that *does* close comments is an
> **archived project** — `addComment`'s only guard is `guardProjectNotArchived`, so the composer is
> replaced by an explanation there. That is not a status lock and does not contradict 406.1.

---

### PUL-407 — Task Detail modal

**Budget:** L · **Reads:** §14.3.3, §14.15 r.2 & 11 · **Depends:** PUL-404…PUL-406

- [x] 407.1 Header: title, project · category · month, pill, priority, **`Due: Aug 8, 2026 · Today`** (`fmtDate` — build the helper here, it's the canonical one), assignee + MGR Assign ▾ — `lib/format.ts` (`fmtDate` / `fmtHM`, unit-tested with a frozen clock) is the canonical helper. "Month N" is omitted entirely when `month` is null.
- [x] 407.2 Sections in §14.3.3 order: description/SOP/expected output → checklist `(3/5)` → subtasks `(2/4)` + inline "+ Add subtask" (Enter adds) → actual `HMInput` → proof → comments → submission & review history — **all sections render; two stay READ-ONLY by design:** actual time and proof. `logActualHours` and the Submit modal are PUL-601, so the `HMInput` and the proof input are deliberately **not** built here (there is no task-level proof column — proof belongs to a submission).
- [x] 407.3 `submitted` lock banner exact copy: _"Awaiting review — checklist, subtasks and hours are locked. Comments stay open."_
- [x] 407.4 `CONFLICT` on stale write → refresh toast — every mutation runs through one `run()` helper that re-fetches on success **and** on CONFLICT, so the held `version` stays current (without it, a second status change in a row would conflict against a row nobody else touched).
- [ ] 407.5 Manual QA: assignee, non-assignee EMP, MGR, dependency-blocked — **in progress.** `app/dev/task-detail` + `qa-states.sql` (prod-guarded; originally throwaway until PUL-409, now **kept** as the isolated-modal harness + shared QA fixtures — see PUL-409's note) arrange every state: submitted, approved, completed, cancelled, unmet dependency, unassigned and an archived project. First QA pass found the Assign trigger rendering a user **id** instead of a name (`6a83f54`).

**Done when:** every §14.3.3 behavior demonstrable from this one modal.

> **Built in four commits across three stages** (`ee19db9` query + formatters → `fa9e0a6` read-only
> shell → `f17fb2c` header controls → `4159fa5` body controls, plus `6a83f54` QA fix).
>
> **It absorbed the UI half of three earlier tickets**, as PUL-404's note predicted: 404.1/404.2/
> 404.4-render/404.5, all of 405.1–405.3's UI, and 406.1's composer.
>
> **Two pieces of shared machinery came out of it**, both pure and unit-tested in the node lane,
> and both intended for Board/List/Calendar to reuse rather than re-derive:
> - `features/projects/display.ts` — the §14.3.2 label/color map, the per-role dropdown option
>   sets, and `isManagerRole()`.
> - `features/projects/capabilities.ts` — `taskCapabilities()`, the four body booleans, **derived
>   from `can()`** rather than restating §9.6, with only the two row-state locks (archived,
>   post-submission) layered on. Computed server-side inside `loadTaskDetail`, because `lib/authz`
>   reaches `next/headers` and the db client and must not enter a client bundle.
>
> **Base UI gotchas worth not re-learning** (both cost a QA cycle): a controlled `Dialog` never
> fires `onOpenChange` on the way *in*, so the fetch hangs off a body that mounts-and-keys instead;
> and `Select.Value` left bare renders `String(value)` — the raw id — unless given a children
> function. The second shipped as a visible bug (fixed here and in `offboarding-dialog.tsx`, which
> had the identical user-id leak).
>
> **Known open defect, same root cause, not fixed here:** five bare `<SelectValue />` call sites
> still render a raw enum value instead of its label — `add-employee-dialog.tsx:156` and
> `employee-detail-sheet.tsx:343` (show `project_manager`, not "Project Manager"),
> `employees-grid.tsx:138` and `clients-section.tsx:110` (show `active`, not "Active").
> `employees-grid.tsx:121` is harmless (value === label). Each is a one-line
> `{(v) => LABELS[v]}` fix in another ticket's surface; needs a home in Phase 8 polish.
>
> **Moved in PUL-410 Stage 1:** Stage 3a's status dropdown + revision-note modal now live in
> `task-status-control.tsx` as `<TaskStatusControl>`. The modal renders it, with the same
> behavior. See PUL-410's note.
>
> **Still open:** 407.5 manual QA, and the 404.4 **server** dependency guard, which this ticket
> did not close and PUL-601 depends on.

---

### PUL-408 — Filter bar + project header

**Budget:** M · **Reads:** §14.3 · **Depends:** PUL-402, PUL-110

- [x] 408.1 Filter bar: Client ▾ · Project ▾ (client-scoped) · Month ▾ · Assignee ▾; state in the upfront-declared store (§16.10 — no lazy init) — one `FilterState` object, all five keys (the four filters + `tab`) declared with real values from the first render. Every field is a **string**, including `month`, so the one string↔number conversion happens at the query boundary (`toFilters`) rather than in each handler. Cascade: client resets project + month, project resets month.
- [x] 408.2 Header: breadcrumb `📁 Client › Project · type · Month N`, progress `9/21 · 43%` + bar, health chip (whole-project calc per §14.3), **+ New Task** (MGR), Archive in overflow (→ 402.3) — `getProjectHeader(projectId)` takes a **projectId, not a `TaskFilters`**, so the header cannot drift onto the filtered set. New Task modal is §14.3.8's, reusing `CreateTaskInput` rather than restating it.
- [x] 408.3 Filters drive one canonical filtered-tasks query shared by all tabs — `getFilteredTasks(filters)` in `features/projects/queries.ts`.

**Done when:** filter changes update every tab identically — **not yet demonstrable: there are no tabs.** The query is shared *by construction* (one function, one call site, `tab` deliberately excluded from the refetch effect's dependencies so switching tabs cannot re-read), but "identically across tabs" becomes provable only once PUL-409/410/411 render it. ~~The assertion belongs in PUL-409, not here.~~ PUL-409 built the Board as a pure presentation of this one result, but a cross-tab check needs a second tab, so **the assertion now lands in PUL-410**.

> **Built in two stages** (`6730885` query + filter bar + page shell → `a9052b7` header + New Task
> modal + Archive overflow).
>
> **`getFilteredTasks` is the canonical list read** — a LIST shape only (no description, comments
> or submissions; a board renders every task at once, so anything added is paid for N times for
> something nobody can read without clicking through). Subtask counts come from a **grouped
> subquery**, not a join onto `task_subtasks`, which would multiply every task row by its subtask
> count. `dependencyBlocked` reuses `DEPENDENCY_SATISFIED_STATUSES` so the board and the pill
> cannot disagree about whether `cancelled` satisfies a dependency (it does not).
>
> **Flagged decision — `completed` and `cancelled` are excluded from the default result.** Both
> are terminal and the board shows active work. `approved` is deliberately **not** excluded: it is
> the normal end of the QC path and a manager needs to see this month's approved work in its
> column. The consequence is that a `completed` task vanishes from every tab with **no "show
> closed" affordance**. If PUL-409/410 needs one it belongs here as an `includeTerminal?` filter
> key, not a second query.
>
> **The §3.1 / §3.1.3 formulas are transcriptions, and two of them are not where you would look
> for them.** §3.1 gives the progress *format* (`X/Y · N%`) but never says which statuses count;
> the binding definition is **§4.1** — "`status === "Completed" || status === "Approved"` is the
> 'done' check throughout the code" — and, for the denominator, §4.1's Cancelled row ("excluded
> from progress and workload"), repeated by §4.2 ("Excluded from progress and health calcs").
> §14.3's printed example `9/21 · 43%` pins **rounding** rather than truncation (9/21 = 42.857…;
> truncating prints 42% and would contradict the spec). §3.1.3's health chain is an **if/elif and
> the order is load-bearing** — 5 overdue + 4 awaiting review is Critical, not At Risk — so it
> ships as an early-return chain with a test on exactly that case. Overdue counts **open tasks
> only** and the comparison is strictly `<`, so a task due today is not overdue.
>
> **`currentMonth` is derived, per §11.2 ("nobody increments it; it's computed").**
> `retainerMonth(startDate, today)` is pure, takes both as `YYYY-MM-DD` Asia/Dhaka strings and
> constructs no `Date`. Month 1 is the start month and the boundary is the **start day, not the
> 1st** (§13.8's anchor). The **day-clamp is handled and is the case that would otherwise be
> wrong**: Jan 31 has no Feb 31, so Month 2 begins Feb 28/29 — comparing against the raw start day
> strands that project in Month 1 for all of February and then jumps it to Month 3 on Mar 31.
>
> **Shared machinery for PUL-409/410/411**, all pure and node-lane tested, in `display.ts`:
> `monthLabel()` (Month ▾ labels), `retainerMonth()`, `progressPct()`, `projectHealth()` +
> `HEALTH_DISPLAY`, and `DONE_STATUSES`. `DONE_STATUSES` is **deliberately not shared with
> `DEPENDENCY_SATISFIED_STATUSES`** although both hold `['approved','completed']` today: they
> answer different questions ("does this count as finished" vs "may the downstream task start")
> and agree by coincidence, not by rule.
>
> **Spec conflict found, resolved conservatively, needs a ruling.** §1–§8 line 208 says the
> assignee filter shows "employees see only themselves". **§14.3 does not restate it, and §13.8
> says the opposite for reads** — "all roles read all active projects (open model)". Per this
> file's precedence (§9–§17 over §1–§8), it shipped as a **picker convenience only**: an
> employee's Assignee ▾ lists All / Unassigned / themselves, while `getFilteredTasks` stays open
> and is **not** scoped by role. Making it a real scope would contradict §13.8 and should be a
> PRD amendment, not a quiet implementation choice.
>
> **Also landed:** `projectMonthsQuery()` — Month ▾'s option *set* comes from the tasks, only the
> *label* from `start_date`, because no "retainer length" is stored and deriving one from
> months-elapsed would offer Month 7 on a project whose tasks stop at Month 3. `startDate` added
> to `PickableProject`. `components/ui/menu.tsx` — a Base UI `Menu` wrapper for the ⋯ overflow
> (no new dependency; `@base-ui/react/menu` was already in the lockfile), styled from `select.tsx`.
> `assignableUsersQuery` is used for Assignee ▾ rather than `activeUsersQuery`, since the SA can
> never hold a task and would be an option that matches no row.
>
> **Two judgement calls for QA to confirm:** the header renders **only when one project is
> selected** (with "all", none of the four crumb parts has a meaning and progress would average
> unrelated engagements — the bar says so instead of drawing em dashes); and an **archived project
> still returns a header**, carrying `status`, so a manager can see what they archived while the
> write affordances hide.
>
> **Still open:** ~~the `/projects` body is scaffolding — a dashed `"N tasks match"` block,
> commented for PUL-409 to delete~~ (deleted in PUL-409; the Board replaced it). The
> Weekly/Monthly export buttons render **inert** (PUL-413).

---

### PUL-409 — Board view

**Budget:** L · **Reads:** §14.3.1 · **Depends:** PUL-407, PUL-408

- [x] 409.1 Kanban by status, columns top-bordered in status color + count chips — six columns in §14.3.1 order (`BOARD_STATUSES` in `display.ts`), labels from `STATUS_DISPLAY`, borders from `BOARD_COLUMN_BORDER`. All six always render, empty ones included. No `completed` / `cancelled` column: `getFilteredTasks` already excludes both.
- [x] 409.2 Card: title · category tag · priority · avatar · **date with year** · **`☑ 2/4` subtask badge** (hidden at zero) · red overdue line — plus a padlock when `dependencyBlocked`. The card date is `fmtDate(due, { relative: false })` (bare `Aug 8, 2026`), so the red `Overdue Nd` line from `overdueDays()` is the card's **one** overdue signal (see note).
- [x] 409.3 Unassigned group pinned on top (managers assign from here) — rendered only when at least one unassigned task matches. **Each task appears exactly once:** an unassigned task sits in this group and NOT also in its status column (see note).
- [x] 409.4 Card → Task Detail; per-column + Add task (MGR) — card opens PUL-407's `TaskDetailModal`; closing it re-reads the list **and** the project header. `+ Add task` reuses PUL-408's `NewTaskModal`, but renders on the **Not Started column only**, not every column — a deliberate deviation from §14.3.1's wording (see note). No `defaultCategory` prefill: board columns are statuses, not categories; that prefill belongs to PUL-410's category groups.

**Done when:** board matches §14.3.1 pixel-for-behavior — **code complete, awaiting Jaki's manual QA.** The open-edit-close loop, `+ Add task`, and the live header are browser-only behavior (no component tests, per §15.2).

> **Built in two stages** (`731c20b` columns + cards + Unassigned group + card → modal → Stage 2:
> header live-refresh, bare card date, `+ Add task`).
>
> **The Board never fetches.** `TaskBoard` takes the filter bar's `tasks` / `loading` as props and
> only draws them. PUL-408's dashed `"N tasks match"` scaffolding is gone and the Board is the
> Board tab's panel; List / Calendar render "lands in PUL-410 / 411" placeholders in the same
> slot, with a comment saying each must receive the same array.
>
> **PUL-408's deferred "Done when" moves on again, to PUL-410.** "Filter changes update every
> tab identically" is now true *by construction* (one array, handed to the one view that
> exists), but it cannot be *shown* across tabs until a second tab renders. PUL-410 is the first
> ticket where it can be checked.
>
> **One refetch counter for the whole page.** The filter bar's `taskNonce` drives the task list
> AND, as of Stage 2, the project header (new `refreshKey` prop on `ProjectHeader`). Closing the
> Task Detail modal, New Task and Archive all bump it, so progress and the health chip move in
> step with the card. The header's own private nonce was **removed**: keeping both would have
> fetched the header twice after every New Task.
>
> **`fmtDate` gained `{ relative?: boolean }`, default `true`.** Only the Board card passes
> `false`. Both `task-detail-modal.tsx` calls pass nothing and render identically. The suffix's
> "· Overdue" also fires on approved work with a past due date. `overdueDays()` doesn't: it is
> strict `<` today and open tasks only, the same rule as the header's health calc (§3.1.3).
>
> **Shared machinery, pure and unit-tested** (`features/projects/board.test.ts`, 15 cases;
> `tests/format.test.ts` +3 for the `relative` option):
> - `groupBoardTasks()` keeps `getFilteredTasks`' order within each column and places every row
>   exactly once.
> - `overdueDays()` counts days with plain integer arithmetic (no `Date`), tested across month,
>   year and leap-day boundaries.
> - `PRIORITY_PILL_CLASSNAME`: §14.3.1 names no priority colors. This is neutral for low/medium,
>   amber for high and red for urgent.
>
> **Two readings of §14.3.1 that need a ruling** (Jaki). Per §16.17, if accepted, §14.3.1
> should be amended rather than left as silent exceptions:
> 1. **`+ Add task` on Not Started only.** §14.3.1 says "at the bottom of each column".
>    `createTask` always yields `planned` (§13.4.1), so a card added from "Working on it" would
>    land in Not Started and read as a bug.
> 2. **Unassigned tasks are not duplicated into their status column.** §14.3.1 says the group is
>    "pinned above the columns" but not whether its tasks *also* appear below. Duplicating them
>    would double-count them in the column chips. Assigning a task is what moves it into a
>    column.
>
> **Gap for QA to confirm:** a selected project with **zero** matching tasks shows the empty state
> ("No tasks match these filters.") instead of columns, so `+ Add task` is absent. The header's
> `+ New Task` covers that case.
>
> **`app/dev/task-detail` is kept, not deleted** (reversing PUL-407.5's "throwaway until
> PUL-409"). It is now the isolated-modal QA harness and reaches tasks the Board never shows
> (`completed`, `cancelled`, archived-project tasks). `qa-states.sql` is the shared fixture for
> it and for Board QA. Its comments were updated to match.

---

### PUL-410 — List view

**Budget:** L · **Reads:** §14.3.4, §16.10 · **Depends:** PUL-407, PUL-408

- [x] 410.1 Collapsible Month → Category → Task tree; month header with done count + "Current cycle" pill; category header with color dot — `groupTaskTree()` in `display.ts`. Months ascend with **Unscheduled** (`month` null) last, categories are alphabetical, tasks keep the query order. `Month N — MonthName` and "Current cycle" (`retainerMonth`) need ONE project; with All projects the header falls back to bare `Month N` with no pill. The color dot is `categoryDotClass()`, a hash of the name into an 8-hue palette.
- [x] 410.2 Row: Task · Owner · Status pill · **Due (`Aug 8, 2026` + suffix + `2/4 subtasks` line)** · Priority · Est · ⋯ — the status pill is the shared `<TaskStatusControl>`, editable inline. The ⋯ menu offers only "Open details": §14.3.4 defines no row actions, so none were invented.
- [x] 410.3 Collapse state declared upfront (§16.10) — one `overrides` object (`{}`) holding only the user's toggles, resolved every render by `treeOpenState()` into a **complete** map (every key present). Defaults: categories open; months open only for the current cycle and Unscheduled. All months open when there is no current cycle (All projects) or only one month on screen. Re-keyed per project, so collapse state resets on a switch.
- [x] 410.4 `+ Add task in {Category}` per open group (MGR); Unassigned banner section — New Task modal with the category pre-filled (§14.3.8). **Unassigned is a banner ("N unassigned"), not a separate section**: unassigned tasks stay in their month and category with an "Unassigned" owner badge, because pulling them out would fragment the hierarchy. The Board pins them because assigning is that view's job.

**Done when:** tree renders and collapses identically to the prototype's list view — **code complete (`cc55fb4`), awaiting Jaki's manual QA.**

> **Inherited from PUL-408 → PUL-409:** "filter changes update every tab identically" is first
> checkable here, as the second tab. Render List from the **same** `tasks` / `loading` the filter
> bar hands the Board (the tab-panel slot in `projects-filter-bar.tsx` has a comment marking it)
> and bump the same `taskNonce` on modal close. No second fetch.

> **Stage 1 — prep, no new UI** (`71fa9f8`). Two changes so 410.2's row could be built.
>
> **1. `<TaskStatusControl>` extracted from the Task Detail modal**
> (`features/projects/components/task-status-control.tsx`). It holds PUL-407 Stage 3a's code,
> moved rather than re-derived:
> - the read-only pill vs. dropdown decision (`statusMenuOptions`, which stays in `display.ts`);
> - routing a choice to `changeTaskStatusOpen` or `setTaskStatusProtected`;
> - the revision-note modal (one instance per control);
> - `showErrorToast` for failures, including CONFLICT;
> - the pill-in-the-trigger fix, so the trigger never goes blank.
>
> Props: `task { id, title, status, version, assigneeId }` · `viewer` (`StatusMenuViewer | null`)
> · `dependencyBlocked?` · `disabled?` · `onBusyChange?` · `onChanged`. The modal now renders it.
>
> The modal's behavior is meant to be **unchanged**, and two couplings were carried over to keep
> it that way:
> - **One busy state across the modal.** The control reports its in-flight state through
>   `onBusyChange`, and the modal combines it as `anyBusy = busy || statusBusy`. A status write
>   still disables Assign ▾ and the body, and vice versa.
> - **CONFLICT still reloads.** `onChanged()` fires on success **and** on CONFLICT, preserving
>   PUL-407.4's "a CONFLICT means reload, so the retry has a fresh version".
>
> No component test covers the modal, so Jaki's manual QA confirms this.
>
> **2. `getFilteredTasks` returns `estimatedHours`** (a `number`, or `null` when unestimated, via
> `hoursOrNull` like `getTaskDetail`) for 410.2's Est column. It has a new case in
> `filtered-tasks.test.ts`. No other query change.
>
> **Stage 2 — the List itself** (`cc55fb4`). It resolved Stage 1's open questions:
> - **`getFilteredTasks` gained `version` and `blockedByTitle`.** `blockedByTitle` is the upstream
>   title only while `dependencyBlocked`, read off the existing upstream join with no new query.
>   It's derived from `dependencyBlocked`, so the two can't disagree. `dependencyBlocked` itself is
>   unchanged, so the Board is unaffected. Both new fields are covered in `filtered-tasks.test.ts`.
>   It's two narrow columns, which justifies widening a LIST shape.
> - **The viewer's `{ id, role }`** is passed page → filter bar → List. Only those two fields
>   cross to the client.
>
> **Still no second fetch.** The List draws the filter bar's `tasks`. An inline status change, a
> modal close and `+ Add task in {Category}` all re-read list + header through `taskNonce`.
> Switching tabs doesn't refetch.
>
> **PUL-408's deferred "Done when" ("filter changes update every tab identically") is now checkable
> by hand**, because List is the second tab. It holds by construction: one array handed to every
> view, and `state.tab` absent from the fetch effect. There is no automated cross-tab test,
> because the views are client components and §15.2 doesn't unit-test those. Confirm it in QA.
>
> **Done counts are "approved of what's shown".** `getFilteredTasks` already hides completed and
> cancelled tasks, so a month's or category's `done/total` will not match the header's
> whole-project progress. That's expected, not a bug.
>
> **Tests:** `list.test.ts` (19, all pure) covers `groupTaskTree` (order, Unscheduled last,
> counts, unique and stable keys), `treeOpenState` (a complete map, defaults, overrides, stale
> keys ignored) and `categoryDotClass`.

---

### PUL-411 — Calendar view

**Budget:** M · **Reads:** §14.3.4 · **Depends:** PUL-407, PUL-408

- [x] 411.1 Month grid, header **`August 2026`** (year always), today highlighted — `calendarGrid()` builds whole weeks, **Sunday first** (the Sun–Thu work week), with the adjacent months' days muted. Today's date number sits in a solid teal circle. "Today" is `dhakaToday()` (the clock port); the viewed month starts there and is split out of the string, never a `Date`.
- [x] 411.2 Category-colored chips → Task Detail — `categoryDotClass()` (shared with the List) plus the truncated title. A chip opens the Task Detail modal; closing it bumps `taskNonce`. Up to 3 chips per day, then "+N more" expands **that** day in place (one at a time). There's no day-detail popover; the List is where a busy day is read in full. Undated tasks can't sit on a day, so a line under the grid counts them rather than letting them vanish.
- [ ] 411.3 Prev/Next = real server-side month navigation (not the demo toast) — **built as REAL navigation, but client-side: needs a ruling (below).** Prev / Next / Today move the viewed month over the filter bar's shared `tasks` array, with no new fetch and no toast.

**Done when:** navigating months returns correct task sets from the server — **met in substance, not in wording; see the ruling below.** Code complete (`f9355fb`), awaiting Jaki's manual QA.

> **Spec conflict, resolved at the owner's direction, needs a ruling** (Jaki). §14.3.4 and 411.3
> say navigation is a *"server-side date shift, not just visual"*. It shipped client-side because
> **`getFilteredTasks` has no date window**: every task matching the filters is already in the
> shared array, so shifting months on the client shows exactly the rows a server shift would
> return. It also keeps the Board / List / Calendar one-array rule (PUL-408.3) intact.
>
> The spec's concern was the prototype's toast, which is fake navigation over no data. This is
> real navigation. **If `getFilteredTasks` ever gains a date window** (e.g. for performance), the
> month shift must move to the server at that point. Either amend §14.3.4 to "real month
> navigation over the filtered set" and tick 411.3, or keep the wording and treat the date window
> as this ticket's trigger.
>
> **Pure, `Date`-free helpers in `display.ts`, unit-tested** in `calendar.test.ts` (17 cases):
> - `calendarGrid`: 4-, 5- and 6-week months, a leap February and the year boundary in the
>   padding, and every day of every 2026 month exactly once;
> - `bucketTasksByDay`: keyed by the stored `YYYY-MM-DD`; undated and malformed dates dropped;
>   a trailing-day cell still finds its task;
> - `shiftCalendarMonth`: Dec → Jan, Jan → Dec, multi-month jumps;
> - `calendarMonthOf` / `calendarMonthTitle`.
>
> **A gotcha worth not re-learning:** `dayNumber()` (from PUL-409's `overdueDays`) has an
> arbitrary epoch, 0000-03-01, not 1970-01-01, because it was only ever used for day
> *differences*. The first grid assumed a Unix epoch and was off by one weekday everywhere. The
> tests caught it. Weekdays are now measured from a known Thursday (1970-01-01); don't read a
> weekday straight off `dayNumber`.
>
> **State:** the viewed month is the one navigation value, declared upfront from `dhakaToday()`
> (§16.10). The component also holds `openTaskId` (the modal) and `expandedDay` (the one "+N
> more" day). It takes only `tasks` / `loading` / `onChanged`; `viewer` and `project` aren't
> props because nothing on a calendar uses them.
>
> **Completed and cancelled tasks don't appear**, because `getFilteredTasks` excludes them (its
> PUL-408 flagged decision). A manager looking for last month's closed work won't find it here.

---

### PUL-412 — `getReviewQueue` + Review tab + Workload tab

**Budget:** L · **Reads:** §13.8, §14.3.5–6, §16.9 · **Depends:** PUL-407

- [x] 412.1 One canonical `getReviewQueue(filters)` (§16.9 — three surfaces, one query) — `features/projects/queries.ts`. Filters `{ projectId?, routedToMe?, sort?: 'newest' | 'oldest' }`: the project tab passes `projectId`, `/review` (PUL-607) passes nothing, the dashboard card (PUL-803) passes `sort: 'oldest'`. `submitted` tasks joined to their **latest** submission; `routedToMe` matches the latest routing hint.
- [x] 412.2 Review tab: columns per §14.3.5, tab-title count, "Routed to me" chip _(decision modal itself is PUL-602)_ — `review-tab.tsx` via `loadReviewQueue`. **Interim:** its Review button opens the Task Detail modal until PUL-602's decision modal replaces it.
- [ ] 412.3 Workload tab (MGR/HR): per-person open count + est hours + on-break live dot; dependency-blocked counts as open — **done except the live dot.** `workload-tab.tsx` via `loadWorkload` shows count, est hours, and a dot that is always grey: `onBreak` is stubbed `false` because attendance (Phase 3) was skipped and there is no breaks table. Closes when PUL-303 wires it (`TODO(Phase 3 / attendance)` in `getWorkload` and the tab).
- [x] 412.4 Test: same filters through the project tab and (future) `/review` page return identical rows — `review-queue.test.ts`, "QUERY IDENTITY".

**Done when:** query identity across surfaces is proven by test — ✅ for three filter sets (default, oldest, routed-to-me) and both seeded projects, the project-scoped result `toEqual`s the agency-wide result filtered to that project: whole rows, in order. The test was checked against a deliberate project-path-only predicate and failed as it should (3 cases), then restored.

> **Built in two stages** (`3aaa7fd` the two queries + identity test → Stage 2: load actions, the
> Review and Workload tabs, role-gated tab strip, QA fixtures).
>
> **First real consumer of `task_submissions`** (unused since PUL-401 Stage 3). The latest
> submission is a `DISTINCT ON (task_id)` over `created_at DESC, id DESC`, riding `sub_task_idx`.
> The `id` tiebreak makes "latest" well-defined when two submissions share a timestamp. A
> `submitted` task with no submission row is left out of the queue: there is nothing to review.
>
> **Review and Workload fetch their own data.** Board, List and Calendar share one task array; these
> two tabs don't, because they read different queries. Each fetches when opened and when the
> project changes. A Review modal close also bumps `taskNonce`, so Board, List and the header stay
> current. The tab-title count (§14.3.5) shows once the Review tab has loaded. Before the first
> visit it shows nothing rather than a guessed number.
>
> **Two access decisions that need a ruling** (Jaki):
> 1. **§9.6 has no workload permission.** §13.8 and §14.3 say "MGR + HR", but there is no
>    `workload.read` row to `authorize()` against. `loadWorkload` therefore calls
>    `authorize('project.read')` first (which keeps the authorize-first rule satisfied), then
>    role-checks SA/TL/PM/HR → otherwise `FORBIDDEN`.
>    `lib/authz.ts` was **not** extended, because it must match §9.6. The fix is a §9.6
>    amendment adding `workload.read`, after which the action becomes
>    `authorize('workload.read')`.
> 2. **`getReviewQueue` applies the `review.read` row scope inside the query**, unlike every other
>    read in this slice (whose file header puts gates at the call site). §9.6 gives managers and
>    HR every row, but an employee **only their own** (`self`). That is a row filter rather than a
>    gate, and §13.8 says queries apply §9.6 scope, so it lives in the one query all three
>    surfaces share. `loadReviewQueue` authorizes `review.read` too, and with no resource the
>    employee's `self` cell fails closed. So an employee is refused at the action, and the
>    in-query scope is defense in depth.
>
> **Tab visibility** is now an explicit `visibleTo` role list per tab in `projects-filter-bar.tsx`
> (the `lib/nav.ts` convention, not a live `can()`). Board/List/Calendar are visible to all roles,
> Review and Workload to SA/TL/PM/HR. Hiding a tab is cosmetic: both actions refuse employees
> anyway. Manager QA (SA + TL) is **not** offered; it is PUL-604.
>
> **`getWorkload` scope.** It supports agency-wide and per-project. It counts open statuses (not
> approved/completed/cancelled) on active projects. Dependency-blocked tasks count, with no special
> handling, because the lock never rewrites the stored status.
>
> It deliberately does not count or show:
> - **unassigned tasks**: there's no one to attribute them to;
> - **idle people**: rows are grouped from tasks, so someone with no open work is absent rather
>   than a `0` row. Decide whether the tab should list idle people too.
>
> A deactivated user who still holds open work **does** appear, which is the orphaned work a
> manager needs to see.
>
> **Proof links** render only for `http(s)` values. `proof_value` is text an employee typed, and
> putting an arbitrary string into `href` is how a `javascript:` value gets clicked.
>
> **Tests:**
> - `review-queue.test.ts` (19): base set, latest-wins, both sorts, routed-to-me,
>   archived/soft-deleted exclusions, row shape, role scope, and the identity block;
> - `workload.test.ts` (10);
> - `load-review-workload.test.ts` (6): both actions let SA/TL/PM/HR through and refuse employees
>   with FORBIDDEN; the project filter is passed through; a bad filter fails validation.
>
> **QA fixtures:** `app/dev/task-detail/qa-states.sql` now adds:
> - `qa_reviewer`, a project manager used only as a routing target;
> - two submissions on `qa_submitted`: an older one routed to `qa_reviewer`, and the latest routed
>   to whoever you QA as;
> - a new `qa_submitted_2`, routed to `qa_reviewer` only.
>
> Expected Review tab: **2 rows, and 1 with "Routed to me" on.** The cleanup removes
> submissions/reviews before tasks and users. The file was dry-run on the test DB in a rolled-back
> transaction.

---

### PUL-413 — Weekly / Monthly Excel exports

**Budget:** M · **Reads:** §13.8, §14.3 · **Depends:** PUL-408

- [ ] 413.1 Server-side client-safe exports (columns per §13.8 — internal fields excluded)
- [ ] 413.2 Buttons in the filter bar (MGR only) — **the slot already exists.** PUL-408.1 renders both buttons MGR-only and **inert** (`disabled`, titled "Exports land in PUL-413"), so this is a wiring change, not a layout change.
- [ ] 413.3 Test: export rows byte-match on-screen rows for a fixed range

**Done when:** a manager downloads a client-sendable Excel from staging.

> **Note for 413.1's "on-screen rows":** the on-screen set comes from `getFilteredTasks`, which
> **excludes `completed` and `cancelled`** (PUL-408's flagged decision). §3.1.7's client-safe rule
> is "only completed/approved/in-progress" — so the export's row set is *deliberately not* the
> board's, and 413.3's byte-match must compare against an explicitly-scoped query rather than
> assuming the two agree.

---

**Phase 4 exit:** full manual project management works; PUL-205's blocker-list now covers real open tasks (extend that test).

---

# Phase 5 — Templates & Start Project (6 tickets)

---

### PUL-501 — Template tables (migration 010)

**Budget:** M · **Reads:** §11 (010), §14.4, §16.7 · **Depends:** PUL-401

- [ ] 501.1 `templates`, `template_months`, `template_cats`, `template_tasks`, `template_task_subtasks` — strict FK chain (task→cat→month→template; no orphans possible)
- [ ] 501.2 Month rows carry `num`, `name`, `start_month`, `start_day`
- [ ] 501.3 Seed the three demo templates (with subtasks) from the prototype into `seedFull`

**Done when:** hierarchy is FK-enforced; schema diff vs §11 empty.

---

### PUL-502 — `tplAllTasks` walker

**Budget:** S · **Reads:** §14.4, §16.7 · **Depends:** PUL-501

- [ ] 502.1 The canonical flattener → `[{...task, _catName, _monthNum}]`; **the only** way to flatten (no parallel caches)
- [ ] 502.2 Test: `features/templates/hierarchy-walker.test.ts` — every task visited exactly once, correct parents → CI manifest

**Done when:** round-trip proof on a 3-month fixture.

---

### PUL-503 — Template CRUD + detail view

**Budget:** L · **Reads:** §14.4.1–2, §14.4.4–5 · **Depends:** PUL-502, PUL-110

- [ ] 503.1 Grid page per §14.4.1: cards (category badge, name, desc, role pills, `N tasks · N months · N roles · N QC gates`), View / Start Project / delete
- [ ] 503.2 New Template modal → empty template → straight into detail
- [ ] 503.3 Detail view per §14.4.2: header card, breadcrumb hint, collapsible month → category → task tree with `└ N.M` subtask rows, all inline add/rename/delete
- [ ] 503.4 Add/Edit Task modal per §14.4.4 incl. the subtask panel (+ Create subtask, live list, one Save writes all)
- [ ] 503.5 All mutations = audited actions; collapse state upfront-declared
- [ ] 503.6 Manual QA of the full hierarchy edit flow

**Done when:** a template with 2 months, 3 categories, tasks + subtasks is buildable entirely from this UI.

---

### PUL-504 — Add Month wizard (12-month cascade)

**Budget:** L · **Reads:** §14.4.3 · **Depends:** PUL-503

- [ ] 504.1 3-step modal (indicator: Set month & date → Add categories → Add tasks & subtasks); in-memory state; Cancel discards
- [ ] 504.2 Step 1: start-month ▾ + start-day ▾ (28/29/30/31 dynamic, auto-clamp), info banner, live label, 12-month cascade preview ("Filling out now" / "Auto-created")
- [ ] 504.3 Step 2: category builder + preset datalist + duplicate refusal
- [ ] 504.4 Step 3: category tabs with live counts, task cards with inline subtask inputs, quick-add panel, `N tasks · N subtasks · N categories` banner
- [ ] 504.5 Save: Month 1 full + Months 2–12 empty scaffolds with cascaded clamped dates; Month 1 auto-expands
- [ ] 504.6 Test: `features/templates/add-month-wizard.test.ts` (12 months, correct dates, Feb clamp) → CI manifest

**Done when:** picking Sep 10 yields `Month 2 — October 10` … `Month 12 — August 10` with zero manual month creation.

---

### PUL-505 — Due-rule computation

**Budget:** M · **Reads:** §3.2, §13.6.1 · **Depends:** PUL-501

- [ ] 505.1 Pure fn: (`ruleKind`, `ruleVal`, `ruleRef`, project start, deadline, holidays) → date; Sun–Thu week; weekend/holiday shifts
- [ ] 505.2 `After task #` resolves the dependency's computed date
- [ ] 505.3 Test: `features/templates/due-rule-compute.test.ts` — all three kinds + shift edges → CI manifest

**Done when:** shifted dates match hand-computed fixtures.

---

### PUL-506 — Start Project wizard

**Budget:** L · **Reads:** §14.3.8 · **Depends:** PUL-503, PUL-505, PUL-402

- [ ] 506.1 4 steps per §14.3.8: client+name → dates → role→person mapping (unassigned allowed) → scrollable preview (`#N · title with [Client] · category · role · rule pill · QC badge`)
- [ ] 506.2 Generate: walk `tplAllTasks`; clone with `_catName`, `_monthNum`, `{{ClientName}}` substitution, subtasks as `{id,title,done:false}`, checklist, computed due
- [ ] 506.3 Navigate to new project, list tab, month filter cleared; toast with counts
- [ ] 506.4 Test: `features/templates/start-project.test.ts` (tokens, subtask cloning, cat/month carry-over) → CI manifest

**Done when:** template → live project in under a minute on staging, every task correct.

---

**Phase 5 exit:** the recurring-cycle promise is real: build once, launch in a minute.

---

# Phase 6 — QC, Review & EOD (7 tickets)

---

### PUL-601 — Submit action (§13.4.5)

**Budget:** M · **Reads:** §13.4.5, §16.8 · **Depends:** PUL-405

- [ ] 601.1 Gates in order: dependency → checklist (`GATE:checklist_incomplete`, names items) → proof (`GATE:proof_required`)
- [ ] 601.2 Writes submission row (summary, hours, issues, reviewer hint = least-loaded default); status → `submitted`; locks engage
- [ ] 601.3 Reviewer notified
- [ ] 601.4 Test: `features/projects/submit.test.ts` (happy + each gate + blocked) → CI manifest

**Done when:** every refusal names its exact cause.

---

### PUL-602 — Review Decision modal + action

**Budget:** L · **Reads:** §13.4.5, §14.3.5 · **Depends:** PUL-601, PUL-412

- [ ] 602.1 Modal: time vs estimate, proof, summary, issues, read-only checklist; 1–5 stars (click-again unsets); note
- [ ] 602.2 Approve → `approved` (check-shield); Request Revision → note required inline → `revision_required`, note on task
- [ ] 602.3 Self-review rejected (`FORBIDDEN`); assignee notified either way
- [ ] 602.4 Test: `features/projects/review.test.ts` → CI manifest

**Done when:** both decisions round-trip with audit + notification.

> **Inherited from PUL-412:** the Review tab's **Review** button (`review-tab.tsx`) currently
> opens the Task Detail modal as a stand-in. Re-point it at this modal. `ReviewQueueRow` already
> carries the task's `version` for the decision's optimistic lock.

---

### PUL-603 — One-review-per-submission invariant

**Budget:** M · **Reads:** §9.4 inv.5 · **Depends:** PUL-602

- [ ] 603.1 DB unique index (submission_id) + app pre-check
- [ ] 603.2 Loser of a race gets `CONFLICT` → _"Already reviewed by {name} just now."_
- [ ] 603.3 Test: `features/projects/one-review-per-submission.test.ts` — two parallel reviews: one wins, one conflicts → CI manifest

**Done when:** the race test is deterministic and green.

---

### PUL-604 — Manager QA tab + meta-rating (§14.3.7)

**Budget:** M · **Reads:** §14.3.7, §13.4.8 · **Depends:** PUL-602

- [ ] 604.1 SA + TL only (nav + server); scorecard: Reviewer · Reviews · Revisions · Avg given · Avg meta received
- [ ] 604.2 Review log; meta ▾ 1–5; own-review dropdown disabled; audited
- [ ] 604.3 Spot-check button highlights a random row

**Done when:** PM/HR/EMP cannot reach it even by URL.

---

### PUL-605 — EOD immutability + acknowledge (§13.5.7)

**Budget:** M · **Reads:** §13.5.7, Amendment H · **Depends:** PUL-305

- [ ] 605.1 DB: no UPDATE grant on EOD content columns; ack lives in separate columns/row (reviewed_at/by, flagged, manager_note)
- [ ] 605.2 Acknowledge (✓) and Flag (🚩 + required note) actions; employee notified on flag
- [ ] 605.3 Tests: `features/eod/immutability.test.ts` + `features/eod/acknowledge.test.ts` → CI manifest

**Done when:** content is DB-immutable; ack is a separate audited act.

---

### PUL-606 — EOD page `/eod`

**Budget:** M · **Reads:** §14.8 · **Depends:** PUL-605, PUL-110

- [ ] 606.1 EMP: own reports newest-first (date, done/total, hours, excerpt, ack state); **no edit affordance exists**
- [ ] 606.2 MGR/HR: employee ▾ + range + **Unreviewed only** (default ON); detail drawer with Mark reviewed / Flag
- [ ] 606.3 No score anything, anywhere (Amendment H)

**Done when:** manual QA both roles; drawer actions round-trip.

---

### PUL-607 — `/review` standalone page

**Budget:** S · **Reads:** §14.3.5 · **Depends:** PUL-602

- [ ] 607.1 Same component as the project tab, agency-wide scope, via `getReviewQueue`
- [ ] 607.2 Dashboard "overdue reviews" card target (card itself in PUL-803)
- [ ] 607.3 Extend the 412.4 identity test to cover this page

**Done when:** identical rows across all three surfaces, proven.

---

**Phase 6 exit:** assign → work → submit → review → approve runs end-to-end on staging.

---

# Phase 7 — Leave (7 tickets)

---

### PUL-701 — Leave tables + quotas (migration 011)

**Budget:** S · **Reads:** §11 (011) · **Depends:** PUL-101

- [ ] 701.1 `leave_requests`, `leave_quotas` per §11 (halves as 0.5; First/Second flag)
- [ ] 701.2 Quota seeding for existing employees + on-add hook (extend PUL-202)

**Done when:** schema matches; every employee has quotas.

---

### PUL-702 — Working-day + holiday math (§13.6.1)

**Budget:** M · **Reads:** §13.6.1 · **Depends:** PUL-701, PUL-108

- [ ] 702.1 Pure fn: range + half-flags → working days (Sun–Thu, holidays skipped, Asia/Dhaka)
- [ ] 702.2 Tests: `workday-math` + `holiday-shift` + `half-day` (weekend start, holiday-crossing, 0.5 rendering) → CI manifest ×3

**Done when:** all edges match hand-computed fixtures.

---

### PUL-703 — Request-leave action + live preview

**Budget:** M · **Reads:** §13.6.2, §14.9 · **Depends:** PUL-702

- [ ] 703.1 Modal: type ▾, dates, First/Second radio when Half-day, reason
- [ ] 703.2 Server preview query → _"Counts as 2.5 days · 5.5 remaining"_ — same fn as submission (identity test)
- [ ] 703.3 Over-balance → `GATE` naming remaining

**Done when:** preview and post-submit numbers can never disagree (shared code + test).

---

### PUL-704 — Approve / reject + self-decision guard

**Budget:** S · **Reads:** §13.6.3 · **Depends:** PUL-703

- [ ] 704.1 Decide actions; own rows' buttons hidden AND server-rejected
- [ ] 704.2 Approval decrements balance in the same tx; requester notified
- [ ] 704.3 Integration test incl. self-decision block

**Done when:** a manager cannot decide their own leave by any path.

---

### PUL-705 — Reversal, SA/HR only (§13.6.4)

**Budget:** M · **Reads:** §13.6.4 · **Depends:** PUL-704

- [ ] 705.1 Reverse action: required comment; restores balance; links original decision in audit
- [ ] 705.2 Test: `features/leave/reversal.test.ts` → CI manifest

**Done when:** reversal round-trips balance and audit trail.

---

### PUL-706 — Leave page `/leave`

**Budget:** M · **Reads:** §14.9 · **Depends:** PUL-703…PUL-705, PUL-110

- [ ] 706.1 Balances strip (halves rendered `7.5`); request modal; table (type, dates, days, reason, status, decider, comment)
- [ ] 706.2 Pending: Cancel (own) / Approve-Reject (MGR/HR, self hidden); decided: Reverse… (SA/HR)
- [ ] 706.3 Manual QA all roles

**Done when:** the full lifecycle works from this page.

---

### PUL-707 — Half-day timer target wiring

**Budget:** S · **Reads:** §14.2, §10 · **Depends:** PUL-704, PUL-304

- [ ] 707.1 `getMyTimer` reads today's approved half-day → target `3h 30m`; ring + copy adapt
- [ ] 707.2 Remove the `TODO(PUL-707)` from PUL-304.3
- [ ] 707.3 Extend `timer.test.ts`: frozen clock + approved half-day → green at 3h 30m

**Done when:** the cross-phase dependency is closed and tested.

---

**Phase 7 exit:** leave lifecycle complete including halves and reversal; timer honors half-days.

---

# Phase 8 — Dashboards, Notifications & Polish (9 tickets)

---

### PUL-801 — Notifications table + real adapter (migration 012)

**Budget:** M · **Reads:** §11 (012), §13.9 · **Depends:** PUL-107

> **DECIDED (Phase 1) — delivery is Discord + email.** The chat target is **Discord**, not Slack (the
> team already works there), and **email is a second delivery channel** added here; its adapter is
> still TBD (Resend / SendGrid / etc.). The mechanism is unchanged — `webhook_outbox` + the Render
> worker, with a Discord webhook URL in place of a Slack one. The `notify()` port built in PUL-107
> (`notify({ to, type, data? })`, the 18 §13.9 types) is **unchanged** by this: that is the whole
> point of §16.11, and 801.1's "zero action edits" still holds.

- [ ] 801.1 Migration 012; swap the stub adapter for the DB adapter — **interface unchanged**, zero action edits
- [ ] 801.2 Discord webhook adapter behind the same port, delivered from `webhook_outbox` by the Render worker
- [ ] 801.3 **Email adapter** behind the same port (second channel; pick the provider here)
- [ ] 801.4 Existing `expectNotified` assertions now hit the real table — full suite still green

**Done when:** adapter swap touches zero feature files.

---

### PUL-802 — Notification panel + mark-read

**Budget:** M · **Reads:** §14.1 · **Depends:** PUL-801, PUL-110

- [ ] 802.1 Bell badge live count; slide-in panel newest-first with type badges
- [ ] 802.2 Per-item mark-read + Mark all read; optimistic with rollback (§16.15 — reads are safe)

**Done when:** an unread notification appears within one poll of the triggering action.

---

### PUL-803 — AdminDashboard

**Budget:** L · **Reads:** §14.2 · **Depends:** PUL-308, PUL-412, PUL-606, PUL-802

- [ ] 803.1 KPI row: Active clients · Live projects · Tasks due today · Team present
- [ ] 803.2 Recent EOD list (ack states) → drawer; Overdue submissions (queue, oldest) → `/review`
- [ ] 803.3 Attendance snapshot → `/attendance`; 7-day tasks-approved bar (honest data, no scores); notifications feed (8)
- [ ] 803.4 Every number from a canonical query — nothing computed in the component

**Done when:** each card's number matches its destination page exactly.

---

### PUL-804 — EmployeeDashboard

**Budget:** M · **Reads:** §14.2 · **Depends:** PUL-707, PUL-410

- [ ] 804.1 Timer card centerpiece (PUL-304/707 component reused, not re-implemented — §16.9)
- [ ] 804.2 Upcoming tasks 7-day table: **date with year + relative line + subtask progress**; revision badge
- [ ] 804.3 Leave balances strip; notifications feed
- [ ] 804.4 Role branch at `/dashboard`: one route, two components

**Done when:** switching roles at the same URL yields the right dashboard.

---

### PUL-805 — Daily Plan page `/daily-plan`

**Budget:** M · **Reads:** §14.7 · **Depends:** PUL-305

- [ ] 805.1 EMP: own plan by date; today's rows editable while signed in; + ad-hoc; mid-day edits never touch project tasks (sync only at sign-out)
- [ ] 805.2 MGR/HR: employee ▾ (All) + date, read-only, titles → Task Detail

**Done when:** the mid-day-edit isolation is verified by test.

---

### PUL-806 — My Tasks page `/my-tasks`

**Budget:** S · **Reads:** §14.10 · **Depends:** PUL-110

- [ ] 806.1 Private checklist (title, client ▾, due, done); MGR/HR-only route
- [ ] 806.2 **No audit** — documented exception (personal scratchpad; §14.10)

**Done when:** rows are invisible to any other user, including SA.

---

### PUL-807 — Empty-states pass

**Budget:** M · **Reads:** §14.15 r.4 · **Depends:** all pages above

- [ ] 807.1 Inventory every table/queue/list; add a one-line-explained empty state to each
- [ ] 807.2 Shared `<EmptyState>`; screenshot review of all states

**Done when:** no surface ever shows a blank rectangle.

---

### PUL-808 — Mobile viewport pass

**Budget:** L · **Reads:** §14.15 r.10 · **Depends:** PUL-308, PUL-804

- [ ] 808.1 360px audit of: sign-in page, timer, sign-in/out modals, break buttons, dashboards
- [ ] 808.2 Fix breakpoints; boards/reports may h-scroll (acceptable per spec)
- [ ] 808.3 One real phone test of the full daily loop, portrait + landscape

**Done when:** an employee at a client site completes the daily loop on a phone.

---

### PUL-809 — Forbidden-words CI grep

**Budget:** S · **Reads:** §16.12, Amendment I · **Depends:** PUL-003

- [ ] 809.1 `.forbidden-words.json`: "Completed" in `features/attendance/**` + `features/daily-plan/**`; "Score"/"score" in `features/**` UI strings
- [ ] 809.2 CI step; test-PR with a violation is blocked

**Done when:** the banned words are mechanically unshippable.

> **Do not widen the "Completed" glob to `features/**`.** PUL-407 ships a deliberate,
> **manager-only** menu label `"Done (Completed)"` in `features/projects/display.ts`
> (`statusMenuLabel`), which §14.3.2 specifies verbatim to distinguish it from "Done (Approved)".
> CLAUDE.md's rule is scoped to *employee-facing* labels, and this is the manager choosing an
> explicit QC bypass — exactly who should see the word. The two globs above are correct as
> written; widening them would either break CI or invite someone to "fix" a correct label.

---

**Phase 8 exit:** the app feels shipped: dashboards live, notifications flow, mobile works, no dead ends.

---

# Phase 9 — Reports, Audit & Settings (3 tickets)

---

### PUL-901 — Reports page `/reports`

**Budget:** L · **Reads:** §14.11, §13.8 · **Depends:** PUL-602, PUL-308, PUL-706

- [ ] 901.1 Delivery: approved per person/project over range; revision rate; **median review turnaround per reviewer**
- [ ] 901.2 Attendance: late count, avg net hours, break-exceeded days, early/auto flags per person
- [ ] 901.3 Leave: usage vs quota
- [ ] 901.4 Server-side exports each tab; byte-match test vs on-screen
- [ ] 901.5 Zero score artifacts (Amendment H)

**Done when:** all three tabs + exports agree with their source pages.

---

### PUL-902 — Audit Log page `/audit`

**Budget:** M · **Reads:** §14.13, §9.6 ⁶ · **Depends:** PUL-102, PUL-110

- [ ] 902.1 Filters (actor ▾, resource type ▾, id, range); table with expandable before→after JSON diff; pagination
- [ ] 902.2 HR silently scoped to leave/employee rows — no toggle, URL-fiddling proof
- [ ] 902.3 Test: `features/audit/audit-scoping.test.ts` → CI manifest
- [ ] 902.4 Banner _"Viewing this log is itself logged."_ — and it is: page view writes an `audit.viewed` row

**Done when:** HR cannot see project/attendance audit rows by any path; views are logged.

---

### PUL-903 — Settings page `/settings` + holidays editor

**Budget:** M · **Reads:** §14.14 · **Depends:** PUL-110, PUL-207

- [ ] 903.1 Fields per §14.14: company, timezone (display-only Asia/Dhaka), work days, shift, grace, targets, break allowances, auto-close hours, webhook URL + Send test
- [ ] 903.2 Replace hardcoded defaults from PUL-302 with settings reads
- [ ] 903.3 Holidays editor (date + name rows) → the PUL-301 table; adding one shifts future computed due dates (test)
- [ ] 903.4 Clients management section (PUL-207 UI home)
- [ ] 903.5 No `inviteExpiryHours`, no `officeIP` (deleted per spec)

**Done when:** a holiday added here moves a template-computed due date, proven by test.

---

**Phase 9 exit:** all 13 routes of §14.1 render correctly for every permitted role.

---

# Phase 10 — Pre-launch Hardening (6 tickets)

---

### PUL-1001 — Load test

**Budget:** L · **Reads:** §12 · **Depends:** Phase 9 complete, staging live

- [ ] 1001.1 k6 script: sign-in, sign-out (atomic tx), submit, review, board load — 20 concurrent users
- [ ] 1001.2 Run against staging; record p95 per path
- [ ] 1001.3 Target p95 < 400ms; else document the VPS upgrade plan

**Done when:** numbers filed in the repo with pass/fail per path.

---

### PUL-1002 — Security review

**Budget:** L · **Reads:** §9, §12 · **Depends:** Phase 9 complete

- [ ] 1002.1 Checklist run: SQLi (parameterized everywhere), XSS (no dangerouslySetInnerHTML unaudited), CSRF (Better Auth config), IDOR (every query scoped by `authorize()` subject), rate limits on auth endpoints
- [ ] 1002.2 Dependency audit (`pnpm audit`) — resolve or accept each
- [ ] 1002.3 Secrets sweep: nothing in repo history; env-only
- [ ] 1002.4 Findings filed; each fixed or explicitly deferred with owner sign-off

**Done when:** zero unresolved criticals.

---

### PUL-1003 — Backup + restore drill

**Budget:** M · **Reads:** §12 · **Depends:** PUL-004

- [ ] 1003.1 Nightly `pg_dump` cron + rotation (7 daily, 4 weekly) + off-server copy
- [ ] 1003.2 Restore runbook written
- [ ] 1003.3 **Drill: someone other than the author restores to a scratch box from the runbook alone** → working app

**Done when:** the drill succeeds without author intervention.

---

### PUL-1004 — Migration dry-run CI

**Budget:** S · **Reads:** §11 · **Depends:** PUL-003

- [ ] 1004.1 CI step on `main`: fresh DB → 001–012 → idempotency re-run → `seedFull` loads
- [ ] 1004.2 Stays green permanently

**Done when:** the step exists and is green.

---

### PUL-1005 — Beta week

**Budget:** one calendar week · **Reads:** everything · **Depends:** PUL-1001…1004

- [ ] 1005.1 3 real employees, 5 working days, full daily loop on staging
- [ ] 1005.2 Beta log: every bug/confusion captured same-day
- [ ] 1005.3 Triage: fix or explicitly defer each
- [ ] 1005.4 Exit interview: all three independently say "ship it"

**Done when:** three yeses, log fully triaged.

---

### PUL-1006 — Production cutover + go-live

**Budget:** M · **Reads:** §12, PUL-004 · **Depends:** PUL-1005

- [ ] 1006.1 Production VPS (or promoted staging): prod domain, SSL, prod `.env`, backups from PUL-1003 active on prod
- [ ] 1006.2 Go-live runbook: DNS, first-deploy, seed SA account, smoke checklist (sign-in works, timer works, audit writes)
- [ ] 1006.3 Rollback plan written (previous image + DB restore point)
- [ ] 1006.4 Go live; first real sign-in audited; monitor for 48h

**Done when:** the team's real workday runs on production.

---

# 17.3 Ticket index (quick reference)

| Phase                                  | Tickets             | Count  |
| -------------------------------------- | ------------------- | ------ |
| 0 — Environments & Setup               | PUL-001 … PUL-004   | 4      |
| 1 — Foundation                         | PUL-101 … PUL-113   | 13     |
| 2 — Employees & Clients                | PUL-201 … PUL-207   | 7      |
| 3 — Attendance                         | PUL-301 … PUL-308   | 8      |
| 4 — Projects & Tasks                   | PUL-401 … PUL-413   | 13     |
| 5 — Templates & Start Project          | PUL-501 … PUL-506   | 6      |
| 6 — QC, Review & EOD                   | PUL-601 … PUL-607   | 7      |
| 7 — Leave                              | PUL-701 … PUL-707   | 7      |
| 8 — Dashboards, Notifications & Polish | PUL-801 … PUL-809   | 9      |
| 9 — Reports, Audit & Settings          | PUL-901 … PUL-903   | 3      |
| 10 — Pre-launch Hardening              | PUL-1001 … PUL-1006 | 6      |
| **Total**                              |                     | **83** |

Mandatory §15.4 test files are attached to: PUL-102, 103, 104, **111**, 201, 202, **203**, 204, 205, **206**, 302, 303, 304, 305, 306, 307, 403, 404, 502, 504, 505, 506, 601, 602, 603, 605, 702 (×3), 705, 902. The CI manifest (PUL-003.3) grows with each — by PUL-902 it equals the full §15.4 list. *(PUL-112: 111 / 203 / 206 added; the manifest stands at 11 files — see §15.4.1 for the authoritative current list.)*

---

# 17.4 What's explicitly out of scope for v1

Restated so nobody adds them mid-build: native mobile app · client portal · **Slack/Teams** adapters (the port exists and Discord + email ship in PUL-801; _other_ chat adapters are v2) · recurring cron-spawned tasks (Amendment E: explicit numbered template tasks instead) · file uploads (proof = link only) · custom roles beyond the five · multi-agency tenancy · real-time collaboration (last-write-wins + `CONFLICT` toasts is v1's story).

---

# 17.5 If a phase runs long

Do not skip tickets; extend the phase. Every ticket exists because something breaks without it. If a phase runs 50%+ over, stop and re-plan: that's an upstream underspecification signal, not phase bloat.

---

# 17.6 Reading order before PUL-001

1. §16 Design Principles — 20 min
2. §9 Auth — 30 min
3. §12 Tech Stack, esp. §12.11 — 20 min
4. §13 API Contract, skim — 20 min
5. §15 Testing Strategy — 15 min
6. This doc: §17.1–§17.2 deep, then Phase 0–1 tickets — 15 min

~2 hours. Then open Claude Code, load PUL-001, and start ticking boxes.

---

# 17.7 Open follow-ups that still need their own tickets

Found during reconciliation (PUL-112) and **not scheduled**. Each needs a ticket number before it
is worked; none is assigned to an existing ticket, and none should be quietly folded into one.

**1. `VALIDATION` is a §13 code that nothing emits.**
Zod's `.parse()` throws a `ZodError`, not an `AppError`. The `actionResult` boundary re-throws
anything that is not an `AppError` (by design, §12.4), so a bad input reaches the client as a
redacted digest and the toast mapper renders the generic line, exactly the outcome PUL-111 exists
to prevent, for the one code that is supposed to describe a *user-correctable* mistake. Today the
forms carry a client-side `safeParse` against the same schema, so a normal user does not hit it;
anything that bypasses the form does. The fix is to convert `ZodError` to
`AppError('VALIDATION', …)` at the boundary, with per-field detail. Until then §13's `VALIDATION`
code is documentation of an intent, not of a behaviour.

**2. `getDeactivationBlockers` must be threaded with the transaction executor BEFORE PUL-401.**
Its signature is `(userId)` and it reads the module-level `db`, so inside `deactivateEmployee` it
runs **outside** the surrounding transaction. That is harmless today only because its body returns
hardcoded empty arrays (`project_tasks` is migration 008). The moment PUL-401 fills the query in, the
blocker check and the `active=false` UPDATE sit in different snapshots, and a task assigned to the
target in that window slips through the offboarding gate: the account closes owning live work, which
is the one thing §13.1.4 exists to prevent. It must become `(executor, userId)` and be called with
`tx`. **Do this as its own ticket before PUL-401 touches the query body**, not as part of it; the
change is mechanical while the body is empty and easy to verify, and invisible once it is not.

**3. A Playwright job proving the PUL-111 boundary against a production build.**
`action-result-boundary.test.ts` uses `structuredClone` as a necessary-but-not-sufficient stand-in,
because production error redaction does not reproduce in a dev build or inside vitest (§15.4.1).
Nothing currently proves end to end that a `GATE` reason reaches a real browser in a real production
build, the exact failure PUL-111 was written to fix.

**4. A DOM test environment for client event plumbing.** See §15.4.2: accepted gap, manual QA is
the designated catcher, closing it properly needs its own ticket.
