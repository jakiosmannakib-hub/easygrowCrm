# §14. UI Spec — EasyGrowCrm

**Status:** Final.
**Sources:** the prototype walkthrough + checklist define the *look and layout* (Amendment A: visual reference only). This document defines the *behavior*, with all Amendments (**A–L**) applied. Where the walkthrough and this doc differ, **this doc wins** — the walkthrough still describes selfies, scores, EOD approval, and invite emails, all of which are gone.

**Template data model (updated):** The single strict hierarchy is **Agency → Project → Month → Category → Task → Subtask**. Every task in a template or a live project belongs to exactly one category, which belongs to exactly one month, which belongs to exactly one template (agency-scoped). Subtasks are lightweight ordered items under a task (title + done flag) — they are the sixth and final level. There is no flat `tasks[]` on a project or template; all task iteration walks the hierarchy.

**Design language (carried from prototype):** Monday.com-style boards; colored status pills; category color stripes; sidebar + top-header layout; shadcn/ui components; lucide icons; h+m time display everywhere (`1h 30m`, never `1.5`).

---

## 14.1 Route map & navigation

| # | Sidebar item | Route | Visible to |
|---|---|---|---|
| 1 | Dashboard | `/dashboard` | all |
| 2 | Employees | `/employees` | SA, HR |
| 3 | Attendance | `/attendance` | all |
| 4 | Projects | `/projects` | all |
| 5 | Project Templates | `/templates` | SA, HR, PM, TL |
| 6 | My Tasks | `/my-tasks` | SA, HR, PM, TL |
| 7 | Daily Task Plan | `/daily-plan` | all |
| 8 | End-of-Day Reports | `/eod` | all |
| 9 | Leave Requests | `/leave` | all |
| 10 | Review | `/review` | SA, HR, PM, TL |
| 11 | Reports | `/reports` | SA, HR, PM, TL |
| 12 | Audit Log | `/audit` | SA, HR *(new — was not in prototype)* |
| 13 | Settings | `/settings` | SA, HR |

- Sidebar: logo top, items with lucide icon + label, active item highlighted, Logout at bottom. **The prototype's user-switcher dropdown must NOT ship.**
- Hidden items don't render (no grayed-out state). Route access is enforced server-side regardless (§9.5) — the sidebar is cosmetic.
- Top header: page title + subtitle (from a `PAGE_META` map), bell icon with unread count → slide-in Notifications panel (newest first, type badges, per-item mark-read, "Mark all read").
- `admin_hr` note: sees everything SA sees **except** the Manager QA tab in Projects; sees Audit Log **scoped** to leave/employee rows (§9.6 ⁶).

### 14.1.1 Sign-in screen `/sign-in`
One card: EasyGrowCrm logo, **"Sign in with Google"** button. Nothing else — no email/password fields, no signup link (§9.3). Error states rendered under the button: *"This email is not registered with EasyGrowCrm. Contact HR."* / *"This account has been deactivated."*

---

## 14.2 Dashboard `/dashboard`

Role-branched (one route, two components):

**AdminDashboard (SA, HR, PM, TL):**
- KPI row: Active clients · Live projects · Tasks due today · Team present today.
- **Recent EOD reports** list — row: employee, date, done/total, ack state (— / ✓ Reviewed / 🚩 Flagged). Click → EOD detail drawer with **Acknowledge** and **Flag + note** actions (13.5.7). *(Score column from prototype: deleted.)*
- **Overdue submissions** — aging `submitted` tasks (from the canonical review queue query, `sort: oldest`). Click → Review page.
- **Attendance snapshot** — signed in / on break / not signed in counts; click → Attendance.
- *(Prototype's "weekly avg productivity score trend chart": deleted — no scores. Replace with a 7-day bar of tasks approved per day — same slot, honest data.)*
- Notifications feed (newest 8).

**EmployeeDashboard (EMP):**
- **Today's Status card — the centerpiece (§10):**
  - Not signed in → big **Sign In** button.
  - Signed in → **work timer**, large: shows net working time counting up, target `7h 0m` (or `3h 30m` on an approved half-day). Timer turns **green** at target; Sign Out button enables at the same moment. Below it: **Take a break** / **End break** (break clock **blue**, turns **red** past total allowance; pill "Break exceeded"). Timer values come from `getMyTimer` polled every 30s + client-side ticking between polls — **client never computes eligibility**.
  - Always visible while signed in: small **"Sign out early"** text-link under the main button (opens Early Sign-Out modal, 14.6.4). Quietly present, never hidden — that's the §10.6 escape hatch.
- **Upcoming project tasks (7 days)**: Task, Project, Due (**full date with year** + relative suffix, red if overdue — 14.15 r.2), Priority, Est; small muted `2/4 subtasks` line under the title where subtasks exist (14.15 r.11). Excludes approved/completed/cancelled/submitted. Revision badge inline where `revision_required`.
- Leave balances: per quoted type, `used / total`, halves shown (`7.5`).
- Notifications feed.

---

## 14.3 Projects `/projects`

**Filter bar:** Client ▾ (from `getClients`, 13.8) · Project ▾ (scoped to client) · Month ▾ · Assignee ▾ · **Weekly (Excel)** · **Monthly (Excel)** (both MGR-only, server-side exports — 13.8 / PUL-413).
**Project header:** breadcrumb `📁 Client › Project · type · Month N`; progress `9/21 · 43%` + bar; health chip (On Track / At Risk / Delayed / Critical — computed over the whole project, not the filtered month); **+ New Task** (MGR only); **Archive** in an overflow menu (MGR; blocked with a toast if pending reviews — `GATE:pending_reviews`).

**Tabs:** 1 Board · 2 List · 3 Calendar · 4 Review · 5 Workload · 6 Manager QA.
Visibility: Board/List/Calendar all roles; Review + Workload MGR/HR; **Manager QA: SA + TL only.**

### 14.3.1 Board (default)
- Kanban columns by status: Not Started · Working on it · Blocked · Awaiting Review · Needs Revision · Done ✓ (each column top-bordered in the status color, count chip in the header).
- **Card contents:** title · category tag · priority pill · assignee avatar · **full due date with year** (`Aug 8, 2026`) · **subtask progress badge** `☑ 2/4` when the task has subtasks (teal pill, hidden when zero) · overdue line in red (`Overdue 3d`) when past due.
- **Unassigned group** pinned above the columns when unassigned tasks exist (13.4.3 — managers assign from here; there is no self-claim).
- Click any card → Task Detail modal.
- `+ Add task` button at the bottom of each column (MGR only).

### 14.3.2 Status pill (shared component — Board, List, Daily Plan, Task Detail)
- Colors/labels per status map. Display labels: Planned "Not Started" · In Progress "Working on it" · Blocked "Blocked" · Submitted "Awaiting review" · Revision Required "Needs revision" *(renamed from prototype's "Stuck — revision" — "Stuck" collided with Blocked)* · Approved "Done ✓" **with a small check-shield icon** · Completed "Done" *(no icon — the icon is what visually distinguishes QC-approved from manager-closed, review fix)* · Cancelled "Cancelled".
- Dropdown option sets:
  - **EMP (assignee, unlocked):** Not Started · Working on it · Blocked · ➤ *Submit for review…*
  - **MGR:** the open set + Needs revision · Done (Completed) · Cancelled. **"Done (Approved)" is NOT in the dropdown** — approving goes through the Review modal only (13.4.5 `GATE:use_review`). Completed here *is* the explicit QC-bypass and is audited as such.
  - Locked states (submitted/approved/completed/cancelled): pill read-only for EMP; current status always shown even if outside the option set.
  - Dependency-blocked: pill shows Blocked color regardless of stored status, lock icon, tooltip names the dependency (§13.4.6 guard).
- ➤ *Submit for review…* opens the Submit modal, never changes status directly.

### 14.3.3 Task Detail modal

**Header:** title, project · category · month, status pill, priority, **due date rendered with year** (e.g. `Aug 8, 2026 · Today` — `fmtDate(due)` everywhere, no bare month-day), assignee (MGR sees **Assign** ▾ — active users, no SA, per 13.4.3).

**Body sections (top → bottom):**
- **Description** + SOP link + expected output.
- **Checklist** — the definition-of-done for the task. Each item = a checkbox row. Toggle = assignee/MGR. Add/delete = MGR. Locked (read-only, disabled inputs) while `submitted`. Section header shows `(3/5)` when populated. Section is the first hard gate — a submission is refused if any item is unchecked (`GATE:checklist_incomplete`).
- **Subtasks** — smaller units *inside* the task, ordered, checkable. Each row: checkbox · title · × delete (interactive for assignee & MGR only — `project_task.subtask_manage`, §9.6 ⁷; **read-only for HR and non-assignee EMPs**; disabled for everyone while `submitted`). Section header shows `(2/4)` when populated. Inline **"+ Add subtask"** input + button below the list (Enter to add). Empty state: *"No subtasks yet."* Subtasks are **NOT** a submission gate — they exist purely to help the assignee break work down, unlike the checklist which is definition-of-done. Add/toggle/delete audited (`project_task.subtask_added`, `project_task.subtask_toggled`, `project_task.subtask_removed`).
- **Actual time** `HMInput` (helper: *"from your time-tracking tool"*).
- **Proof** — type ▾ + value; required when `proofReq` (`GATE:proof_required`).
- **Comments** — always open regardless of status; avatar + timestamp per comment.
- **Submission & review history** — every submission with its review: decision icon (✓ / ⚠), reviewer, note, rating stars, meta-rating if present.

**Locking rule (unified):** when status is `submitted`, checklist + subtasks + actual-time + proof are all disabled. Only comments stay writable. Banner at top of body: *"Awaiting review — checklist, subtasks and hours are locked. Comments stay open."*

**Version conflicts** (`CONFLICT`): toast *"This task changed while you were editing — refresh."*

### 14.3.4 List / Calendar

**List view:** collapsible **Month → Category → Task** tree matching the template hierarchy. Month header: chevron, `Month N — MonthName`, done count, "Current cycle" pill on `p.month`. Category header: chevron, color dot, name, done count. Task row columns: **Task · Owner · Status pill · Due date · Priority · Est · ⋯**.
- **Due date cell** renders the full date with year (`Aug 8, 2026`), plus `· Today` or `· Overdue` suffix where relevant. Below the date on the same cell: `2/4 subtasks` small line when the task has subtasks (muted, 11px).
- Task title click → Task Detail modal. Status pill inline-editable per 14.3.2.
- `+ Add task in {Category}` link at the bottom of each open category group (MGR).

**Calendar view:** month grid, header `August 2026` (year always shown), category-colored chips per day, today highlighted with a solid teal circle around the date number. Chip click → Task Detail. Navigation: Prev / Next (server-side date shift, not just visual).

### 14.3.5 Review tab (and `/review` page — same component)
One canonical queue (13.8 `getReviewQueue`): the `/review` page = agency-wide, the project tab = filtered to that project, the dashboard card = `sort oldest`. Columns: Task · Project · Submitted by · Routed to · Summary (truncated) · Hours · Proof link · **Review** button. Tab title shows count. Filter chip: "Routed to me".
**Review Decision modal:** shows time spent vs estimate, proof link, priority, summary, issues, checklist state (read-only); 1–5 star Quality rating (click again to unset); note textarea; **Approve** / **Request Revision** (revision blocks inline without note). `CONFLICT` on decide → toast *"Already reviewed by {name} just now."*

### 14.3.6 Workload tab (MGR/HR)
Per-person capacity view of open tasks (count + est hours), on-break live indicator. Data from open statuses only; dependency-blocked tasks count as open (documented PRD §3.2.5 behavior).

### 14.3.7 Manager QA tab (SA + TL)
Reviewer scorecard: Reviewer · Reviews · Revisions requested · Avg rating given · Avg meta received. Review log table:每 row = a review; meta-rating ▾ 1–5 (13.4.8; own reviews' dropdown disabled). **Spot-check random review** button highlights a random log row.

### 14.3.8 New Task modal / Start Project Wizard

**New Task modal:** fields per 13.4.1; category pre-filled when opened from a category group; assignee ▾ excludes SA and inactive users.

**Start Project wizard** (from a template card or its detail view):
- Summary banner at top: `N tasks · N months · N roles · N QC gates will be generated`.
- **Step 1 — Choose client & project name:** client ▾ (from `getClients`, 13.8) · project name (defaults to template name, editable).
- **Step 2 — Set dates:** start date · deadline (both `Aug 08, 2026` full-date format).
- **Step 3 — Assign team members to roles:** one row per template role → assignee ▾ (active non-SA users). Rows may be left unassigned; those tasks are created with `assignee = null` and surface in the Unassigned group.
- **Step 4 — Preview:** scrollable list of every task that will be generated, one row per task showing `#N · title (with [Client] shown in place of the token) · category · role · due-rule pill · QC badge`. Read-only — this is the last confirmation before Create.
- **Generate project** button (binding contract: **13.3.2** — this list is the UI-level summary): iterates the template's month → category → task hierarchy (via `tplAllTasks`), clones each task into `project_tasks` with:
  - `category` = template category name; `month` = template month number
  - `title` = template title with all `{{ClientName}}` tokens replaced by the actual client name
  - subtasks = template subtasks cloned into `task_subtasks` (`done:false`) — the live task inherits the breakdown
  - checklist = template checklist items expanded into `task_checklist_items` (unchecked)
  - due = **month-anchored** computation (13.3.2 / PUL-505): Month k start = project start + (k−1) months day-clamped; `day` rule = month start + (n−1); weekend/holiday-shifted
- On success: navigates to the new project, sets `S.projTab = "list"`, clears the month filter so every generated task is visible, and toasts: *"'{project name}' created — N tasks generated across M months. Opening now."*

---

## 14.4 Templates `/templates`

### 14.4.1 Template grid
Cards laid out in a responsive grid (auto-fill, min 340px). Each card shows: **category badge** (color-coded), **template name**, **description**, **role pills** (roles used by any task in this template), and a footer stats row: `N tasks · N months · N roles · N QC gates`. Footer buttons: **View** (→ template detail), **Start Project** (→ Start Project wizard, 14.3.8), and `×` delete (confirm dialog: *"Running projects unaffected — they hold their own snapshot"*).

**+ New Template** button top-right (MGR only) → modal: name (required) · description · category ▾ · roles (checkbox list). Save creates an empty template (13.3.6a) and navigates straight to its detail view — the user then adds months via the Add Month wizard.

**Role visibility (§9.6 ⁹):** HR sees the grid and can open any template **read-only**. For HR: no + New Template, no card `×` delete, and no **Start Project** (project creation is MGR-only). The prototype gave HR edit rights — that's a deviation; the PRD wins.

### 14.4.2 Template detail view
*(For HR, every edit affordance below — Edit details, Start Project, + Add month, Add category/task/subtask, Rename, every `×` — is hidden; the tree renders read-only per §9.6 ⁹.)*
Layout:
- **Back to templates** link (top).
- **Header card:** category badge · name · description · **Edit details** · **Start Project** buttons; stats row (Months / Tasks / Roles / QC Gates) with role pills.
- **Breadcrumb hint** (visual only, not clickable): `Agency › {template} › Month › Category › Task`.
- **Toolbar:** month/task summary count + **+ Add month** button (MGR only).
- **Month groups** — one collapsible card per month, in order:
  - **Month header:** chevron · calendar icon · month name (`Month 1 — January 10`) · meta (`N tasks · N categories`) · action buttons **Add category** / **Rename** / `×` delete.
  - **Column header row** (when open): Task · Role · Due rule · Priority · Est · QC gate · Proof · ⋯
  - **Category groups** nested inside the month, each collapsible:
    - Category header: color dot · name · task count · **Add task** / **Rename** / `×` delete.
    - **Task rows** — expandable when the task has subtasks (chevron `▶` to the left). Row columns match the header. Task title shows `#N` global index, a `token` badge when the title contains `{{ClientName}}`, and a small subtask count (`3 subtasks`) inline.
    - **Subtask rows** (indented, `└` connector, numbered `#task.#subtask` e.g. `1.1`, `1.2`) render below their parent task when expanded, with **Edit** / `×` per row.
    - **+ Add subtask** link at the bottom of each task's subtask block.
    - **+ Add task in {Category}** link at the bottom of each category (MGR).
  - **+ Add new category in {Month}** dashed button at the bottom of each month (MGR).

### 14.4.3 Add Month wizard (the recurring-cycle setup)
Triggered by **+ Add month** (MGR only). A single modal with a 3-step indicator: `Set month & date` → `Add categories` → `Add tasks & subtasks`. All wizard state is held in memory until Save — Cancel discards; nothing touches the server before the final save (13.3.7a). *(The prototype held this in a `window._mwiz` global; the real build uses component state declared upfront per §16.10 — window globals don't ship.)*

**Step 1 — Set month & date:**
- Info banner explains: *"Pick a start month and day. All 12 months will be created at once so you never have to make them again. You'll only fill out categories and tasks for Month 1 here — Months 2–12 stay empty until you open them."*
- Pickers: **Start month** ▾ (January–December) · **Start day** ▾ (dynamic — 28/29/30/31 based on the selected month; day auto-clamps down if the current selection is invalid for the new month).
- Live label preview: `Month N — MonthName Day` (updates without re-rendering the modal).
- **12-month cascade preview** — a scrollable list showing every month that will be created, each with number badge, computed date (`Month 1 — September 10`, `Month 2 — October 10`, `Month 3 — November 10`, …), and pill (`Filling out now` on Month 1, `Auto-created` on 2–12).
- Next button: `Next: Set up Month 1 →`.

**Step 2 — Add categories:**
- Header confirms which month is being set up (`Adding categories for Month N — MonthName Day. Only Month 1 gets set up now; Months 2–12 will be created empty.`).
- Growing list of added categories, each with color dot + × remove.
- Add row: text input with `<datalist>` of preset names (**On-page SEO, Content, Link Building, Technical, Reporting, Design**), Enter or **+ Add** to append. Duplicate names refused with a toast.
- Next button disabled until at least one category exists.

**Step 3 — Add tasks & subtasks:**
- Category tabs across the top (`Content (2)`, `Reporting (1)` — count updates live). Active tab is where new tasks land; switch by click.
- Existing task cards for the active category: header row (`#N` · title · role · due-rule pill · QC badge · × remove) followed by an inline subtask block (existing subtasks as `└ N.M title ×`, then an **Add subtask…** input + **+ Subtask** button).
- **Quick add task** panel below: title (required) · role ▾ (only roles declared on the template) · priority ▾ · est (hours) · due rule ▾ (**Day N / N days before deadline** — dependency-based rules deferred to per-task edit) · QC gate checkbox · Proof required checkbox · **+ Add task**. Enter in title also adds.
- Summary banner: `N tasks · N subtasks · N categories` — live count across all tabs.
- **Save month** button:
  - Creates **Month 1** with the user's categories, tasks, and subtasks.
  - Creates **Months 2–12** as empty scaffolds — each with the correctly cascaded date (`Month 2 — October 10`, etc.), no categories, no tasks — ready for later editing.
  - Auto-expands Month 1 in the detail view; keeps Months 2–12 collapsed.
  - Toast: *"All 12 months created — Month N has X categor(y/ies), Y task(s), Z subtask(s). Months (N+1)–(N+11) are empty scaffolds."*

### 14.4.4 Add/Edit Task modal (from template detail)
Opened from the per-category **Add task** button or the row **Edit** button.
- Fields: name (`{{ClientName}}` token supported and documented inline) · role ▾ · priority ▾ · estimate (hours) · **due-rule editor** (Amendment D — exactly three options: **Day N from month start** / **N days before deadline** / **After task #** with a dependency dropdown of every other task in the template) · QC gate checkbox · Proof required checkbox · Checklist textarea (one item per line).
- **Subtasks section** at the bottom — bordered panel with header showing count. Existing subtasks render as `└ N title ×` rows. Inline `New subtask title…` input + **+ Create subtask** button below (Enter to add). The live list is modal-local state (*prototype used `window._tftSubs`; real build: component state, §16.10*); the modal never closes while managing subtasks — one Save writes the task and its subtasks together (13.3.7d `updateTemplateTask` takes the full replacement list).
- Edit mode also shows a **Delete task** button (red, left of Cancel).

### 14.4.5 Add / Edit Category / Rename Month (light modals)
Small modals with a single required text field. Category name uses the same preset datalist. Category delete confirms *"Remove category and all its tasks?"*; month delete confirms *"Remove month and all its tasks?"*.

---

## 14.5 Attendance `/attendance`

**Today tab:** department filter; own sign-in/out card at top (same component as dashboard centerpiece); team grid: avatar, name, dept chip, work type, sign-in time, status badge (Present / **Late** / Absent), on-break live indicator + type, **break total (red when > allowance, pill "Break exceeded")**, sign-out time + exit badge (— / **⚠ Early** with reason tooltip / **⚠ Auto-closed** / Half day). "Not signed in yet" section at bottom.

**History tab (MGR/HR; EMP sees self only):** filters Employee ▾ · from · to · **Flagged only** toggle; summary line (`321 records · 288 present · 22 late · 11 absent`); table: Date · Employee · Status · Sign in · Sign out · Exit type · Worked (h+m) · Break (h+m). *(Score column: deleted.)* First 400 rows; **Export (Excel)** = server-side full set.

---

## 14.6 Sign-in / Sign-out flows (modals)

### 14.6.1 Sign-In modal
Step 1: Work type ▾ (In-office / Remote / Client site). *(Selfie pane, IP chip, location display from prototype: all deleted — Amendment C.)*
Step 2: **Daily plan** — pre-filled rows from assigned tasks due today (`planned/in_progress/revision_required`), each labeled "From {Project}", removable; + add ad-hoc row (title, client ▾, category, priority, est `HMInput`, expected output). Submit → 13.5.1. Late (after grace) → subtle "Signed in late" note on confirmation; no drama.

### 14.6.2 Break controls
**Take a break** → type ▾ → break clock starts (blue). **End break** ends it. One open break max (`CONFLICT` → "You're already on a break").

### 14.6.3 Sign-Out modal (enabled at green timer)
Per-task rows from today's plan: status ▾ (daily statuses) · actual time `HMInput` · proof (type ▾ + value). For project-linked rows, the done option is **"Done — send to review"** (Amendment I — the word "Completed" appears nowhere here); choosing it expands an inline submit strip: summary (required) · issues · proof · reviewer ▾ (active managers ≠ me, default = least-loaded). If any row isn't done → **Explanation** textarea becomes required (inline error otherwise). Optional: blockers / tomorrow / remarks. **Submit = one atomic action** (13.5.4); on failure a single error names the first failing gate and task ("'Homepage design': checklist has 2 unchecked items") and *nothing* is saved.

### 14.6.4 Early Sign-Out modal
Reason textarea (required) → warning line: *"This will be flagged in attendance and your managers will be notified."* → same per-task rows as 14.6.3 → submit (13.5.5).

---

## 14.7 Daily Task Plan `/daily-plan`
EMP: own plan for a picked date; today's rows editable while signed in (status, hours, proof); + add ad-hoc row (13.5.8). Mid-day changes never touch project tasks (sync happens at sign-out).
MGR/HR: Employee ▾ ("All employees") + date; read-only rows; task titles link to Task Detail (comment from there — the walkthrough's "any blocker?" nudge flow).

## 14.8 End-of-Day Reports `/eod`
EMP: own reports, newest first: date, done/total, hours planned/actual, note excerpt, ack state (— / ✓ Reviewed / 🚩 Flagged + manager note). Immutable — no edit affordance exists.
MGR/HR: Employee ▾ + date range + **Unreviewed only** toggle (default on). Row → detail drawer: full report + task rows; footer: **Mark reviewed** · **Flag** (note textarea) (13.5.7). *(Prototype's approve/revise buttons and score ring: deleted.)*

## 14.9 Leave `/leave`
Balances strip (quoted types, halves rendered). **+ Request Leave** → modal: Type ▾ · dates (single date + **First half / Second half** radio when type = Half-day) · reason. Live preview: *"Counts as 2.5 days · 5.5 remaining"* (server-computed via a preview query — same working-day/holiday math as 13.6.1). Table: type, dates, days, reason, status, decider, comment. Pending rows: **Cancel** (own) · **Approve / Reject** (MGR/HR, own rows' buttons hidden — no self-decision). Decided rows, SA/HR only: **Reverse…** → modal requiring comment (13.6.4).

## 14.10 My Tasks `/my-tasks` (MGR/HR)
Private checklist: title, client ▾, due, done toggle. No sharing, no audit — personal scratchpad (13.5.8's cousin, `personal_tasks`).

## 14.11 Reports `/reports` (MGR/HR)
Score-free rebuild (Amendment H): **Delivery** — tasks approved per person/per project over range; revision rate; avg review turnaround (median hours submitted→decided, per reviewer — the "who's slow at reviewing" mirror). **Attendance** — late count, avg net hours, break-exceeded days, early/auto-closed flags per person. **Leave** — usage vs quota. All tables exportable (server-side). *(Leaderboards ranked by score, "Needs attention" bottom-3: deleted.)*

## 14.12 Employees `/employees` (SA, HR)
Card grid: avatar, name, title, dept chip, role badge, Active/Deactivated pill; filters (dept, status, search). **+ Add Employee** → modal: email, name, role ▾, title, dept, join date (13.1.1) — copy explains *"They'll sign in with their company Google account — no invitation email is sent."* Card → detail: edit fields (13.1.2); **Change role** (SA only, 13.1.3); **Deactivate** → the **offboarding checklist modal** (13.1.4): lists every open assignment (reassign ▾ / cancel) and every routed review (reroute ▾); the Deactivate button stays disabled until every row is resolved; blocked entirely with an explanation if it would leave <2 managers.

## 14.13 Audit Log `/audit` (SA; HR scoped)
Filters: actor ▾, resource type ▾, resource id, date range. Table: time · actor · action · resource · before→after (expandable JSON diff). Paginated. HR sees only leave/employee rows — no toggle, silently scoped. Banner: *"Viewing this log is itself logged."*

## 14.14 Settings `/settings` (SA, HR)
Company name · timezone (display-only Asia/Dhaka) · work days · shift start/end · grace time · work target · half-day target · break allowances · auto-close hours · **Discord webhook URL** (with **Send test** button; DECIDED Phase 1 — was "webhook URL", target is Discord) · **Holidays** editor (date + name rows, 13.7.3) · **Clients** section (the home of client management per §9.6 ¹⁰: list + add / edit / archive, 13.2; archive blocked with `GATE:client_in_use` while live projects exist). *(inviteExpiryHours, officeIP: deleted.)*

---

## 14.15 Cross-cutting UI rules

1. **Time renders h+m everywhere** (`fmtHM`); input via `HMInput` (paired H/M, 5-min steps); storage decimal.
2. **Dates always include the year** (`fmtDate(due) → "Aug 8, 2026"`). No `"Aug 8"` alone, no relative-only labels. Board cards, list rows, task headers, calendar, attendance history, wizard previews — all render year. Relative labels (`Today`, `Tomorrow`, `In 2d`, `3d overdue`) may appear *in addition* as a suffix or small secondary line, never as a replacement.
3. **Server errors → toasts** mapped from §13 error codes; `GATE` messages name the field/task; `CONFLICT` always offers refresh.
4. **Empty states** on every table/queue with one-line explanations (prototype convention, keep).
5. **Optimistic UI** only for: pill changes, subtask/checklist toggles, comment posts, notification reads. Never for: sign-in/out, submit, review, leave decisions (these wait for the server — they're the accountability actions).
6. **Confirmation dialogs** for: deactivate, delete (project/template/client/month/category), leave reversal, archive. Never for routine status changes.
7. **The word "Completed" never renders in any employee-facing surface** (Amendment I), and **"Score" appears nowhere in `features/**` UI strings** (Amendment H). Both are CI-grepped (PUL-809): "Completed" in `features/attendance` + `features/daily-plan`, "Score" everywhere.
8. All dates display in Asia/Dhaka; "overdue" is a Dhaka-calendar comparison.
9. Deactivated users: appear in history with a muted "(deactivated)" suffix; never in any dropdown.
10. **Mobile:** the app is desktop-first; sign-in/sign-out, break buttons, and the timer must be usable on a phone viewport (≥360px) — employees at client sites sign in from phones. Boards/reports may scroll horizontally on mobile; that's acceptable.
11. **Subtask progress** is surfaced anywhere a task summary renders: list row (small line under date, `2/4 subtasks`), board card (teal `☑ 2/4` pill), dashboard task row (small muted line under title). Never inflate priority — it's informational, not a status.

---

## 14.16 Deltas from the prototype walkthrough (so nobody "restores" them)

**Deleted:** selfie/IP/geolocation panes · EOD scores, ScoreRing, score columns, score trend chart · EOD approve/revise · score leaderboards & "Needs attention" · invite-email flow & inviteExpiryHours · officeIP setting · user-switcher dropdown · recurring badge/spawn UI · "Stuck — revision" label · sign-out "Completed" label · billable field · **flat template `tasks[]` array** (replaced by hierarchical months → categories → tasks → subtasks).

**Added:** work timer with green unlock · early sign-out link + modal · exit-type badges (Early/Auto-closed/Half day) · break allowance colors + "Break exceeded" pill · half-day leave UI · EOD acknowledgment (✓/🚩) · Unassigned board group · Audit Log page · check-shield on Approved · offboarding checklist modal · review turnaround report · holidays editor.

**Added in the template/subtask rework:**
- **Strict 6-level hierarchy** — Agency → Project → Month → Category → Task → Subtask. All rendering, save logic, and iteration walks the tree; no flat lists.
- **Add Month wizard** — 3-step modal (date pickers → categories → tasks & subtasks), creates **all 12 months at once** from a single start-month + start-day input, with Months 2–12 as empty scaffolds so recurring cycles are set up once per project.
- **12-month cascade preview** with live-updating dates as the start month/day changes; day dropdown clamps to the correct 28/29/30/31 for the picked month.
- **Subtasks throughout** — inline `└ N.M title` rendering in template detail, template task-form panel with `+ Create subtask` and live list, employee task-detail modal with checkable subtask rows + inline `+ Add subtask`.
- **Subtask progress badges** on board cards (`☑ 2/4`) and list rows (`2/4 subtasks`) and dashboard task rows.
- **Full dates with year everywhere** via `fmtDate(due)` — `Aug 8, 2026` on cards, rows, modals, attendance history, calendar header, wizard preview.
- **Start Project wizard preview step** — scrollable list of every task that will be generated, with token substitution shown, so the user sees exactly what they're about to create before committing.
- **State discipline** — `S.tplCollapsed`, `S.tplView`, `S.collapsed`, `S.projFilter`, `S.projId`, `S.projTab` all declared upfront in the `S` object, no scattered `if(!S.x)` lazy initializers (avoids the state-fragmentation bugs where months disappeared after re-renders).
