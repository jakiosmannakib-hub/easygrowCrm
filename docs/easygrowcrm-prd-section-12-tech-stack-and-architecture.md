# §12. Tech Stack & Architecture — EasyGrowCrm

**Status:** Final. Next.js 16.2 LTS. **Hosting: Vercel (full Next.js app) + Render (managed Postgres + one background worker). See §12.9.**

**One-line summary:** Next.js 16 (App Router, latest 16.2 LTS) + PostgreSQL 16 + Better Auth + Drizzle ORM + Tailwind + shadcn/ui, deployed as a **Vercel-hosted Next.js app with a Render-hosted Postgres and a Render background worker**, single tenant.

---

## 12.1 The stack — every choice, one line each

| Layer | Choice | Version | Why |
|---|---|---|---|
| Runtime | **Node.js** | 22 LTS | Standard Next.js target; long-term support. |
| Language | **TypeScript** | 5.5+ | Strict mode on. No `any` without a `// eslint-disable` comment and a reason. |
| Framework | **Next.js** | **16 — pin latest 16.2.x LTS** | Owner-selected. Server Actions (fully stable in 16) are the mutation model (§12.4). Turbopack is the default dev bundler. **Update on every Next security release** — the RSC advisories of 2025–26 hit all major lines; staying on the LTS patch train is mandatory, not optional. |
| UI runtime | **React** | 19.2 | Ships with Next 16; `useActionState` for form flows; React Compiler support stable. |
| Database | **PostgreSQL** | 16+ | Owner-selected. Constraints from §11 depend on it. |
| ORM | **Drizzle** | latest stable | SQL-first, matches §11 1:1, no code-gen step, transaction API is a thin wrapper around SQL — matters because our sign-out is a real transaction. Alternatives (Prisma) considered; verdict in §12.10. |
| Migrations | **drizzle-kit** | latest stable | Migrations are versioned SQL files in the repo; applied in CI and on deploy. |
| Auth | **Better Auth** | ≥ 1.6 | Locked in §9. Google OAuth only. |
| Styling | **Tailwind CSS** | 4 | The prototype uses Tailwind; carrying it forward preserves visual work. |
| UI kit | **shadcn/ui** | current | Copy-in components, no runtime lock-in. |
| Icons | **lucide-react** | current | Matches shadcn defaults. |
| Forms + validation | **react-hook-form + Zod** | current | Zod schemas double as input validators inside server actions. |
| Data fetching (client) | **TanStack Query** | v5 | Server components handle most reads; TanStack Query handles interactive lists (Board, review queue, break timer polls). |
| Charts | **Recharts** | current | Kept from prototype. |
| Excel export | **exceljs** | ^4.4 | Server-side only (route handlers under `app/api/export/`). **Changed at PUL-413, was SheetJS (xlsx):** the `xlsx` package on npm is frozen at 0.18.5 with known advisories, and exceljs writes cell hyperlinks and styling, which the client export's Deliverable column needs. |
| Queue / cron | **pg-boss** | current | Uses our Render Postgres — no Redis. Handles the webhook outbox, the 10-hour auto-close, and any nightly jobs. Runs in a **dedicated Render Background Worker** (Vercel serverless can't host a long-lived queue), sharing the same repo and DB as the app. |
| Email (second notification channel) | **TBD** (Resend / SendGrid / etc.) | current | **DECIDED (Phase 1): email is a real delivery channel, not "future alerts only".** It rides the same `webhook_outbox` + Render worker as the Discord webhook; the adapter is chosen in PUL-801. |
| Testing | **Vitest** + **Playwright** | current | Vitest for `can()` + business rules; Playwright for the sign-in/sign-out and QC end-to-end flows. |
| Lint / format | **ESLint** + **Prettier** | current | Standard. Custom rule in §12.5. |
| Package manager | **pnpm** | current | Fast, disk-efficient. |
| Deployment | **Vercel (app) + Render (Postgres + worker)** | — | See §12.9 v3. |

**Not on this list, deliberately:** Redis, a separate queue service, Prisma Accelerate, a CDN for user assets (we store none), an image processing pipeline (no selfies), a mobile framework, a native app shell, tRPC, GraphQL, a state management library beyond React + TanStack Query, an email service at launch. Every one of these is a maintenance surface we don't need for 20 users.

---

## 12.2 Folder structure

Flat, App Router-native. **Feature folders** for anything with multiple files (auth, projects, attendance) — not a top-level `services/` graveyard.

```
easygrowcrm/
├── app/
│   ├── (auth)/
│   │   ├── sign-in/page.tsx
│   │   └── layout.tsx                 # unauthenticated shell
│   ├── (app)/                         # authenticated shell — everything below requires a session
│   │   ├── layout.tsx                 # sidebar nav + session guard (redirect only)
│   │   ├── dashboard/page.tsx         # role-branched: AdminDashboard | EmployeeDashboard (§14.2)
│   │   ├── projects/
│   │   │   ├── page.tsx
│   │   │   └── [projectId]/page.tsx
│   │   ├── attendance/page.tsx
│   │   ├── review/page.tsx            # canonical agency-wide review queue (§9.6, F)
│   │   ├── leave/page.tsx
│   │   ├── templates/
│   │   │   ├── page.tsx
│   │   │   └── [templateId]/page.tsx  # hierarchy detail view (§14.4.2)
│   │   ├── my-tasks/page.tsx          # MGR + HR (§14.10)
│   │   ├── daily-plan/page.tsx        # (§14.7)
│   │   ├── eod/page.tsx               # (§14.8)
│   │   ├── reports/page.tsx           # MGR + HR (§14.11)
│   │   ├── employees/page.tsx         # SA + HR only
│   │   ├── settings/page.tsx          # SA + HR only (incl. clients section, §9.6 ¹⁰)
│   │   └── audit/page.tsx             # SA + (HR-scoped)
│   ├── api/
│   │   └── auth/[...all]/route.ts     # Better Auth handler
│   └── layout.tsx                     # root
│
├── lib/
│   ├── clock.ts                       # clock.now() port — prod + freezable test adapter (PUL-108)
│   ├── errors.ts                      # AppError + the §13 error codes (PUL-106)
│   ├── notifications.ts               # notify() port — stub → DB adapter, interface fixed (PUL-107)
│   ├── auth/
│   │   ├── auth.ts                    # betterAuth() config (§9.2)
│   │   ├── require-user.ts            # requireUser() — reads role/active from DB every request
│   │   ├── can.ts                     # can(user, action, resource) — pure function of §9.6
│   │   └── authorize.ts               # authorize(action, resource) — used at top of every action
│   ├── db/
│   │   ├── client.ts                  # Drizzle client (one connection pool per process)
│   │   ├── schema/                    # §11 as Drizzle table definitions, one file per group
│   │   │   ├── auth.ts                # Better Auth tables + user extensions
│   │   │   ├── clients-projects.ts
│   │   │   ├── tasks.ts
│   │   │   ├── templates.ts
│   │   │   ├── attendance.ts
│   │   │   ├── daily-eod.ts
│   │   │   ├── leave.ts
│   │   │   ├── notifications.ts
│   │   │   └── audit-settings.ts
│   │   └── tx.ts                      # withTx() helper (§12.6)
│   ├── audit/
│   │   └── write.ts                   # writeAudit() — always called inside a transaction
│   ├── queue/
│   │   └── jobs.ts                    # pg-boss setup + job definitions (webhook, auto-close)
│   ├── time/
│   │   ├── dhaka.ts                   # timezone helpers (Asia/Dhaka)
│   │   ├── net-minutes.ts             # server-authoritative timer math
│   │   └── work-days.ts               # Sun–Thu, holidays exclusion
│   ├── validation/                    # Zod schemas per resource
│   ├── permissions.ts                 # the (role, action, scope) map from §9.6, machine-readable
│   └── util/
│       ├── ids.ts                     # uid('pt') style prefixed IDs
│       └── hm.ts                      # h+m ↔ decimal-hours conversion
│
├── features/                          # server actions + colocated UI, one folder per feature
│   ├── projects/
│   │   ├── actions.ts                 # createTask, submitTask, reviewTask, approveTask, …
│   │   ├── queries.ts                 # server-only reads
│   │   └── components/
│   ├── attendance/
│   │   ├── actions.ts                 # signIn, startBreak, endBreak, signOut, earlySignOut
│   │   ├── queries.ts
│   │   └── components/
│   ├── leave/
│   ├── review/
│   ├── employees/
│   ├── clients/                       #
│   ├── templates/
│   ├── eod/                           #
│   ├── daily-plan/                    #
│   ├── reports/                       #
│   └── audit/
│
├── components/ui/                     # shadcn primitives
├── components/                        # shared cross-feature components (StatusPill, Modal, HMInput, …)
│
├── drizzle/                           # generated migrations (SQL files, checked in)
├── scripts/
│   ├── seed.ts                        # dev/staging seed
│   └── auto-close.ts                  # legacy — real auto-close runs via pg-boss
├── tests/
│   ├── unit/                          # can() tables, net-minutes math, quota math
│   └── e2e/                           # Playwright: sign-in→sign-out, submit→review
│
├── .env.example
├── drizzle.config.ts
├── next.config.ts
├── tsconfig.json
└── package.json
```

> **DECIDED (Phase 1) — the flat layout supersedes the folder sketch above.** The nested
> `lib/auth/` and `lib/db/` folders were not adopted: `lib/` holds one file per concern and `db/`
> sits at the repo root. As built: `lib/auth.ts`, `lib/auth-guards.ts`, `lib/auth-client.ts`,
> `lib/session.ts`, `lib/authz.ts` (the §9.6 table + `can()` + `authorize()`), `lib/errors.ts`,
> `lib/action-result.ts` (the PUL-111 boundary, §12.4),
> `lib/mutation.ts` (`withTx`), `lib/notifications.ts`, `lib/clock.ts`, `lib/nav.ts`,
> `lib/route-guard.ts`; `db/index.ts`, `db/schema/*`, `db/migrations/`. Nothing lives at
> `lib/auth/can.ts`, `lib/auth/authorize.ts`, `lib/db/tx.ts` or `lib/permissions.ts` — imports
> across the codebase assume the flat paths. **The RULES below are unchanged** (ports in `lib/`,
> feature slices own their code, only `features/*/actions.ts` writes); only the folder shape is.
> CLAUDE.md §4 carries the same table.

**Rules:**
- **`features/*/actions.ts` is where mutations live.** Nothing outside `features/` and `app/api/auth/` may write to the DB.
- **Server actions are the only mutation endpoint.** No REST endpoints, no tRPC. The one exception is Better Auth's mounted handler.
- **Route handlers** (`route.ts`) are used only for OAuth callbacks and (later) webhook receivers. Never for our own mutations.
- **UI never talks to Drizzle directly.** UI → server action → `authorize()` → transaction → `writeAudit()` → commit. Every time.

---

## 12.3 The authorization layer

Exactly one function protects every mutation. This is the single most important line of code in EasyGrowCrm.

> **DECIDED (Phase 1) : names as built.** `requireUser()` in the sketches below is
> **`getSessionUser()`** (`lib/session.ts`); `can()` and the §9.6 table live in `lib/authz.ts`
> alongside `authorize()`, not in a separate `can.ts`. Behaviour is exactly as written here.
> See the flat-layout note in §12.2 and §9.5 rule 4.

```ts
// lib/authz.ts   (DECIDED Phase 1: flat layout)
import { requireUser } from "./require-user";
import { can, type Action, type Resource } from "./can";
import { AppError } from "@/lib/errors";   // AppError carries the §13 error codes

export async function authorize(action: Action, resource?: Resource) {
  const user = await requireUser();          // DB read of role + active. Every request.
  if (!can(user, action, resource)) {
    await logAuthzDenied(user, action, resource);  // §9.8 — intrusion signal
    throw new AppError("FORBIDDEN");
  }
  return user;
}
```

```ts
// require-user.ts — read from DB, never from the session
export async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new AppError("UNAUTHENTICATED");

  const [row] = await db.select({
      id: user.id, email: user.email, role: user.role, active: user.active
    })
    .from(user).where(eq(user.id, session.user.id)).limit(1);

  if (!row?.active) {
    await auth.api.signOut({ headers: await headers() });  // kill the session on the spot
    throw new AppError("DEACTIVATED");
  }
  return row;
}
```

**Middleware** (`proxy.ts` — *DECIDED Phase 1: Next 16.3 deprecated the `middleware` file convention in favour of `proxy`; same hook, same caveats*) does one thing and one thing only: **if there is no session cookie and the path is inside `(app)/`, redirect to `/sign-in`.** It never checks role. It never gates mutations. It is a UX convenience, not a security boundary. This is §9.5, rule 1, in code.

**`can()` is a pure function.** Every row in the §9.6 permission table is a test case — the whole table becomes a `.test.ts` file. If a permission decision is not covered by a test, it doesn't ship.

---

## 12.4 The mutation shape — every server action looks like this

```ts
// features/projects/actions.ts
"use server";
import { z } from "zod";
import { authorize } from "@/lib/authz";   // DECIDED Phase 1: flat layout, not lib/auth/
import { withTx } from "@/lib/mutation";   // DECIDED Phase 1: flat layout, not lib/db/tx
import { actionResult } from "@/lib/action-result";   // DECIDED Phase 1 (PUL-111)
import { writeAudit } from "@/lib/audit/write";

const ApproveInput = z.object({
  taskId: z.string(),
  rating: z.number().int().min(1).max(5).optional(),
});

export async function approveTask(input: z.infer<typeof ApproveInput>) {
 return actionResult(async () => {                    // 0. BOUNDARY (PUL-111)
  const parsed = ApproveInput.parse(input);          // 1. VALIDATE
  const task = await getTaskForApproval(parsed.taskId);
  const actor = await authorize("project_task.review", task);   // 2. AUTHORIZE
                                                               //    (blocks self-review by §9.7-1)

  return withTx(async (tx) => {                       // 3. TRANSACT
    const submission = await getLatestSubmission(tx, task.id);
    if (!submission) throw new AppError("GATE", "No submission to review");

    const [review] = await tx.insert(taskReviews).values({
      id: uid("tr"), submissionId: submission.id, taskId: task.id,
      reviewerId: actor.id, submitterId: submission.submittedBy,
      decision: "approved", rating: parsed.rating,
    }).returning();

    const [after] = await tx.update(projectTasks)
      .set({ status: "approved", qualityRating: parsed.rating ?? null,
             version: sql`version + 1`, updatedAt: clock.now() })   // clock port, never new Date()
      .where(and(eq(projectTasks.id, task.id), eq(projectTasks.version, task.version)))
      .returning();
    if (!after) throw new AppError("CONFLICT");      // optimistic lock (§11.3)

    await writeAudit(tx, {                            // 4. AUDIT (same tx)
      actorId: actor.id, action: "project_task.approved",
      resourceType: "project_task", resourceId: task.id,
      before: { status: task.status }, after: { status: "approved" },
    });

    return { review, task: after };
  });
                                                     // 5. NOTIFY (after commit — outside tx)
                                                     //    ...enqueue Discord + email + in-app notif
 });
}
```

**Every mutation follows the same five steps: validate → authorize → transact → audit (same tx) → notify (after commit).** This is not a suggestion; it's a code-review rule and every review rejects anything else.

> **DECIDED (Phase 1, PUL-111) : the five steps now sit inside a sixth: the `actionResult` boundary.**
> Every exported server action returns `Promise<ActionResult<T>>`, a discriminated union of
> `{ ok: true, data }` and `{ ok: false, code, reason?, message, details? }`. No expected error
> crosses the server-action boundary as a throw any more.
>
> **Why:** Next.js redacts an error thrown out of a Server Action in a **production** build. The
> message is replaced with a generic string plus a `digest`, and custom properties (our `code`, our
> `meta.reason`) are stripped entirely. That is a deliberate security feature and is not
> configurable per error. Before PUL-111 every typed failure therefore collapsed at the boundary in
> production only: `GATE:last_managers`, `FORBIDDEN` and `CONFLICT` all arrived at the client as the
> same anonymous object, so the toast mapper fell through to "Something went wrong" for all of them.
> In dev, where Next passes errors through intact, everything looked correct. A **returned** value
> is ordinary data, so React serializes it and hands it to the client verbatim.
>
> **`AppError` is still the internal language, and is still thrown INSIDE the body.** A throw is
> what unwinds the transaction and rolls the audit row back with the work it records (§16.4), so
> action bodies, `authorize()`, `withTx` callbacks and every helper keep throwing. **Only the
> outermost boundary converts.** Nothing below `actionResult` knows the file exists.
>
> **Non-`AppError` throws are re-thrown, deliberately.** A `TypeError`, a driver connection
> failure, a bug: none are part of the §13 contract, and their messages and stacks are exactly what
> production redaction exists to hide. They stay throws, stay redacted, and reach the client as an
> opaque digest that the toast mapper renders as the generic line. Swallowing them into a typed
> result would be a security regression and would mislabel a crash as a handled outcome.
>
> **Shape note:** the exported function stays an `async function` declaration wrapping the call.
> Writing `export const myAction = actionResult(async () => …)` instead silently disables the
> `easygrowcrm/authorize-first` lint rule for that action.

---

## 12.5 The two custom ESLint rules that save the project

```
easygrowcrm/authorize-first     (authorize() must be the first awaited call in every action)
easygrowcrm/no-direct-date      (the clock-port rule, PUL-108.2 / §15.8)
```

**`authorize-first`** fails the build if a file inside `features/*/actions.ts` exports a `"use server"` async function that does not have `authorize(` as an identifier in its body (with it positioned as the first awaited call after validation — PUL-105.3). Cheap to write, catches the one mistake that costs everything.

**`no-direct-date`** bans `new Date()` and `Date.now()` anywhere in `features/**` — every time read goes through `lib/clock.ts` (`clock.now()`), which is freezable in tests. Without this rule, time-dependent logic (late detection, auto-close, timer unlock) is untestable and drifts back in one lazy commit.

Related conventions (code review, not lint):
- Anything that writes to the DB from outside `features/*/actions.ts` fails review.
- Anything that logs an audit row **outside** a transaction fails review — `writeAudit` must accept a `tx` parameter, not the global `db`.
- The word `"Completed"` must not appear as a UI label in any employee-facing component, and `"Score"` nowhere in `features/**` UI strings — both blocked mechanically by the CI forbidden-words grep (PUL-809), not just review.

---

## 12.6 Transactions — the sign-out is why we care

```ts
// lib/mutation.ts   (DECIDED Phase 1: flat layout)
export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn, { isolationLevel: "read committed" });
}
```

The atomic sign-out from §10.5 is the load-bearing use of this: attendance close + open break close + daily-task updates + project-task status changes + submissions insert + eod_report insert + N audit_log rows — all in one call, all or nothing. On failure the client sees an error and retries; a partially signed-out state cannot exist.

**Rule:** anything that touches more than one table in a single logical action must run inside `withTx`. When in doubt, use `withTx`. Transactions on Postgres are cheap; corruption is not.

---

## 12.7 The three background workers (all in one queue)

**pg-boss** runs jobs in the same Postgres. No Redis. Three jobs at launch:

1. **`webhook.deliver`** — reads `webhook_outbox`, POSTs to **Discord** (and sends the **email** channel), exponential backoff on failure. Producer: the last step of any server action that fires a notification (enqueue after `withTx` commits) — the action runs on Vercel and only *writes a row* to `webhook_outbox`; the **Render worker** picks it up and delivers it. This is why a dead webhook can never block a commit, and why delivery doesn't need a long-lived process on Vercel's side.
2. **`attendance.auto-close`** — runs every 5 minutes **on the Render worker** (pg-boss scheduled job — not Vercel Cron, not Render Cron: it must share the same queue instance and retry semantics as the outbox). Finds `attendance` rows where `sign_out_at IS NULL` and `now() - sign_in_at ≥ interval '10 hours'`, closes them with `sign_out_type='auto_closed'`, ends any open break, caps `net_minutes` at shift end, writes an audit row. Server-side, per §10.6. **This job is load-bearing: if the worker is down, forgotten sign-outs never close. The worker's liveness is monitored (§12.9 v3).**
3. **`notifications.fanout`** *(optional, launch-later)* — batches in-app notifications for template instantiation (which can fire 10+ at once).

**Explicitly not doing at launch:** cron for daily reports, cron for score computation (no scores), retry on OAuth, image processing.

---

## 12.8 Timezones — non-negotiable

Every timestamp is `timestamptz`. Every `date` column represents an **Asia/Dhaka calendar day**, not a UTC-derived day. The `lib/dates.ts` helpers do the day and working-day arithmetic, and `dhakaToday()` in `lib/format.ts` gives today's Asia/Dhaka day from the clock port. Server logic never touches `Date.now()` for date decisions — it uses the helpers.

> **As built (flat `lib/`, see CLAUDE.md §4):** there is no `lib/time/` folder. `lib/dates.ts` (PUL-505) holds `addDays`, `addMonthsClamped`, `weekday`, `isWorkingDay`, `shiftToWorkingDay`, `shiftBackToWorkingDay` and `nextWorkingDay`. They work on `YYYY-MM-DD` strings through integer day numbers and never build a `Date` from a bare day. `lib/dates.ts` also stands in for the sketch's `work-days.ts`; the working-day helpers were written for PUL-702 to reuse.

Rule of thumb: if a piece of code has to know whether "today is Thursday," it uses `todayInDhaka()`. If it needs the current instant, it uses **`clock.now()`**. `new Date()` / `Date.now()` are banned in `features/**`; the clock port is the only source of "now", and `todayInDhaka()` itself reads from it. These are different questions and this codebase separates them — but both answers flow from the same injectable clock, which is what makes frozen-time tests like "auto-close fires at exactly hour 10" possible (§15.5).

---

## 12.9 Deployment — small, boring, one machine

Single **paid** VPS (owner-confirmed — free tiers like Oracle Always Free are disqualified: idle-reclaim policies and zero SLA are incompatible with a daily-attendance system that must exist at 9 AM every workday). **Recommendation: Hetzner, Singapore location, 4 vCPU / 8 GB / NVMe (~$9/mo)** — ~50–70ms to Bangladesh, imperceptible for a web app. Alternatives if a South-Asia region is preferred: DigitalOcean Bangalore or Vultr Mumbai (~$20–24/mo). Enable the provider's **automated snapshots** (~$2/mo) *in addition to* the nightly `pg_dump` below. Total hosting line item: ~$11/month, all-in. **Everything runs in Docker Compose** on that machine:

```
services:
  app:       # Next.js in standalone output mode, port 3000
  postgres:  # Postgres 16, volume-mounted /var/lib/postgresql
  caddy:     # reverse proxy + auto TLS from Let's Encrypt
  backups:   # pg_dump nightly → off-box object storage
```

- **App runs long-lived** — this is not serverless. No cold starts, no connection-pooling proxy, no edge functions. Simpler mental model, works fine at this scale.
- **Migrations** run in the app container on startup (`drizzle-kit migrate`). One process on the machine holds an advisory lock so parallel starts don't race.
- **Backups**: `pg_dump` nightly, encrypted, off-box. Retention 30 days. **Restore is tested monthly** — an untested backup is a rumor.
- **Environments:** `production` on the VPS, `staging` on the same VPS via a second Docker Compose file with a different DB name and port. Local dev on the developer's machine.
- **Secrets:** `.env` files, not committed. `.env.example` is committed and shows required keys. Rotate `GOOGLE_CLIENT_SECRET` and `BETTER_AUTH_SECRET` on any incident.

**Why not Vercel:** the free (Hobby) tier is restricted to non-commercial personal use by Vercel's fair-use terms — an internal business tool is commercial use on day one, so the real price is Pro plus a hosted Postgres plus replacing pg-boss (serverless has no long-lived workers). Full rationale in §12.10. For a single-tenant internal tool, a boring VPS is the boring right answer.

**Version policy:** pin Next.js to the latest 16.2.x LTS patch; apply Next.js security releases within a week of publication (they now ship on a regular monthly cadence). Same policy for Better Auth and Drizzle minor versions: update deliberately, monthly, never automatically.

---

## 12.10 Choices that were argued and the answer written down

Recording these here so nobody reopens them in month three.

- **Drizzle over Prisma.** Our schema (§11) is dense with `CHECK` constraints, triggers, and `REVOKE` at the DB level — Drizzle's SQL-first model surfaces these; Prisma abstracts around them. Drizzle's transaction API is a thin wrapper over the SQL `BEGIN` — again, matches how we think about §10.5. Prisma 7 closed the performance gap; the deciding argument is **fit**, not speed. If the team already knew Prisma cold, the argument would flip.
- **Server Actions over REST/tRPC.** Next 16's server actions (stable since 15) are the mutation model the framework wants. Fewer moving parts than API routes; better with `useActionState` for forms. REST endpoints for internal-only calls are a maintenance tax we don't need.
- **pg-boss over Redis + BullMQ.** BullMQ is better at scale; pg-boss is better at 20 users because the queue lives in the DB we already have. One less service to run, monitor, back up.
- **shadcn over Material UI or Chakra.** Copy-in components mean no vendor lock, and the aesthetic is closer to the prototype's Monday-style look.
- **Zod over Yup / superstruct / manual validation.** The Zod schema doubles as the TypeScript input type; a validation change is a one-place change.
- **One VPS over Vercel — re-evaluated at owner's request, decision stands.** The "Vercel is free" premise fails: the Hobby tier's fair-use terms restrict it to non-commercial personal use, and explicitly define commercial as any deployment benefiting anyone paid to build or use it — an internal business tool qualifies on day one, and Vercel enforces this. The real price is Pro ($20/mo + seats + usage) **plus** a hosted Postgres elsewhere (Neon/Supabase — another service, another region) **plus** re-architecting §12.7: pg-boss needs a long-lived process, which serverless doesn't provide. At 20 known users in one timezone with steady daytime load, one machine running everything is cheaper in money *and* in moving parts. Revisit only if the team grows past ~100 users or goes multi-office.
- **One VPS over Vercel + Neon + Upstash + Resend + a chat SaaS.** Every service is a bill, an SLA, an incident channel, and an integration point. At this scale, one machine wins.

---

## 12.11 What Claude Code needs to know from this doc

Bullet form, so this becomes the top of the CLAUDE.md:

- **Every server action:** `actionResult(async () => …)` wrapping validate (Zod) → `authorize()` → `withTx` → `writeAudit(tx, …)` → return. *(DECIDED Phase 1, PUL-111: the five steps sit inside the `actionResult` boundary, which returns a typed `ActionResult<T>` instead of throwing across the server-action boundary (§12.4).)*
- **`authorize()` is the first line.** No exceptions. Enforced by ESLint.
- **`role` and `active` are read from the DB every request.** Never from the session.
- **Middleware never gates mutations.** It only redirects unauthenticated visitors.
- **Nothing outside `features/*/actions.ts` writes to the DB.** No exceptions.
- **`writeAudit` takes a `tx`.** Never call it against the global `db`.
- **`super_admin` is never an assignee.** Enforced by trigger, ESLint won't catch this — code review will.
- **The word "Completed" never appears as an employee-facing UI label.** Use "Done — send to review."
- **Notifications and webhooks are enqueued after `withTx` commits.** Never inside it.
- **Dates that represent working days are Asia/Dhaka calendar days.** Use `lib/dates.ts` and `dhakaToday()` from `lib/format.ts` (§12.8).
- **Never `new Date()` / `Date.now()` in `features/**`.** The clock port (`lib/clock.ts`) is the only source of "now" — enforced by `easygrowcrm/no-direct-date`.
- **Every error carries a §13 code** via `AppError` (`GATE` / `CONFLICT` / `FORBIDDEN` / …), never a bare `Error`. `AppError` is thrown **inside** the action body; the `actionResult` boundary converts it to a returned `{ ok: false, code, reason?, message }` so the code survives production redaction. Anything that is not an `AppError` is re-thrown and stays redacted. *(DECIDED Phase 1, PUL-111: was "All thrown errors carry a §13 code": they are returned now; see §12.4.)*
- **Tests are colocated in `features/**`** per the §15.4 mandatory list; `tests/` holds only fixtures and Playwright flows.
- **Subtasks never gate submission; the checklist does** (§9.6 ⁷ / §14.3.3).
- **When in doubt about permissions, read `lib/permissions.ts` and §9.6 of the PRD.** They are the same table.

---

**Next document:** §13 API / Server Action Contract — every mutation and query listed by name, with its input shape, permission check, transaction shape, and the audit-log row it emits. That is the document each build-plan ticket references.
