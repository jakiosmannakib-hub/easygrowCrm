# Working agreement — EasyGrowCrm

How we collaborate on this repo. This is the *process*; `CLAUDE.md` is the *engineering rules*. Read both.

**Roles:** Toki builds. Jaki (product owner) reviews and merges. Nobody merges their own work to `main`.

---

## The loop, one ticket at a time

1. **Pick the next ticket.** Take the lowest-numbered open ticket in `§17` whose dependencies are done (e.g. `PUL-101`). Read its subtasks, its "Done when", and the PRD section its `Reads:` line points to — before writing any code.

2. **Branch off `main`.** One branch per ticket. Name it for the ticket, e.g. `feat/pul-101-drizzle-setup`.
   ```bash
   git checkout main
   git pull
   git checkout -b feat/pul-101-drizzle-setup
   ```

3. **Build it — including its tests.** A ticket is not done without the tests its "Done when" and `§15` require. Code and tests land in the same branch.

4. **Push and open a PR to `main`.**
   ```bash
   git push -u origin feat/pul-101-drizzle-setup
   ```
   Then open the PR on GitHub. Title it with the ticket number, e.g. `PUL-101: Drizzle setup + first migrations`. In the description, note what it does and check off the ticket's subtasks.

5. **CI runs automatically.** `tsc` → ESLint → Vitest (+ `drizzle-kit check` once migrations exist). If it goes **red**, fix on the *same branch* and push again — the PR and CI update in place. Do not open a new PR.

6. **Jaki reviews and merges.** Jaki reads the PR, confirms CI is green, and merges. Then the branch is deleted.

---

## Rules that keep this working

- **One ticket per PR.** Keeps each PR small enough for Jaki to actually review. Don't batch multiple tickets into one branch.
- **Never merge a red PR.** Branch protection is *not* enforced on our current plan, so this is a manual discipline. Red CI = do not merge, period.
- **Toki does not self-merge.** Even when CI is green, Jaki merges — that's the product owner's control point.
- **Fix-forward on the same branch.** CI red, review comments — all handled by pushing more commits to the existing branch.
- **Docs-only changes are relaxed.** Updating the build plan, notes, or this file doesn't need the full ceremony — a small branch or a direct commit to `main` is fine.
- **Keep `pnpm-lock.yaml` committed.** CI installs with `--frozen-lockfile`; an out-of-date lockfile fails the build.

---

## Environment notes

- Windows + PowerShell: chain commands with `;`, not `&&`.
- `pnpm db:up` / `pnpm db:down` — local Postgres (Docker).
- `pnpm test:db:reset` — wipe the test database clean.
- `pnpm exec tsc --noEmit` — run the exact type-check CI runs, before pushing.

---

## Parked (don't mistake for forgotten)

- **PUL-003.4** — branch protection not enforced (free plan / personal account). Revisit if EasyGrow moves to a GitHub Team org.
- **PUL-004** — staging server, deferred until after Phase 3.
