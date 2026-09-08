# §16. Design Principles — EasyGrowCrm

**Status:** Final.
**Purpose:** Name the principles we've been applying implicitly across §9–§15 so any engineer picking up the code — human or Claude Code — has a single place to check what "the EasyGrowCrm way" means. If a PR looks wrong, cite the principle; if a principle stops serving us, we edit it here first, before the code.

---

## 16.1 Vertical slice architecture (feature-first)

**Rule:** Code is organized by feature (`features/attendance/`, `features/projects/`, `features/leave/`), not by technical layer. Each slice owns its actions, queries, components, tests, and types.

**Why:** Feature boundaries are stable — "attendance" is still attendance a year from now. Technical-layer boundaries drift as libraries and frameworks change. Vertical slices keep the blast radius of any change small: touch attendance, blow up attendance, not the whole app.

**Consequence:** No global `controllers/`, `services/`, `repositories/` folders. Shared utilities go in `lib/`, and shared components go in `components/ui/`, but nothing feature-specific lives outside its slice.

**Reject in review:** a PR that puts business logic in a shared `services/` folder.

---

## 16.2 The 5-step mutation shape

**Rule:** Every server action follows the same skeleton:

```ts
export async function actionName(input: Input) {
  const data = await validate(input);                    // 1
  const actor = await authorize(data.action, data.subject); // 2
  return await withTx(async (tx) => {                    // 3
    const result = await doTheWork(tx, data);
    await writeAudit(tx, actor, "action.name", ...);     // 4
    return result;
  }).then((r) => {                                       // 5
    notify(...);
    return r;
  });
}
```

**Why:** If every action looks the same, it's immediately obvious when one is wrong. Audit is inside the transaction (rolls back with the work). Notify is outside the transaction (never sent for work that got rolled back). Validate is first (never touch the DB with invalid input). Authorize is second (never do work without permission).

**Consequence:** No action can skip audit; no action can send a notification for work that failed; no action can authorize itself with data from an untrusted source.

**Reject in review:** an action that calls `authorize()` anywhere but the first line after `validate()`, or that emits notifications inside the transaction, or that writes audit outside it.

---

## 16.3 Defense in depth for invariants

**Rule:** The hard invariants (§9.7) are enforced in three layers simultaneously:
1. **TypeScript types** where possible (a role union type has no "super_employee" option).
2. **`authorize()` + gates in every action** — runtime checks with named error codes.
3. **Database CHECK constraints and triggers** — the last line of defense, active even if the app is bypassed.

**Why:** No single layer failing can break the invariant. If Better Auth returns a stale role, the DB trigger still catches it. If a migration typo removes a CHECK, the app-level gate still catches it.

**Consequence:** Invariants live in the DDL (§11), the auth spec (§9), and the API spec (§13). All three must be updated when an invariant changes.

**Reject in review:** an invariant enforced in only one layer.

---

## 16.4 Append-only audit as a first-class citizen

**Rule:** The audit log is migration 003 — before any feature table. Blocked at the database level so even the app itself cannot modify it *(DECIDED Phase 1: by the `audit_log_no_update_delete` trigger rather than `REVOKE UPDATE, DELETE` — no least-privilege login exists, and the trigger binds every role including the owner. §11.8)*. Every accountability-bearing mutation writes its audit row(s) — usually one; compound actions like deactivation write one per effect (13.1.4), batched instantiation may write one summarizing row (13.3.2) — always inside the same transaction as the work. The single designed carve-out is `personal_task.crud` — a private scratchpad with no accountability value (§9.6 ¹¹ / §14.10); it is defined here, once, and nothing else joins it without an amendment.

**Why:** The audit log is the ultimate source of truth for "what happened." Without it, "who deleted this?" has no answer. With it — and with immutability enforced at the DB — the answer is always available and always trusted.

**Consequence:** No feature can ship without its audit format specified. Every mutation test (§15.4) asserts an audit row exists.

**Reject in review:** a mutation without a corresponding audit call, or an audit call outside the transaction.

---

## 16.5 Least privilege, verified at the point of use

**Rule:** `authorize()` runs at the top of every action, not in middleware (*DECIDED Phase 1: the file is `proxy.ts` in Next 16.3*). Middleware handles login redirects only. Role and active status are read from the DB on every request — never trusted from a JWT or session cookie.

**Why:** A user who was deactivated 5 seconds ago shouldn't be able to complete an action they started 6 seconds ago. Reading role from the DB every request costs one query; letting a deactivated user delete client data costs the business.

**Consequence:** The custom ESLint rule `easygrowcrm/authorize-first` (§12.5) enforces this at build time. HR sees a scoped audit log without knowing there's a bigger one — silent scoping, not toggleable.

**Reject in review:** a role check anywhere but through `can()` / `authorize()`; a role read from anywhere but the current request's DB lookup.

---

## 16.6 Server-authoritative for anything that matters

**Rule:** The timer, break allowance, sign-out eligibility, gate results, leave day math — all computed on the server. The client displays what it's told; it never decides.

**Why:** The client is untrusted regardless of who's using it. A rushed employee, a well-meaning developer, or a browser extension can all lie to the client without malice. Nothing that affects an accountability record can be client-computed.

**Consequence:** `getMyTimer` is polled every 30s + ticked client-side between polls, but the actual eligibility flip (timer turns green, sign-out unlocks) comes from the server. The client-side tick is cosmetic.

**Reject in review:** a client-computed field that any policy depends on.

---

## 16.7 Strict data hierarchies, no shortcuts

**Rule:** Domain models are strict trees, walked through explicit helpers. No denormalized "for convenience" fields. No parallel flat lists next to the hierarchy.

**Why:** Denormalization is a debt that comes due at the worst possible time — usually during a data migration or a bug hunt. The Templates rewrite from flat `tasks[]` to `months[] → cats[] → tasks[] → subtasks[]` was three sessions of pain because the flat list and the hierarchy fought each other in the render, save, and clone paths.

**Consequence:** `tplAllTasks(t)` is the *only* way to flatten a template. Snapshots are not shortcuts: live `project_tasks` carry `category` and `month` as **materialized copies written once at instantiation** (13.3.2) — that's the product requirement ("running projects hold copies; template edits never touch them"), not denormalization. The banned thing is a *live cache* of a parent that also exists as a FK — data that can drift. A snapshot cannot drift because its source is, by design, disconnected.

**Reject in review:** a "for convenience" denormalized field, a parallel flat cache of a hierarchical structure, or any new field that mirrors a FK-reachable live parent.

---

## 16.8 Fail loudly, fail early, fail with a name

**Rule:** Every error has a code (`GATE`, `CONFLICT`, `NOT_FOUND`, `FORBIDDEN`, `VALIDATION`, `UNAUTHENTICATED`, `DEACTIVATED`), carried by the canonical **`AppError`** class (`lib/errors.ts`, PUL-106 — never a bare `Error`, §12.11). Every gate error names the specific field or task that failed. Every conflict error offers a refresh action. Nothing is silently swallowed.

**Why:** A caught exception that doesn't reach a human is a bug. Generic "Something went wrong" toasts hide the actual problem and train users to retry blindly.

**Consequence:** The toast layer maps error codes 1:1 to user-facing messages. `GATE:checklist_incomplete` becomes *"'Homepage design': checklist has 2 unchecked items."* The user knows what to do.

**Reject in review:** a caught exception without a re-throw or a coded error; a toast without a specific field/task name for gate errors.

---

## 16.9 Convention over configuration, ruthlessly

**Rule:** If two places do the same thing, they use the same code. One `fmtHM` for time, one `fmtDate` for dates, one `HMInput` for time entry, one canonical query function per surface (`getReviewQueue` powers three views).

**Why:** Copy-paste variants drift. The audit-log page will start showing dates in a different format than the attendance page, then someone will file a bug, then someone will "fix" it in one place and forget the other. Shared code = one truth.

**Consequence:** Every new date display goes through `fmtDate`. Every new time input uses `HMInput`. Every new list of reviews queries `getReviewQueue`. The custom ESLint rules enforce a subset of this (`easygrowcrm/authorize-first`, `easygrowcrm/no-direct-date` — §12.5); the rest is caught in review.

**Reject in review:** a hand-rolled date format, a raw `<input type="time">`, or a bespoke query that duplicates an existing canonical one.

---

## 16.10 Explicit state, no lazy initialization

**Rule:** All state keys are declared in the state object at creation. No scattered `if (!state.x) state.x = {}` lazy initializers.

**Why:** The prototype had `S.tplCollapsed`, `S.tplView`, `S.projFilter`, `S.projId`, `S.projTab`, `S.collapsed` scattered as lazy inits through the code. Any code path that ran before the lazy init found `undefined` and either crashed or silently misbehaved. Months disappeared after re-renders. The fix was declaring every key upfront in `S = { ... }`.

**Consequence:** State schemas are documented in one place. New keys go in the declaration, not a lazy check. Type-safe access is possible.

**Reject in review:** a lazy `if (!state.key)` initializer for a key that should be part of the state schema — and any `window.*` global used as component state (the prototype's `window._mwiz` / `window._tftSubs` pattern; §14.4.3–4: the real build uses declared component state).

---

## 16.11 Ports & adapters at the boundary

**Rule:** External systems (auth provider, DB, job queue, notifications, time) are accessed through interfaces defined in the app, not by importing library types directly into feature code.

**Why:** Better Auth might be replaced. pg-boss might be swapped for Redis-based BullMQ. The clock needs to be freezable in tests. Feature code should not care.

**Consequence:** `features/attendance/actions.ts` imports `notify` from `lib/notifications`, not `sendgrid` directly. It imports `clock.now()` from `lib/clock`, not `Date.now()`. Swapping a provider changes one adapter file, not every feature.

**Reject in review:** direct imports of external libraries into feature code where a port exists.

---

## 16.12 Words matter — the language rules

**Rule:** Certain words are banned in certain surfaces because they lie to users:
- **"Completed"** never renders in an employee-facing surface (Amendment I) — it collides with the QC-bypass meaning the word carries for managers. Employees see "Done — send to review."
- **"Stuck"** never labels a status — it collided with "Blocked" and confused everyone.
- **"Score"** appears nowhere in EasyGrowCrm — the whole scoring system was deleted. Any resurfacing is a violation, not an oversight.

**Why:** Consistent language is a feature. Ambiguous language is a bug that manifests as user error, then as data error, then as an argument between two employees.

**Consequence:** CI greps for "Completed" in `features/attendance` and `features/daily-plan`, **and for "Score" in all `features/**` UI strings** (PUL-809, §14.15 r.7 — mechanical, not reviewer memory).

**Reject in review:** any resurfacing of a banned word.

---

## 16.13 Deletes are confirmations; edits are not

**Rule:** Confirmation dialogs exist for destructive irreversible actions: deactivate, delete (project/template/client/month/category), leave reversal, archive. Never for routine status changes, checkbox toggles, or content edits.

**Why:** Confirmation dialogs on routine actions train users to click through them without reading, at which point they become useless *and* annoying. Reserving them for destructive actions preserves their meaning.

**Consequence:** Every confirmation prompt states what will happen ("Remove month and all its tasks?"), not a generic "Are you sure?".

**Reject in review:** a `confirm()` on a non-destructive action, or a generic "Are you sure?" prompt.

---

## 16.14 Dates always carry the year

**Rule:** `fmtDate(due)` renders `Aug 8, 2026`. Bare `Aug 8` is banned. Relative labels ("Today", "In 2d", "3d overdue") may appear as suffixes or secondary lines, never as the primary date.

**Why:** A recurring monthly cycle with "Aug 8" on every task is ambiguous — is that this August or next August? At retainer-close time, the ambiguity becomes a billing dispute.

**Consequence:** Every date display goes through `fmtDate`. The calendar header is `August 2026`, not `August`. Attendance history shows `Aug 06, 2026`, not `Aug 06`.

**Reject in review:** any bare month-day date rendering.

---

## 16.15 Optimistic UI only where correctness doesn't matter

**Rule:** Optimistic UI (update before the server confirms) is allowed for: pill changes, subtask/checklist toggles, comment posts, notification reads. It is banned for: sign-in, sign-out, submit, review, leave decisions.

**Why:** Optimistic UI is faster but wrong for accountability actions. The user needs to see the server confirm "you signed in at 9:14" — an optimistic "you're signed in" that later fails silently is worse than a 400ms wait.

**Consequence:** The Sign-Out button shows a spinner and stays disabled until the atomic transaction returns. The status pill flips instantly.

**Reject in review:** an accountability action rendered optimistically.

---

## 16.16 The prototype is visual reference, not source of truth

**Rule:** The PRD wins where it conflicts with the prototype. Amendment A codified this at the start; we restate it because it will keep coming up.

**Why:** The prototype has been iterated dozens of times as a design tool. It carries scars — old flows, old labels, old data models — that were consciously abandoned. Someone who reads only the prototype will resurrect them.

**Consequence:** The prototype demonstrates the *look*; §9–§14 define the *behavior*. When they disagree, the doc wins.

**Reject in review:** a PR that cites the prototype for a behavior change and doesn't cite a PRD section.

---

## 16.17 When to break a principle

Principles are heuristics that pay their rent 95% of the time. The other 5% is real. To break a principle:

1. Say which principle and why it doesn't apply here (in the PR description).
2. Get a second pair of eyes to confirm.
3. If the exception recurs, edit the principle in this doc — don't accumulate silent exceptions.

The one principle that has no exception is **§16.4 (append-only audit)** — because the audit is the record of every other decision, including the one to break another principle. The `personal_task` carve-out defined inside §16.4 is part of the principle's scope, not an exception to it: no mutation inside the accountability scope may skip audit, and nothing may leave that scope without an amendment.

---

## 16.18 Reading order for a new engineer

1. This doc (§16) — 20 minutes.
2. §9 Auth & Authorization — 30 minutes.
3. §12 Tech Stack & Architecture, especially §12.11 (the mutation shape) — 20 minutes.
4. §13 API Contract, skim — 20 minutes for shape, deep-read the action you're about to build.
5. §15 Testing Strategy — 15 minutes.
6. The PRD section for the feature you're building — 15 minutes.
7. §17 Build Plan — §17.1–§17.2 plus the ticket you're about to run — 15 minutes.

That's ~2 hours to be productive. Cheaper than one wrong PR. (§17.6 repeats this list from the build plan's side; they are intentionally the same order.)
