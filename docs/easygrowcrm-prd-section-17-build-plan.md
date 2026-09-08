# §17. Build Plan — EasyGrowCrm

**Status:** Final.
**Unit of work:** the **ticket**. One ticket ≈ one Claude Code session. Every ticket has a number (`PUL-xyz`), numbered subtasks (checkboxes — tick them as you go), a session budget, explicit dependencies, and a done-check. If a ticket is on this list, it ships. If it's not on this list, it's out of scope for v1.

**Ticket numbering:** `PUL-<phase><serial>` — the first digit(s) of the number tell you the phase. `PUL-104` = Phase 1, ticket 04. `PUL-1003` = Phase 10, ticket 03. Subtasks are `<ticket>.<n>` (e.g. `104.2`).

---

## 17.1 How this plan is structured

The unit of work is the **ticket**. Tickets are numbered `PUL-<phase><serial>` — the leading digit(s) name the phase (`PUL-104` = Phase 1, ticket 04; `PUL-1003` = Phase 10, ticket 03), and subtasks are `<ticket>.<n>` (e.g. `104.2`). Work top to bottom: tickets are dependency-ordered, so start at the lowest open number and don't begin a phase until the previous one is green.

The plan is **80 tickets across 11 phases**, with 340+ checkable subtasks:

| Phase | Focus                                                       | Tickets             |
| ----- | ----------------------------------------------------------- | ------------------- |
| 0     | Environments & project setup                                | PUL-001 … PUL-004   |
| 1     | Foundation (auth, `authorize()`, audit, mutation shape, CI) | PUL-101 … PUL-110   |
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

- [x] 103.1 Better Auth (≥1.6): Google provider only; signup disabled; sessions in Postgres. External OAuth app — team uses personal Gmail (no Google Workspace); each user added as an OAuth test user.
- [x] 103.2 `/sign-in` page per §14.1.1: logo + one Google button, nothing else
- [x] 103.3 Unknown email → _"This email is not registered with EasyGrowCrm. Contact HR."_; deactivated → _"This account has been deactivated."_ — Company-domain check (§9.3 step 5) **DROPPED**: no shared Workspace domain, so the provisioned `user` row is the sole gate. Re-add if EasyGrow moves to Workspace.
- [x] 103.4 Session helper `getSessionUser()` — re-reads role + active from DB every request (never trusts the session payload; §16.5)
- [x] 103.5 Test: `features/auth/session-from-google.test.ts` (unknown email, deactivated user) → CI manifest
- [x] 103.6 Seed the first `super_admin` by hand (Employees UI is Phase 2) — first sign-in has no other route onto the guest list.

**Done when:** manual Google sign-in works locally with a hand-seeded super_admin; both rejection paths render their exact copy.
---

### PUL-104 — `authorize()` + `can()` permission core

**Budget:** L · **Reads:** §9.5, §16.5 · **Depends:** PUL-103

> **The matrix is §9.6, not §9.5.** This ticket's subtasks say "the §9.5 matrix"; §9.5 is the
> *rules* (authorize-first, UI hides / API refuses, role re-read every request) and §9.6 is the
> *table*. Built against §9.6; §9.5 supplies the surrounding rules.

> **Deviation as built — flat file layout.** §12 sketches `lib/auth/can.ts` + `lib/auth/authorize.ts`.
> This project is flat (`lib/auth.ts`, `lib/session.ts`, `lib/errors.ts`, `db/` at root), so
> `can()`, `authorize()`, and the table all live in **`lib/authz.ts`**; no `lib/auth/` folder was
> created. The actual layout is now recorded in CLAUDE.md §4 "File layout (as built)", which
> supersedes §12's folder sketch — §12's *rules* (ports in `lib/`, feature slices own their code)
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

**Done when:** ✅ copying `_example` is the documented way to start any new action — it is lint-clean, type-clean, and passes the rule that guards it. Mutation-checked: moving `authorize()` in the real `_example` to *after* the `withTx` block fails `pnpm lint` with exactly `authorize() must run before withTx() in "exampleAction"` on that file (exit 1); restored. Gates green: `tsc --noEmit` 0 · `eslint .` 0 (no warnings) · `vitest run` 5 files / 16 tests · `drizzle-kit check` 0 · mandatory-test manifest 0.

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
> the *template* owns the copy, the caller names a template and supplies its payload. A caller that
> passes prose would put user-facing wording in `features/**`, where the §2 forbidden-words grep
> and the §13.9 registry can't govern it. `NotificationType` is a union of the 18 §13.9 names, so
> an invented type is a **compile error** at the call site. The ticket's wording should be amended.

- [x] 107.1 `lib/notifications.ts`: `NotificationType` (the 18 §13.9 template names, no more and no fewer — verified against §13.9), `NotifyInput { to, type, data? }`, `notify(input): Promise<void>`. One recipient per call; loop for several.
- [x] 107.2 v1-stub adapter: pushes `{ ...input, sentAt }` onto a module-level array and `console.debug`s it. No DB, no webhook — `notifications` + `webhook_outbox` land in PUL-801 and **this interface does not change then** (§16.11). Test-only `__resetNotifications()` (clears; call it in setup) and `__sentNotifications()` (returns a **copy**, so the live array is never handed out). `sentAt` uses `Date.now()` for now — `lib/` is outside the `features/**` clock ban; it moves to `clock.now()` in PUL-108.
- [x] 107.3 Test helper `expectNotified(to, matcher)` in `tests/notifications.ts`. Object matcher = equal `type` when given plus a **subset** match on `data` (extra payload keys are fine); function matcher = predicate. On no match it throws listing every notification that *was* sent — recipient, type and payload per line — or `(nothing was sent)`, so a failing integration test diagnoses itself.
- [x] 107.4 Test `tests/notifications.test.ts` (10 cases): notify records; reset clears; the accessor doesn't leak the live array; type / data-subset / predicate matches pass; and four failure paths (wrong type, wrong recipient, differing `data` value, nothing sent), with the wrong-type case asserting the error names what *was* sent. **Not a §15.4 mandatory test** — `scripts/check-mandatory-tests.ts` is unchanged (still 4 files).
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
> port", and the Done-when asks for an audit row carrying the *frozen* timestamp. That is the wrong
> target: `writeAudit` omits `created_at` and Postgres fills it from `now()` (`db/schema/audit.ts`,
> `.defaultNow().notNull()`), which is deliberate — audit time should be database commit-side time,
> not an app instant, and it means a frozen test clock cannot skew the append-only log. So the port
> governs *business* time (late detection, timer unlock, auto-close); the audit clock is the
> database's. The ticket wording should be amended to say so.

- [x] 108.1 `lib/clock.ts`: `Clock { now(): Date }`; `systemClock` (the production adapter, and the **only** permitted `new Date()` in the codebase); `clock`, the facade every caller imports; `createTestClock(initial?)` → `now()` / `set(d)` / `advance(ms)`, handing out a **copy** each `now()` so a test can't mutate the frozen instant by accident; `setClock` / `resetClock` to swap the source.
- [x] 108.2 ESLint rule `easygrowcrm/no-direct-date` in `eslint-rules/no-direct-date.mjs`, registered in the **same** local plugin as `authorize-first` and wired as `"error"` for `files: ["features/**"]` — broader than `authorize-first`'s `actions.ts` glob, since any feature code can read a clock. No path logic inside the rule: `lib/clock.ts` is exempt purely by falling outside the glob. **Deliberate narrowing:** only the *zero-argument* `new Date()` is banned — `new Date(row.startedAt)` is parsing a stored value, not asking what time it is. `Date.now()` is banned outright (it has no parsing form). Three `valid` test cases pin this narrowing so it isn't "fixed" later.
- [x] 108.3 Audit path confirmed clock-free — see the deviation note above; `writeAudit` is correct as-is and was not touched. A grep of `features/**` finds zero real `new Date()` / `Date.now()`; `_example` references the clock only in comments.
- [x] 108.4 Tests. `eslint-rules/no-direct-date.test.ts` — RuleTester via vitest (globals are off here): 3 valid (`clock.now()`; `new Date(row.startedAt)`; `someDate.getTime()`) + 3 invalid (`new Date()`; `Date.now()`; both in one file, both reported). `tests/clock.test.ts` — freeze is stable across calls, `advance(1000)` moves 1s, `set(d)` jumps absolute, `now()` hands out a copy, `setClock` makes code holding `clock` (not the test adapter) see the advance, `resetClock` restores real time. **Neither is a §15.4 mandatory test** — `scripts/check-mandatory-tests.ts` unchanged (still 4 files).

**Done when:** ✅ a test freezes time and any `features/**` code reading `clock.now()` sees the frozen instant — audit rows keep the database's `now()` by design (see the note above). Mutation-checked: adding `const x = new Date();` to the real `features/_example/actions.ts` fails `pnpm lint` with exit 1 and exactly `Use clock.now() from lib/clock — direct Date access is banned in features/** (§16.6)  easygrowcrm/no-direct-date` on line 23; removed, and `git diff --stat` on that file is empty. Gates green: `tsc --noEmit` 0 · `eslint .` 0 (no warnings) · `vitest run` 8 files / 38 tests · `drizzle-kit check` 0 · mandatory-test manifest 0.

---

### PUL-109 — Test fixtures: `seedMinimal` / `seedFull`

**Budget:** M · **Reads:** §15.5 · **Depends:** PUL-101

- [ ] 109.1 `tests/fixtures/seedMinimal.ts` — 1 SA, 2 managers, 3 employees, 1 client, 1 project, 0 tasks (grows as tables land; keeps compiling at every phase)
- [ ] 109.2 `tests/fixtures/seedFull.ts` — realistic org matching the prototype demo data (flow tests only)
- [ ] 109.3 Per-test isolation: each test file gets a clean schema or wraps in a rolled-back tx — document the choice
- [ ] 109.4 Guard: fixtures refuse to run if `DATABASE_URL` doesn't contain `test`

**Done when:** two test files using `seedMinimal` run in any order with identical results.

---

### PUL-110 — App shell: sidebar + header + role-based nav

**Budget:** L · **Reads:** §14.1 · **Depends:** PUL-103, PUL-104

- [ ] 110.1 Sidebar: logo, 13 items (lucide icon + label) per §14.1 route table, active highlight, Logout at bottom — **no user-switcher** (explicitly banned)
- [ ] 110.2 Nav visibility driven by `can()` per the §14.1 Visible-to column; hidden items don't render at all
- [ ] 110.3 `PAGE_META` map → header title + subtitle per route
- [ ] 110.4 Header bell icon + unread badge (panel itself lands in PUL-802; icon renders count 0 until then)
- [ ] 110.5 Route guards: unauthenticated → `/sign-in`; unauthorized route → 404 (server-enforced regardless — sidebar is cosmetic, §14.1)
- [ ] 110.6 Placeholder page component per route so every nav item lands somewhere

**Done when:** signing in as each of the 5 roles shows exactly the §14.1 item set; deep-linking a forbidden route 404s.

---

**Phase 1 exit:** all 10 tickets done. CI enforces types, lint (both custom rules), tests, migrations, and the manifest. Only now do features begin.

---

# Phase 2 — Employees & Clients (7 tickets)

---

### PUL-201 — Employee table + min-managers trigger (migration 004)

**Budget:** M · **Reads:** §11 (004), §9.4 inv. 7 · **Depends:** PUL-101

- [ ] 201.1 Migration 004: `employees` per §11 (role, active, title, dept, join date, google email unique)
- [ ] 201.2 DB trigger: reject any UPDATE that would leave <2 active managers
- [ ] 201.3 Test: `features/employees/min-two-managers.test.ts` — trigger fires on raw SQL bypassing the app → CI manifest
- [ ] 201.4 Extend `seedMinimal` with real employee rows

**Done when:** the trigger is unbreakable even via `psql`.

---

### PUL-202 — Add-employee action + modal (§13.1.1)

**Budget:** M · **Reads:** §13.1.1, §14.12 · **Depends:** PUL-105, PUL-201

- [ ] 202.1 Action in the 5-step shape: email, name, role, title, dept, join date; **no email sent**
- [ ] 202.2 Duplicate email → `CONFLICT`; validation via zod
- [ ] 202.3 Modal per §14.12 with the copy _"They'll sign in with their company Google account — no invitation email is sent."_
- [ ] 202.4 Tests: happy path + duplicate + audit row + HR-allowed/EMP-forbidden

**Done when:** SA and HR can add; new employee can immediately Google-sign-in.

---

### PUL-203 — Edit-employee action (§13.1.2)

**Budget:** S · **Reads:** §13.1.2 · **Depends:** PUL-202

- [ ] 203.1 Action: name, title, dept, join date editable (role NOT here — that's PUL-204; email immutable)
- [ ] 203.2 Audit row carries before→after diff
- [ ] 203.3 Tests: happy path + role-not-editable-here + audit diff shape

**Done when:** field edits round-trip; role and email untouchable via this action.

---

### PUL-204 — Change-role action, SA only (§13.1.3)

**Budget:** S · **Reads:** §13.1.3 · **Depends:** PUL-202

- [ ] 204.1 Action: SA only; HR gets `FORBIDDEN`
- [ ] 204.2 Next request by the affected user reflects the new role (DB re-read proof, §16.5)
- [ ] 204.3 Test: `features/employees/role-change.test.ts` → CI manifest

**Done when:** demote-a-manager attempt that breaks min-2 is rejected by the PUL-201 trigger.

---

### PUL-205 — Deactivate + offboarding checklist (§13.1.4)

**Budget:** L · **Reads:** §13.1.4, §14.12 · **Depends:** PUL-203 _(fully testable after Phase 4 adds tasks; blocker-list query ships now against empty sets)_

- [ ] 205.1 Blocker query: open assignments + routed reviews for the target user (returns empty pre-Phase-4; shape is final)
- [ ] 205.2 Offboarding modal per §14.12:每 blocker row with reassign ▾ / cancel; Deactivate disabled until zero blockers
- [ ] 205.3 Hard block + explanation if deactivation would leave <2 managers
- [ ] 205.4 Deactivated users: muted "(deactivated)" in history, excluded from every dropdown (shared `activeUsersQuery`)
- [ ] 205.5 Test: `features/employees/deactivate.test.ts` (happy, min-managers-block; open-task-block extended in Phase 4) → CI manifest

**Done when:** deactivation is impossible while blockers exist; sessions of the deactivated user die on next request.

---

### PUL-206 — Employees page UI

**Budget:** L · **Reads:** §14.12 · **Depends:** PUL-202…PUL-205, PUL-110

- [ ] 206.1 Card grid: avatar, name, title, dept chip, role badge, Active/Deactivated pill
- [ ] 206.2 Filters: dept ▾, status ▾, name search
- [ ] 206.3 Detail drawer: edit fields (203), Change role (SA-only visible, 204), Deactivate (205)
- [ ] 206.4 Manual QA as all 5 roles (EMP/PM/TL don't see the page at all — nav + route guard)

**Done when:** every §14.12 affordance works through the real actions.

---

### PUL-207 — Clients CRUD

**Budget:** M · **Reads:** §11 (clients table), §14.3 filter bar · **Depends:** PUL-105

- [ ] 207.1 Clients table lands with migration 007 prep or its own mini-migration — name, contact, active flag (v1-minimal per §11)
- [ ] 207.2 Actions: create / edit / archive-client (archive blocked if live projects exist → `GATE`)
- [ ] 207.3 Minimal UI: managed from a section in Settings or a lightweight `/clients` list (owner's call — default: Settings section)
- [ ] 207.4 Tests: CRUD + archive gate + audit

**Done when:** the Phase 4 filter bar and Phase 5 Start Project wizard have real clients to select.

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

- [ ] 401.1 Migrations: `projects`, `project_tasks`, `project_task_subtasks`, `project_task_checklist`, `project_task_comments` per §11
- [ ] 401.2 FK chain + indices; **no denormalized shortcuts** (§16.7)
- [ ] 401.3 DB trigger: `assignee` may never be an SA (invariant layer 3)
- [ ] 401.4 Extend `seedMinimal` (1 project, 3 tasks) and `seedFull`

**Done when:** schema diff vs §11 empty; SA-assignee rejected by raw SQL.

---

### PUL-402 — Project CRUD + Archive

**Budget:** M · **Reads:** §13.3, §14.3 header · **Depends:** PUL-401

- [ ] 402.1 Create-project action (client, name, type, start month) — the manual path; template path is Phase 5
- [ ] 402.2 Edit-project action (name, dates)
- [ ] 402.3 Archive action: `GATE:pending_reviews` when any task is `submitted`; archived projects read-only, out of default filters
- [ ] 402.4 Tests: CRUD + archive gate + audit

**Done when:** archiving with a pending review is impossible and the toast names the task.

---

### PUL-403 — Create-task + assign-task actions (§13.4.1, §13.4.3)

**Budget:** M · **Reads:** §13.4.1, §13.4.3 · **Depends:** PUL-401

- [ ] 403.1 Create-task: full §13.4.1 field set; category pre-fill support
- [ ] 403.2 Assign: active non-SA only; app check + DB trigger (401.3) both
- [ ] 403.3 No self-claim exists anywhere (§13.4.3 — managers assign; verify no such action)
- [ ] 403.4 Assignment notifies the assignee
- [ ] 403.5 Test: `features/projects/assign.test.ts` (SA rejected at both layers) → CI manifest

**Done when:** both enforcement layers proven in one test file.

---

### PUL-404 — Status pill + transition matrix + dependency guard

**Budget:** L · **Reads:** §14.3.2, §13.4.4, §13.4.6 · **Depends:** PUL-403

- [ ] 404.1 Shared `<StatusPill>`: exact labels/colors per §14.3.2 (Approved gets the check-shield; Completed doesn't)
- [ ] 404.2 Dropdown option sets per role; locked states read-only; "Done (Approved)" **absent** from the dropdown (`GATE:use_review`)
- [ ] 404.3 MGR "Completed" = explicit QC bypass, audited as `status_overridden`
- [ ] 404.4 Dependency guard: unresolved dependency renders Blocked + lock + tooltip naming the dependency; server rejects transitions on blocked tasks
- [ ] 404.5 Revision requires a note (modal)
- [ ] 404.6 Test: `features/projects/status-transitions.test.ts` — every legal + illegal transition per role → CI manifest

**Done when:** the transition test enumerates the full matrix.

---

### PUL-405 — Subtask + checklist actions

**Budget:** M · **Reads:** §14.3.3, §16.8 · **Depends:** PUL-403

- [ ] 405.1 Subtasks: add / toggle / remove (assignee + MGR); audited (`subtask_added/_toggled/_removed`)
- [ ] 405.2 Checklist: toggle (assignee/MGR), add/delete (MGR only); audited
- [ ] 405.3 Both locked while `submitted`
- [ ] 405.4 **Checklist gates submission; subtasks never do** — the distinction from §14.3.3, asserted in tests
- [ ] 405.5 Integration tests for all six actions + locks

**Done when:** the gate/informational distinction is proven by a test that submits with unchecked subtasks (passes) and unchecked checklist (refused).

---

### PUL-406 — Comments action

**Budget:** S · **Reads:** §14.3.3 · **Depends:** PUL-403

- [ ] 406.1 Add-comment action — **always open regardless of status** (the one thing never locked)
- [ ] 406.2 Notifies assignee when commenter ≠ assignee
- [ ] 406.3 Tests: comment on a `submitted` task succeeds; notification asserted

**Done when:** comments post on locked tasks; assignee is notified.

---

### PUL-407 — Task Detail modal

**Budget:** L · **Reads:** §14.3.3, §14.15 r.2 & 11 · **Depends:** PUL-404…PUL-406

- [ ] 407.1 Header: title, project · category · month, pill, priority, **`Due: Aug 8, 2026 · Today`** (`fmtDate` — build the helper here, it's the canonical one), assignee + MGR Assign ▾
- [ ] 407.2 Sections in §14.3.3 order: description/SOP/expected output → checklist `(3/5)` → subtasks `(2/4)` + inline "+ Add subtask" (Enter adds) → actual `HMInput` → proof → comments → submission & review history
- [ ] 407.3 `submitted` lock banner exact copy: _"Awaiting review — checklist, subtasks and hours are locked. Comments stay open."_
- [ ] 407.4 `CONFLICT` on stale write → refresh toast
- [ ] 407.5 Manual QA: assignee, non-assignee EMP, MGR, dependency-blocked

**Done when:** every §14.3.3 behavior demonstrable from this one modal.

---

### PUL-408 — Filter bar + project header

**Budget:** M · **Reads:** §14.3 · **Depends:** PUL-402, PUL-110

- [ ] 408.1 Filter bar: Client ▾ · Project ▾ (client-scoped) · Month ▾ · Assignee ▾; state in the upfront-declared store (§16.10 — no lazy init)
- [ ] 408.2 Header: breadcrumb `📁 Client › Project · type · Month N`, progress `9/21 · 43%` + bar, health chip (whole-project calc per §14.3), **+ New Task** (MGR), Archive in overflow (→ 402.3)
- [ ] 408.3 Filters drive one canonical filtered-tasks query shared by all tabs

**Done when:** filter changes update every tab identically.

---

### PUL-409 — Board view

**Budget:** L · **Reads:** §14.3.1 · **Depends:** PUL-407, PUL-408

- [ ] 409.1 Kanban by status, columns top-bordered in status color + count chips
- [ ] 409.2 Card: title · category tag · priority · avatar · **date with year** · **`☑ 2/4` subtask badge** (hidden at zero) · red overdue line
- [ ] 409.3 Unassigned group pinned on top (managers assign from here)
- [ ] 409.4 Card → Task Detail; per-column + Add task (MGR)

**Done when:** board matches §14.3.1 pixel-for-behavior.

---

### PUL-410 — List view

**Budget:** L · **Reads:** §14.3.4, §16.10 · **Depends:** PUL-407, PUL-408

- [ ] 410.1 Collapsible Month → Category → Task tree; month header with done count + "Current cycle" pill; category header with color dot
- [ ] 410.2 Row: Task · Owner · Status pill · **Due (`Aug 8, 2026` + suffix + `2/4 subtasks` line)** · Priority · Est · ⋯
- [ ] 410.3 Collapse state declared upfront (§16.10)
- [ ] 410.4 `+ Add task in {Category}` per open group (MGR); Unassigned banner section

**Done when:** tree renders and collapses identically to the prototype's list view.

---

### PUL-411 — Calendar view

**Budget:** M · **Reads:** §14.3.4 · **Depends:** PUL-407, PUL-408

- [ ] 411.1 Month grid, header **`August 2026`** (year always), today highlighted
- [ ] 411.2 Category-colored chips → Task Detail
- [ ] 411.3 Prev/Next = real server-side month navigation (not the demo toast)

**Done when:** navigating months returns correct task sets from the server.

---

### PUL-412 — `getReviewQueue` + Review tab + Workload tab

**Budget:** L · **Reads:** §13.8, §14.3.5–6, §16.9 · **Depends:** PUL-407

- [ ] 412.1 One canonical `getReviewQueue(filters)` (§16.9 — three surfaces, one query)
- [ ] 412.2 Review tab: columns per §14.3.5, tab-title count, "Routed to me" chip _(decision modal itself is PUL-602)_
- [ ] 412.3 Workload tab (MGR/HR): per-person open count + est hours + on-break live dot; dependency-blocked counts as open
- [ ] 412.4 Test: same filters through the project tab and (future) `/review` page return identical rows

**Done when:** query identity across surfaces is proven by test.

---

### PUL-413 — Weekly / Monthly Excel exports

**Budget:** M · **Reads:** §13.8, §14.3 · **Depends:** PUL-408

- [ ] 413.1 Server-side client-safe exports (columns per §13.8 — internal fields excluded)
- [ ] 413.2 Buttons in the filter bar (MGR only)
- [ ] 413.3 Test: export rows byte-match on-screen rows for a fixed range

**Done when:** a manager downloads a client-sendable Excel from staging.

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

- [ ] 801.1 Migration 012; swap the stub adapter for the DB adapter — **interface unchanged**, zero action edits
- [ ] 801.2 Webhook adapter stubbed behind the same port (v2)
- [ ] 801.3 Existing `expectNotified` assertions now hit the real table — full suite still green

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
| 1 — Foundation                         | PUL-101 … PUL-110   | 10     |
| 2 — Employees & Clients                | PUL-201 … PUL-207   | 7      |
| 3 — Attendance                         | PUL-301 … PUL-308   | 8      |
| 4 — Projects & Tasks                   | PUL-401 … PUL-413   | 13     |
| 5 — Templates & Start Project          | PUL-501 … PUL-506   | 6      |
| 6 — QC, Review & EOD                   | PUL-601 … PUL-607   | 7      |
| 7 — Leave                              | PUL-701 … PUL-707   | 7      |
| 8 — Dashboards, Notifications & Polish | PUL-801 … PUL-809   | 9      |
| 9 — Reports, Audit & Settings          | PUL-901 … PUL-903   | 3      |
| 10 — Pre-launch Hardening              | PUL-1001 … PUL-1006 | 6      |
| **Total**                              |                     | **80** |

Mandatory §15.4 test files are attached to: PUL-102, 103, 104, 201, 204, 205, 302, 303, 304, 305, 306, 307, 403, 404, 502, 504, 505, 506, 601, 602, 603, 605, 702 (×3), 705, 902. The CI manifest (PUL-003.3) grows with each — by PUL-902 it equals the full §15.4 list.

---

# 17.4 What's explicitly out of scope for v1

Restated so nobody adds them mid-build: native mobile app · client portal · Slack/Teams adapters (port exists; adapters are v2) · recurring cron-spawned tasks (Amendment E: explicit numbered template tasks instead) · file uploads (proof = link only) · custom roles beyond the five · multi-agency tenancy · real-time collaboration (last-write-wins + `CONFLICT` toasts is v1's story).

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
