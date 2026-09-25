# §15. Testing Strategy — EasyGrowCrm

**Status:** Final.
**Philosophy:** Critical-path testing, not full TDD. We test the things that would silently break business rules if wrong; we do not chase coverage.

---

## 15.1 What we test, what we don't

**We MUST test (blocks merge to `main`):**
1. Every role × permission pair in `authorize()` / `can()`.
2. Every hard invariant from §9.7 (one test per invariant).
3. Every gate function (`GATE:checklist_incomplete`, `GATE:proof_required`, `GATE:pending_reviews`, `GATE:use_review`, `GATE:already_reviewed`, etc.) — one test proving it fires, one proving it doesn't when it shouldn't.
4. The sign-out atomic transaction — full 5-step commit + rollback on any single failure.
5. Audit-log emission — one test per mutation asserts the audit row exists after commit with correct actor/action/resource.
6. Working-day and holiday math for leave (§13.6.1).
7. Due-date computation from template rules (`Day N` / `N before deadline` / `After task #`) including weekend and holiday shifts.
8. The template hierarchy walker (`tplAllTasks`) — round-trip: build a months → categories → tasks (with subtasks) fixture → walk it → assert every task is visited exactly once with correct `_catName` and `_monthNum`. *(Subtask cloning correctness is asserted in `start-project.test.ts`, which consumes the walker.)*
9. **The subtasks-never-gate rule + subtask/checklist audit events** — a submission with unchecked subtasks succeeds; one with an unchecked checklist is refused; every add/toggle/remove writes its §9.8 audit row (`subtask_added|toggled|removed`, `checklist_toggled|edited`).

**We SHOULD test (added when the code exists):**
- Multi-step flows end-to-end (sign-in → break → sign-out → EOD) using a real DB and real HTTP calls, one happy path + one failure path per flow.
- Cross-tab canonical query correctness (`getReviewQueue` returns the same rows for the review page, the project review tab, and the dashboard card given the same filters).
- Optimistic UI rollback when the server rejects a change.

**We do NOT test:**
- Individual React components in isolation (no `render(<Foo />)` unit tests). Coverage is via integration tests.
- Simple CRUD without business rules (a `getEmployeeById` query does not need a unit test — a type is enough).
- CSS or visual styling.
- Anything already enforced by TypeScript types or DB constraints — those are their own tests.
- Third-party libraries (Better Auth, Drizzle, pg-boss — trust them, or bind to what we call).

---

## 15.2 Why not full TDD

Real reasons, stated so we don't re-litigate:

1. **The prototype already exists.** Reverse-engineering tests from working behavior is worse than validating the specific rules we care about. Test the contracts, not the code that happens to pass them.
2. **The business rules are stable, the UI is not.** TDD's payoff peaks when requirements are locked. The Projects page has been rebuilt three times; testing every intermediate iteration would be pure waste.
3. **We enforce invariants in three layers already** (TypeScript, `authorize()`, DB constraints). A red-green-refactor cycle on top of that is belt-and-suspenders-and-safety-net.
4. **Small team.** TDD's biggest payoff is preventing regressions across many hands. Solo or two-person work benefits more from good types plus integration tests than from strict test-first discipline.

What we *are* doing is closer to **contract-first / outside-in**: define the contract (API in §13, invariants in §9, audit format in §11), write the tests that lock those contracts down, then implement freely within them. §17's Phase 1 explicitly ships `authorize()` + `can()` (PUL-104) + the audit log (PUL-102) + their tests **before any feature work.** That's the contract layer.

---

## 15.3 Test layer map

| Layer | What it covers | Tool | Runs where |
|---|---|---|---|
| **Unit** | pure functions (gates, `fmtHM`, `fmtDate`, working-day math, `tplAllTasks`, priority sort) | `vitest` | local + CI, fast lane |
| **Contract** | `authorize()`, `can()`, invariants, audit emission | `vitest` + test DB fixture | CI, blocks merge |
| **Integration** | one mutation end-to-end: direct server-action invocation → DB → audit row → notify-port assertion (`expectNotified`, PUL-107.3) | `vitest` + test DB | CI, blocks merge |
| **Flow** | multi-step happy paths (sign-in → sign-out; submit → review → approve) | `playwright` against a seeded dev DB | CI nightly + pre-release |
| **Manual** | mobile viewport sign-in/out, board drag-drop, calendar navigation, print export of Excel | checklist | pre-release |

There is deliberately no separate "unit test the React component" layer. ~~Integration tests exercise the components through real user actions; if a component works in an integration test it works.~~

> **DECIDED (Phase 1, PUL-112): that second sentence is not true as built.** The Integration row
> invokes server actions **directly**, not through components, and the Flow (Playwright) row has no
> job yet. So nothing currently exercises a component's event wiring, and the decision to skip a
> component-unit layer is presently an **uncovered gap rather than a covered one**. See §15.4.2.

---

## 15.4 The exact test files that must exist before v1 ships

This is a locked list. If a file below doesn't exist and pass, v1 does not ship.

```
features/auth/
  authorize.test.ts               // every role × every action, matrix from §9.5 table
  session-from-google.test.ts     // deactivated user rejected; unknown email rejected

features/audit/
  audit-write.test.ts             // writeAudit(tx) inside transaction; rollback on tx failure
  audit-scoping.test.ts           // HR sees only leave/employee rows; SA sees everything
  audit-immutability.test.ts      // UPDATE/DELETE on audit_log throws (DB TRIGGER proof — DECIDED Phase 1, was REVOKE)

features/attendance/
  sign-in.test.ts                 // creates row, sets late flag past grace, logs audit
  break.test.ts                   // one open break invariant; break-exceeded flag
  sign-out.test.ts                // 5-step atomic tx; rollback on any single failure
  early-sign-out.test.ts          // requires reason; flags attendance; notifies managers
  auto-close.test.ts              // 10h since sign-in with no sign-out → auto-closed row
  timer.test.ts                   // getMyTimer server-authoritative; client can't fake; half-day 3h30m target (PUL-707.3)

features/projects/
  gates.test.ts                   // checklist_incomplete, proof_required, use_review, pending_reviews
  subtasks-and-checklist.test.ts  // actors per §9.6 ⁷; submitted-lock; audit events; subtasks NEVER gate
  submit.test.ts                  // sets submitted status, one submission row, notifies reviewer
  review.test.ts                  // approve path, revision path, self-review rejected
  one-review-per-submission.test.ts  // DB unique index proof + app-level check
  status-transitions.test.ts      // all legal + all illegal transitions per role
  assign.test.ts                  // SA never assignable (both app and DB trigger)

features/templates/
  hierarchy-walker.test.ts        // tplAllTasks round-trip; correct _catName, _monthNum
  due-rule-compute.test.ts        // Day N, N-before-deadline, After-task-# with holiday shifts
  start-project.test.ts           // token substitution, subtask cloning, cat/month carry-over
  add-month-wizard.test.ts        // creates all 12 months with correct cascade dates

features/leave/
  workday-math.test.ts            // Sun–Thu work week, halves, half-day flag
  holiday-shift.test.ts           // holidays skipped in day counting
  half-day.test.ts                // first-half vs second-half; renders 0.5
  reversal.test.ts                // requires comment; SA/HR only; audited

features/employees/
  deactivate.test.ts              // blocks if <2 managers; requires offboarding resolution
  role-change.test.ts             // SA only; audited
  min-two-managers.test.ts        // DB CHECK + app-level guard
  create-employee.test.ts         // happy + duplicate CONFLICT + audit row + HR allowed / EMP forbidden (PUL-202.4)
  update-employee.test.ts         // profile fields only; role and email untouchable here; audit diff shape (PUL-203.3)
  reactivate.test.ts              // SA + HR; already-active is a no-op with no audit row (PUL-206 Stage 3, §13.1.5)
  action-result-boundary.test.ts  // AppError -> { ok:false, code, reason } survives the boundary (PUL-111)

features/eod/
  immutability.test.ts            // no UPDATE path exists in actions
  acknowledge.test.ts             // ✓ Reviewed; 🚩 Flagged with note
```

That's **35** test files *(DECIDED Phase 1, PUL-112: was 31; the four employees entries added above are built and CI-enforced today)*. Anything beyond this list is welcome but not required; the list is otherwise locked.

### 15.4.1 The CI-enforced manifest: what is required *today*

The list above is the **v1 ship gate**: every file on it must exist and pass before v1. Most of it
names tables and features that do not exist yet, so CI cannot enforce it wholesale mid-build.
`scripts/check-mandatory-tests.ts` is **the authoritative manifest of what is enforced right now**
(§15.9 gate 5), and it grows as each phase lands. It currently holds **16 files** *(updated at
PUL-413; this listing had fallen behind the script at 11)*:

```
features/auth/session-from-google.test.ts          // PUL-103.5
features/audit/audit-write.test.ts                 // PUL-102.4
features/audit/audit-immutability.test.ts          // PUL-102.4
features/auth/authorize.test.ts                    // PUL-104.3
features/employees/min-two-managers.test.ts        // PUL-201.3
features/employees/create-employee.test.ts         // PUL-202.4
features/employees/update-employee.test.ts         // PUL-203.3
features/employees/role-change.test.ts             // PUL-204.3
features/employees/deactivate.test.ts              // PUL-205.5
features/employees/reactivate.test.ts              // PUL-206 Stage 3
features/employees/action-result-boundary.test.ts  // PUL-111
features/clients/clients.test.ts                   // PUL-207.4                 ¹
features/auth/oauth-link-provisioned.test.ts       // PUL-202 "Done when"       ¹
features/projects/assign.test.ts                   // PUL-403.5
features/projects/status-transitions.test.ts       // PUL-404.6
features/projects/client-export.test.ts            // PUL-413.3                 ¹
```

¹ **CI-enforced but NOT on the locked §15.4 list.** These were added to the script by their
tickets without amending §15.4, which contradicts the "adds it to both" rule below. Either §15.4
gains them (raising 35 → 38) or they stay script-only as "welcome but not required". **Needs a
ruling.** Until then the script decides CI and §15.4 decides v1, as stated below.

**When these two lists disagree, the script wins for "is CI green" and §15.4 wins for "may we
ship v1".** A ticket that adds a mandatory test adds it to both.

**Caveat on `action-result-boundary.test.ts` (PUL-111):** it asserts the boundary contract by putting
each result through `structuredClone`, a **necessary-but-not-sufficient** stand-in for the real
serialization step. Booting a production Next server inside vitest is impractical, and production
redaction is exactly the behaviour that does not reproduce in a dev build. It proves the returned
shape survives structured cloning; it does **not** prove a production build preserves it end to end.
The real proof is a Playwright job against a production build, which **does not exist yet and needs
its own ticket** (see §17's open follow-ups).

### 15.4.2 ACCEPTED GAP: client event plumbing is not unit-tested

There is no jsdom or `@testing-library` in the project and `vitest.config.ts` is
`environment: 'node'` throughout, so **no test exercises a React component's event wiring**: a
handler that never fires, a control wired to the wrong state, a fetch that never runs. Two real
PUL-206 drawer defects reached main this way and were caught by manual QA (a dialog whose data
load hung off Base UI's `onOpenChange`, which never fires for a parent-controlled `open`; and a
confirm step wired to a separate button instead of to the selection).

This is **accepted, not resolved.** The designated catcher is the per-ticket manual QA pass
(e.g. PUL-206.4, "manual QA as all 5 roles"), and every ticket with UI must keep carrying one.
Closing the gap properly means adding a DOM test environment and is **not scheduled**; it needs
its own ticket before anyone claims this layer is covered.

---

## 15.5 Fixtures & test DB

- One Postgres schema `easygrowcrm_test` per CI worker, migrated fresh every run (all migrations 001–012 applied).
- Seed helper `seedMinimal()` — 1 SA, 2 managers, 3 employees, 1 client, 1 project, 3 tasks *(PUL-401 added the tasks; this line previously said 0)*. Every test starts from this and adds only what it needs.
- Seed helper `seedFull()` — realistic org (matches the prototype's demo data) for flow tests only. Today it is `seedMinimal` + a second project with 3 more tasks (PUL-401) + the prototype's three templates with their full month → category → task → subtask trees (PUL-501, `tests/seed-templates.ts`).
- **No test uses production data. Ever.**
- Time is injected via a `clock` port (default `Date.now()` in prod, freezable in tests). No `new Date()` in business code — every date read goes through the clock port, enforced mechanically by the `easygrowcrm/no-direct-date` ESLint rule (§12.5). This makes "did the auto-close fire at hour 10?" a two-line test.

---

## 15.6 Coverage target

There is no numerical coverage target. Coverage is a lagging indicator. The lists in §15.1 and §15.4 are the leading indicator — if every item on those lists exists and passes, coverage will land somewhere around 60–75% naturally, and that's fine.

CI reports coverage as **information**, never as a gate. A PR that adds a new **accountability-bearing** action (audited, gated, or invariant-touching) must add its test file to the §15.4 list via a changelog entry; a PR that adds a React component does not need a test.

---

## 15.7 What we do instead of TDD

The workflow for a new feature is:

1. **Read the relevant PRD section** (§9 for auth, §13 for API, etc.) to know the contract.
2. **Sketch the action** in `features/<name>/actions.ts` following the 5-step shape (validate → authorize → withTx → writeAudit → notify).
3. **Write the contract test first** for anything on the §15.1 mandatory list (this is the one place we do write test-first, because the contract is what everything else depends on).
4. **Implement freely.** TypeScript + `authorize()` + DB constraints catch most mistakes before the test ever runs.
5. **Add integration test** for the happy path and one failure path.
6. **Ship.**

This is "test-critical, not test-first for everything." It's honest about what tests are for: catching regressions on the rules that matter, not proving that assignment works.

---

## 15.8 Anti-patterns to reject in review

If a PR contains any of these, request changes:

- A mutation without an audit test.
- An `authorize()` call anywhere other than the first line of the action.
- A test that mocks the database (contract tests must hit the real test DB).
- A test that mocks `authorize()` (that's the thing being contract-tested).
- A React component test that renders the component in isolation to check text content. If the text matters, an integration test covers it; if it doesn't, no test is needed.
- Any test that uses `new Date()` or `Date.now()` directly.
- Any test that depends on test-order (each test must be able to run alone).

---

## 15.9 CI gates (blocks merge)

```
1. tsc --noEmit                              # types pass
2. eslint                                    # incl. easygrowcrm/authorize-first + easygrowcrm/no-direct-date (§12.5)
3. vitest run                                # unit + contract + integration
4. drizzle-kit check                         # migration consistency
5. scripts/check-mandatory-tests.ts          # every §15.4 file exists and passes (PUL-003.3)
6. forbidden-words grep                      # "Completed" in attendance/daily-plan, "Score" anywhere (PUL-809)
```

Playwright flow tests run nightly and pre-release, not on every PR — they're slower and the contract layer already catches most breakage.
