# §10. Attendance, Breaks & Sign-Out

**Status:** Final. All decisions confirmed by the product owner.
**Replaces:** PRD §3.4 (sign-in/sign-out flow, EOD score) and related parts of §3.5.

---

## 10.1 The shift model

| Parameter | Value |
|---|---|
| Shift | 8 hours total = **7 hours work + 1 hour break** |
| Work week | Sunday–Thursday (Asia/Dhaka) |
| Grace time for late | 09:15 (existing `GRACE_IN`) |
| Break allowance | **1 hour per day, total across all breaks** |
| Sign-out unlock | **7 hours of NET working time** |
| Half-day target | **3.5 hours of net working time** |
| Auto-close | **10 hours after sign-in** (server-side) |

The values above are the **launch defaults**. Grace time, work target, half-day target, break allowances, and auto-close hours are all **Settings-driven** (§14.14, wired in PUL-903) — the rules in this section always read the current setting, never a hardcoded constant. Shift structure (8h = 7h + 1h) and the Sun–Thu work week are fixed for v1.

**Net working time** = time since sign-in **minus** all break time. Breaks pause the work timer. This is the load-bearing rule: the work timer and break tracking reinforce each other — extra break automatically delays sign-out eligibility. There is no way to "run out the clock" on a long lunch.

---

## 10.2 Sign-in

1. Employee clicks **Sign In**.
2. System records: timestamp, work type (In-office / Remote / Client site — self-declared).
3. If timestamp > 09:15 → row is marked **Late**.
4. Work timer starts, counting net working time.
5. Assigned project tasks due today (status `Planned`, `In Progress`, or `Revision Required`) pre-populate the daily plan. Only `Planned` tasks are pushed to `In Progress`; other statuses are left untouched.

**Removed from sign-in entirely (decided):** selfie capture, geolocation, IP address, network type, `officeIP` CIDR check. No image or location data is collected anywhere in EasyGrowCrm.

---

## 10.3 The work timer

- Counts **net working time** (breaks pause it).
- Displayed prominently on the dashboard.
- **Color states:**
  - Default color while under 7h net.
  - **Green at 7h 00m net** → sign-out unlocked.
  - If a half-day is approved for today: **green at 3h 30m net.**
- The timer is **server-authoritative.** The browser only *displays* it, computed from the server-stored sign-in time and break records. Closing the laptop, losing wifi, or crashing the browser changes nothing — reopening EasyGrowCrm resumes the exact state.

---

## 10.4 Breaks

- **Break button** starts a break: work timer pauses, break clock starts.
- Break clock is **blue** while today's total break time ≤ 1 hour.
- Past 1 hour total: break clock turns **red**, and the employee's status pill shows **"Break exceeded."**
- The 1-hour allowance is the **sum of all breaks** in the day (lunch 40m + prayer 15m + tea 10m = 65m → 5m over → red).
- Break types are kept as informational labels (existing list).
- **No notification is sent to managers on exceedance.** Managers see break totals and exceedance flags in the Attendance view — observation, not alerts.
- A break still running at auto-close (10.6) is closed together with the session.
- On a half-day: break allowance is **30 minutes**.

**No scoring.** Break data is recorded and displayed as fact (total minutes, over/under allowance). There is no point deduction because there are no points (see 10.8).

---

## 10.5 Sign-out

Sign-out is **locked** until the timer is green (7h net, or 3.5h net with an approved half-day).

**The sign-out flow:**
1. Employee reviews today's task list and marks each task's outcome. For project-linked tasks, the completion option is labeled **"Done — send to review"** — choosing it sets the project task to `Submitted` and routes it to the QC queue. *(Renamed from "Completed" to eliminate the collision with the manager-only `Completed` status. The word "Completed" never appears in the employee sign-out flow.)*
   Choosing "Done — send to review" enforces **the same submission gates as the in-task Submit** (§13.4.6 `submitTask`): the task's checklist must be fully ticked (`GATE:checklist_incomplete`), proof must be attached where required (`GATE:proof_required`), and a work summary is required. Subtasks never gate — they are informational (§9.6 ⁷). A gate failure blocks the whole sign-out with a single error naming the first failing task and gate (§14.6.3); nothing is saved.
2. Employee logs actual hours per task and may add an optional end-of-day note.
3. System closes any running break, writes the sign-out timestamp, saves the daily record, and applies all task status changes.

**Atomicity (hard requirement):** attendance close, break close, daily record save, and all project-task status changes are executed in **one database transaction**. All succeed or none do. A partial sign-out (attendance closed but tasks never submitted) must be impossible. On failure, the employee sees an explicit error and retries.

**Outside the transaction:** notifications and webhook posts. A dead Discord webhook (or a bounced email) must never block a sign-out. These fire after the transaction commits, via a queued job with retry.

---

## 10.6 The three special exits

| Exit | Trigger | Behavior | Attendance view |
|---|---|---|---|
| **Half-day leave** | Applied in advance via the leave system and **approved** before use | Timer target becomes 3.5h net; break allowance 30m; requester chooses **morning half** (sign in ~13:30) or **afternoon half** (leave after 3.5h net) | "Half day" |
| **Early sign-out** | Always available, any time, no approval needed | Requires a **typed reason**; a manager is notified; sign-out proceeds normally (same atomic transaction) | ⚠️ **Red flagged row** with the reason attached, permanently |
| **Auto-close** | **Server-side scheduled job** closes any session still open **10 hours after sign-in** *(hours configurable, §14.14)* | Any running break is closed with it; recorded work time is **capped at the configured shift end** (§14.14 Settings — not a hardcoded clock time) — an auto-closed day never counts as a 10-hour day | ⚠️ **"Auto-closed — no sign-out"** flag |

**Design rationale, recorded so it isn't relitigated:**
- *Early sign-out exists because emergencies are real.* Without it, an employee whose child falls sick at 2 PM can only abandon the session — producing an auto-close row indistinguishable from "forgot to sign out." The escape hatch keeps the record honest: nobody is trapped, and nobody leaves silently. The flag + reason **is** the accountability.
- *Auto-close is server-side* because when a PC is shut down there is no browser left to run anything. A client-side timer cannot implement this.
- *Wifi loss / PC shutdown / browser crash during the day does nothing.* The session lives on the server. This is the standard resolution for connection failure: the server owns the clock; the client only displays it.

---

## 10.7 Half-day leave (addition to the leave system)

- New request type: **Half-day**, alongside existing leave types.
- Request form requires choosing **first half** or **second half**.
- Deducts **0.5** from the relevant leave quota. Quota balances therefore support halves (e.g., 7.5 days remaining).
- Approval flow is identical to full-day leave (any manager decides; `admin_hr` may reverse; hard constraint: no self-approval).
- On the approved date, the employee's timer target is 3.5h net and break allowance is 30m automatically.

---

## 10.8 EOD: the report stays, the score is removed

**Removed permanently:** the 100-point EOD score and its entire formula (sign-in 10 / plan 15 / completion 40 / hours 20 / break 10 / sign-out 5), the score breakdown, score-based leaderboards, and the score-ranked "Needs attention" list. With the formula gone, its edge cases (empty-plan divide-by-zero, "weighted %" ambiguity, break-penalty curve) are gone with it.

**Kept: the EOD report** — the daily record produced by the sign-out flow itself: which tasks were worked, outcomes chosen, actual hours, and the optional note. It costs the employee nothing extra (it *is* sign-out) and gives managers a per-person, per-day factual record.

Two properties are worth stating explicitly:
- **The EOD report is immutable** — for everyone, including super_admin. No edit path exists in the UI or the API, and the database revokes UPDATE on the content columns (§13.5.7, PUL-605). A wrong report is corrected by conversation and, if needed, a comment on the task — never by rewriting the record.
- **Managers acknowledge, they don't approve.** Each report carries a lightweight acknowledgment: **✓ Mark reviewed** or **🚩 Flag with a mandatory note** (`reviewed_at` / `reviewed_by` / `flagged` / `manager_note` — separate fields, never touching content). Permission row: `eod_report.acknowledge` (§9.6 ⁸). The employee is notified on flag. There is no approve/revise cycle on EODs — that died with the score.

**The accountability model, stated once:** EasyGrowCrm **records facts; managers interpret them.** The Attendance view shows, per person per day: sign-in time (with Late flag), net hours worked, total break minutes (with exceedance flag), sign-out time, and any Early/Auto-closed flag with reason. There are no grades, no composite numbers, and no rankings computed from attendance. A fact invites a conversation; a score invites arguing about the formula.

---
---

# PRD Amendment Log

Every change to the base PRD agreed during review, in one place. Where an amendment conflicts with the original PRD text, **the amendment wins.** Apply these edits to the master document.

## A. Source of truth *(replaces the clause in §0/§1)*

> **The PRD is the sole source of truth. The prototype is a visual reference for layout and styling only.** No behavior may be derived from prototype code. Where the prototype and the PRD differ, the prototype is wrong by definition.

The previous clause ("where a mechanical detail is unclear, the prototype code is definitive") is **deleted**. It made the source of truth circular, and the prototype demonstrably contains bugs (the +7-day recurrence spawn, the `Completed` label collision) that must not reach production.

## B. Authentication & authorization → new §9 *(separate document, final)*

Better Auth, self-hosted in the project's own Postgres. Google OAuth only; no passwords, no magic links, no public signup. Invite-by-provisioning (HR creates the employee record; the person signs in with their company Google account). Sessions in the database; deactivation deletes sessions → instant lockout. `authorize()` as the first line of every server action (middleware is a redirect convenience only, never the security boundary). `role`/`active` read from the DB on every request, never from the session cookie. Full permission table, hard invariants, and audit-log schema in §9. Delete `inviteExpiryHours` from §3.12.

## C. Surveillance capture removed *(edits §3.4.1, §3.12)*

Selfie, geolocation, IP address, network type, and the `officeIP` setting are removed from the product. No image or location data is collected. Work type remains self-declared; Late detection remains (timestamp vs. grace time).

## D. Recurring tasks removed *(edits §3.2.6, §3.3.1, §3.3.5, §4.2)*

The recurrence engine is deleted: no `recurring` field, no spawn-on-approval, no weekly/monthly rule kinds. `Approved` is a terminal state. Repeating work (e.g., weekly rank checks) is expressed as explicitly numbered tasks in the template ("Rank check — week 1/2/3/4" with day-offset due rules), which also makes the full month visible on the board from day one.

## E. Super_admin never executes *(edits §2.1, §4.2)*

The super_admin (CEO) **assigns and approves — never executes.** He cannot be a task assignee: hidden from every assignee dropdown, rejected at the API. Consequence: nothing of his ever enters the QC queue, so the self-review deadlock cannot occur. Reviewer rule simplifies to: *any active manager-level user other than the submitter.* System invariant: at least two active manager-level users at all times (deactivation that would violate this is blocked).

## F. Open scoping model *(edits §2.3, §3.1.4, §3.8, §3.4.7)*

Any manager sees all projects, may review any submission, and may approve any leave request. No project-ownership scoping, no reporting lines, no `manager_id` field. Accountability = the audit log records who decided. `admin_hr` may reverse leave decisions. The three review surfaces (§3.1.4, §3.6 card, §3.8) become **one canonical query** rendered in multiple places; §3.1.4's "implementation may narrow scope" parenthetical is deleted.

## G. Audit log *(expands §6.6 into a core requirement)*

Append-only Postgres table (`actor, action, resource_type, resource_id, before, after, created_at`); `UPDATE`/`DELETE` revoked at the database level; written **inside the same transaction** as the mutation it records. **The canonical list of logged events lives in §9.8** — it includes everything from status changes and reviews through subtask/checklist edits, EOD acknowledgments, client changes, template-hierarchy edits, `audit_log.viewed`, and every failed authorization attempt; this amendment intentionally does not duplicate it, so the two lists can never drift. **Read access: super_admin (full); admin_hr (rows where `resource_type IN ('leave_request','employee')` only).** The binding reference is §17: migration 003, ticket PUL-102, Phase 1 Foundation, before any feature work.

## H. Attendance, breaks & sign-out → new §10 *(above; replaces §3.4's flow and score)*

7h-net work timer with green unlock; 1h total break allowance (blue→red, "Break exceeded" pill, no manager alerts); server-authoritative timer; atomic sign-out transaction; "Done — send to review" label; half-day leave (3.5h target, 0.5 quota, half selection); early sign-out escape hatch (reason + flag + manager notification); 10h server-side auto-close (capped at shift end, flagged). EOD **score removed**, EOD **report kept**.

## I. Terminology *(global)*

The employee-facing completion option at sign-out is **"Done — send to review."** The word "Completed" is reserved exclusively for the manager-set protected task status and appears nowhere in the employee sign-out flow. Mechanically enforced: a CI grep blocks "Completed" in `features/attendance/**` and `features/daily-plan/**`, and "Score" in any `features/**` UI string (§16.12, ticket PUL-809).

## J. Template hierarchy & subtasks *(specified in §14.3.3, §14.4)*

The template/project data model is a **strict 6-level hierarchy: Agency → Project → Month → Category → Task → Subtask.** The flat template `tasks[]` list is deleted; all iteration walks the tree (canonical flattener: `tplAllTasks`, §16.7). **Subtasks** are lightweight ordered items (title + done flag) under a task, editable by the assignee and managers, locked while `Submitted`, and **never a submission gate** — the checklist is the definition-of-done, subtasks are the assignee's own breakdown (§9.6 ⁷). Subtask progress is surfaced on board cards (`☑ 2/4`), list rows, and dashboards (§14.15 r.11). The **Add Month wizard** creates **all 12 months at once** from one start-month + start-day input — Month 1 fully populated, Months 2–12 as empty scaffolds with cascaded, day-clamped dates (§14.4.3) — so a recurring cycle is set up exactly once per template.

## K. Dates always carry the year *(global UI rule)*

Every rendered date includes the year (`fmtDate` → `Aug 8, 2026`). Bare month-day is banned; relative labels ("Today", "In 2d", "3d overdue") may only appear as suffixes or secondary lines (§14.15 r.2, §16.14). Applies to boards, lists, task headers, calendar headers, attendance history, and wizard previews.

## L. Product renamed *(global)*

The product formerly called **Pulse** is named **EasyGrowCrm**. All documents, file names (`easygrowcrm-*`), UI text, and the logo mark are updated. Ticket IDs in §17 keep the `PUL-` prefix as stable identifiers (renaming in-flight ticket keys creates tracker churn for zero value); any tracker import may alias the prefix if desired.

## M. White-label hierarchy, review-only close, scoped exports *(edits §9.6, §11.2, §13.2–13.4.5, §13.8, §14.3; tickets PUL-414 … PUL-418)*

EasyGrow is a **white-label** agency: its clients are agencies that resell SEO and web design to their own end businesses, and EasyGrow delivers for those businesses. Three decisions follow.

1. **Client › Account › Project.** A new `accounts` level sits between `clients` and `projects`. A **client** is the white-label partner. An **account** is one of that partner's end businesses (e.g. "Joe's Plumbing, Austin"). A **project** is one engagement for that account ("Onboarding", "Local SEO — monthly", "Website redesign"). `projects.client_id` is **replaced** by `projects.account_id`; the client is always one join away, so no denormalized copy (§16.7). The full hierarchy is now **Agency → Client → Account → Project → Month → Category → Task → Subtask** (extends J). `/projects` becomes a two-pane workspace: a Client › Account › Project tree on the left, the selected node's view on the right (§14.3).
2. **Every task is closed by review.** The manager's direct `completed` status (the QC bypass of §13.4.5 / PRD §4.2) is **removed**: nothing new may be set to `completed`. A task is done only when a manager approves its submission through `reviewTask` (§13.4.7). The `completed` enum value stays so old rows still read; "Completed" survives only as the client export's relabel of `approved` (§3.1.7).
3. **Weekly / monthly exports are scoped** to one client (one sheet per account) or one account. They stay `.xlsx`, which opens in Google Sheets as-is; a direct Google Sheets export is out of scope for v1.

This amendment also knowingly takes PUL-414 … PUL-418 ahead of Phase 3 (see the §17 phase-order note).

---

## Amendment status

| Amendment | Source decision | Status |
|---|---|---|
| A. Source of truth | Owner confirmed | ✅ Final |
| B. §9 Auth | Owner confirmed (incl. rules 1 & 3, CEO rationale, HR audit scope) | ✅ Final |
| C. No surveillance capture | Owner decided | ✅ Final |
| D. No recurrence | Owner decided | ✅ Final |
| E. CEO never assigned | Owner confirmed with rationale | ✅ Final |
| F. Open scoping | Owner adopted recommendation | ✅ Final |
| G. Audit log + HR scope | Owner confirmed | ✅ Final |
| H. §10 Attendance | Owner confirmed (7h net, escape hatch, half-day, auto-close, EOD report kept) | ✅ Final |
| I. "Done — send to review" | Owner agreed | ✅ Final |
| J. Template hierarchy & subtasks | Owner directed the rework across prototype sessions | ✅ Final |
| K. Dates carry the year | Owner requested | ✅ Final |
| L. Renamed to EasyGrowCrm | Owner directed | ✅ Final |
| M. White-label hierarchy, review-only close, scoped exports | Toki decided 2026-09-29 | ⏳ Awaiting product-owner confirmation in PUL-414's PR |

**Open decision:** Amendment M, until Jaki confirms it at review.
