# EasyGrowCrm

Internal CRM/HRM for **EasyGrow Digital** — projects, clients, tasks, attendance, leave, and QC in one tool. Single tenant, ~20 users.

---

## Before you write any code

Read the PRD in this order. It's about **2 hours** to be productive — cheaper than one wrong PR. (This mirrors §16.18 and §17.6; they are intentionally the same list.)

1. **§16 — Design Principles** — 20 min. The rules everything else assumes.
2. **§9 — Auth & Authorization** — 30 min.
3. **§12 — Tech Stack & Architecture** — 20 min, especially the mutation shape.
4. **§13 — API Contract** — skim for shape (~20 min); deep-read the one action you're about to build.
5. **§15 — Testing Strategy** — 15 min.
6. **The PRD section for the feature you're building** — 15 min.
7. **§17 — Build Plan** — read §17.1–§17.2 plus the exact ticket you're about to run — 15 min.

Then start at the lowest open ticket number and work top to bottom. A ticket without its tests is not done.

---

## Tech stack

| Layer              | Choice                                    |
| ------------------ | ----------------------------------------- |
| Runtime            | Node.js 22 LTS                            |
| Language           | TypeScript 5.5+ (strict)                  |
| Framework          | Next.js 16 (App Router, LTS)              |
| UI runtime         | React 19.2                                |
| Database           | PostgreSQL 16+                            |
| ORM / migrations   | Drizzle + drizzle-kit                     |
| Auth               | Better Auth (Google OAuth)                |
| Styling            | Tailwind CSS 4 + shadcn/ui                |
| Forms / validation | react-hook-form + Zod                     |
| Client data        | TanStack Query v5                         |
| Queue / cron       | pg-boss (on Postgres, no Redis)           |
| Testing            | Vitest + Playwright                       |
| Package manager    | pnpm                                      |
| Hosting            | Vercel (app) + Render (Postgres + worker) |

Full rationale for every choice is in **§12**.

---

## Project layout

Vertical-slice architecture — code is organized **by feature**, not by technical layer (§16.1). No global `services/`, `controllers/`, or `repositories/` folders.

```
features/        # business logic, one folder per feature (attendance, projects, leave, ...)
lib/             # shared utilities (clock, notifications, ...)
components/ui/   # shared, generic UI components
db/              # Drizzle schema + migrations
tests/           # cross-feature tests (feature tests live inside their slice)
```

---

## Getting started

```bash
pnpm i          # install dependencies
pnpm db:up      # start local Postgres (Docker)
pnpm dev        # run the app
```

Then open http://localhost:3000.

### Common scripts

```bash
pnpm dev        # dev server (Turbopack)
pnpm build      # production build
pnpm test       # run the test suite (Vitest)
pnpm lint       # ESLint
pnpm format     # Prettier
```

---

## Contributing

- Every server action follows the 5-step mutation shape (§16.2): validate → authorize → transaction (work + audit) → notify.
- Audit is written **inside** the transaction; notifications are sent **outside** it.
- The last commit of every ticket includes its tests. No tests, no merge.
- Merges to `main` require green CI.
