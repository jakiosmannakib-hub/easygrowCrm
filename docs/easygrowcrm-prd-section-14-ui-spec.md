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
| 4 | Clients | `/clients` | SA, HR, PM, TL *(added 2026-09-30, moved out of Settings; §14.12a)* |
| 5 | Projects | `/projects` | all |
| 6 | Project Templates | `/templates` | SA, HR, PM, TL |
| 7 | My Tasks | `/my-tasks` | SA, HR, PM, TL |
| 8 | Daily Task Plan | `/daily-plan` | all |
| 9 | End-of-Day Reports | `/eod` | all |
| 10 | Leave Requests | `/leave` | all |
| 11 | Review | `/review` | SA, HR, PM, TL |
| 12 | Reports | `/reports` | SA, HR, PM, TL |
| 13 | Audit Log | `/audit` | SA, HR *(new — was not in prototype)* |
| 14 | Settings | `/settings` | SA, HR |

- Sidebar: logo top, items with lucide icon + label, active item highlighted, Logout at bottom. **The prototype's user-switcher dropdown must NOT ship.**
- *(ADDED PUL-422: a collapsible sidebar.)* A **Toggle sidebar** button (Menu icon, `aria-expanded`) sits at the far left of the top header.
  - **md and up, two states.** Expanded (240px, as above) or an **icon rail** (64px): icons only, each label as a tooltip to the right, the active highlight kept, Logout an icon with a tooltip, and the logo clipped to its "e" (the wordmark has no separate mark). The width animates; the main column reflows beside the sidebar and is never overlapped.
  - **Default:** the rail below a 1440px viewport, expanded at 1440px and up. A manual toggle wins and is remembered per browser (localStorage `easygrow.sidebar`; if storage is blocked the toggle still works for the page's lifetime).
  - **No flash, no hydration mismatch:** the width is CSS, keyed on the viewport and on `<html data-sidebar>`, which a tiny inline `<head>` script sets from the saved choice before first paint. React state only drives the toggle's ARIA and the tooltips.
  - **Below md:** the sidebar is hidden and the toggle opens it as a left overlay drawer with full labels, which closes on navigation, outside click and Escape.
  - Items and their visibility are unchanged (`lib/nav.ts` `visibleTo`); collapsing is cosmetic like the rest of the sidebar.
- Hidden items don't render (no grayed-out state). Route access is enforced server-side regardless (§9.5) — the sidebar is cosmetic.
- *(DECIDED Phase 1, PUL-110.2: visibility comes from an explicit `visibleTo: Role[]` list per item in `lib/nav.ts`, transcribed from the "Visible to" column above, **not** from a live `can()` call. The two answer different questions: several rows here are visible to a role that holds only the `self` variant of the underlying permission, so a `can()`-driven sidebar would show the wrong set. `requireRouteAccess` is the security boundary either way.)*
- Top header, left → right: page title + subtitle (from a `PAGE_META` map); bell icon with unread count → slide-in Notifications panel (newest first, type badges, per-item mark-read, "Mark all read"); then, right-aligned, the **signed-in user block** — Google profile picture, their name, and their role label.
- *(ADDED PUL-113: the signed-in user block.) It is **read-only** — not a control. There is no dropdown, no menu, and no account switching: this is the same surface the prototype's user-switcher occupied, and that switcher **must NOT ship** (see the sidebar bullet above). Logout keeps its single home at the sidebar bottom and is **not** duplicated here. The avatar falls back to `initials()` when `image` is null — a provisioned user who has not yet signed in has no Google picture, which is the normal state, not an error — and the role is labelled from the shared `ROLE_LABELS` map so this block and the Employees directory cannot drift (both in `features/employees/display.ts`). The data rides on the session read the shell layout already performs (`getSessionUser`, §9.5); it is not a separate query or a client-side fetch. On narrow screens the name and role may collapse, but the avatar stays visible.*
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

> **Amendment M — the page is a two-pane workspace (PUL-417).** This supersedes the Client ▾ and
> Project ▾ dropdowns below; the rest of §14.3 (header, tabs, views) still applies to the
> project pane.
>
> - **Left: workspace tree.** Collapsible `📁 Client › 🏢 Account › 📋 Project`, from
>   `getWorkspaceTree` (§13.8). Each project shows its open-task count and a dot when it has tasks
>   awaiting review. A search box filters the tree in memory. Each node has a ⋯ menu (New account /
>   New project / Start from template / Rename / Archive), each item shown only when the viewer's
>   role allows it (§9.6). Collapse state is a per-viewer convenience (browser storage), never
>   authoritative. At phone width the tree becomes a drawer.
> - **Right: the selected node.**
>   - **Client** → one card per account: projects, progress, open, awaiting review, overdue; the
>     client's **Weekly (Excel)** / **Monthly (Excel)** export (MGR-only).
>   - **Account** → its projects, each with progress and health chip; the account's exports.
>   - **Project** → the project header (breadcrumb `📁 Client › 🏢 Account › Project · type ·
>     Month N`) and the tabs below. The filter bar keeps only **Month ▾ · Assignee ▾**.
>   - **Nothing selected** → the agency-wide Review and Workload tabs.
> - **The URL is the selection:** `/projects?client=…&account=…&project=…&tab=…`. `?project=` alone
>   still works (the Start Project landing); its account and client are derived.
>
> **As built (PUL-417, not yet merged).**
> - **Tree rows:** chevron, name, and for a project its open-task count plus the review dot. An
>   "All clients" row clears the selection. Search (in memory): a matching client or account keeps
>   its whole subtree; a matching project keeps only itself and its ancestors; every surviving
>   node shows expanded while searching.
> - **⋯ menu by level:** client = New account / Rename / Archive; account = New project / Start
>   from template / Rename / Archive; project = Rename / Archive. Archived nodes offer only Rename.
>   Rename on a client or account opens the full `/clients` edit form. Project Archive asks for
>   confirmation (§14.15 r.6), as it now does in the project header. Start from template opens
>   the Start Project wizard on this page, with the client and account prefilled (§14.3.8).
> - **Client overview cards:** account name and location, `N projects · done/total · N%` with a
>   bar (pooled over tasks, not averaged per project), and `open · awaiting review · overdue`.
>   **Account overview rows:** project name, health chip (§3.1.3, same thresholds as the header),
>   `done/total · N%` with a bar, and the same counts. Clicking a card or row selects it.
> - **Nothing selected:** Review is the default tab. An employee, who sees neither tab, gets
>   "Pick a project from the tree to see its tasks." Until PUL-418, the agency-wide Weekly /
>   Monthly (Excel) buttons sit here for managers.
> - **URL:** a new node pushes a history entry (Back walks the selection); a tab change replaces
>   it. `?tab=` is checked against the role, falling back to Board (project) or Review (nothing
>   selected). Unknown, archived or mismatched ids are ignored.
> - **Collapse state:** localStorage, per viewer, never authoritative. The page renders fully
>   expanded without it; a deep-linked project's client and account start open.

**Filter bar:** *(Superseded by Amendment M, PUL-417: only Month ▾ · Assignee ▾ remain, above the tabs of the project pane. The exports move to the overviews in PUL-418.)* Client ▾ (from `getClients`, 13.8) · Project ▾ (scoped to client) · Month ▾ · Assignee ▾ · **Weekly (Excel)** · **Monthly (Excel)** (both MGR-only, server-side exports — 13.8 / PUL-413).
**Project header:** breadcrumb `📁 Client › 🏢 Account › Project · type · Month N` *(the account crumb since Amendment M, PUL-417)*; progress `9/21 · 43%` + bar; health chip (On Track / At Risk / Delayed / Critical — computed over the whole project, not the filtered month); **+ New Task** (MGR only); **Archive** in an overflow menu (MGR; confirmed in a dialog, §14.15 r.6; blocked with a toast if pending reviews — `GATE:pending_reviews`).

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
  - **MGR:** the open set + Needs revision · Cancelled. *(Amendment M removed "Done (Completed)": no one closes a task without review. The rest of this bullet is kept for history.)* ~~the open set + Needs revision · Done (Completed) · Cancelled.~~ **"Done (Approved)" is NOT in the dropdown** — approving goes through the Review modal only (13.4.5 `GATE:use_review`). ~~Completed here *is* the explicit QC-bypass and is audited as such.~~ *(PUL-416: `setTaskStatusProtected` now refuses `completed` with `GATE:use_review` too, for every role. Legacy `completed` rows still render as "Done" and still satisfy dependencies.)*
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

**List view:** collapsible **Month → Category → Task → Subtask** tree matching the template hierarchy, drawn like a file tree. Month header: chevron, `Month N — MonthName`, done count, "Current cycle" pill on `p.month`. Category header: chevron, color dot, name, done count. Task row columns: **Task · Assignee · Status pill · Due date · Priority · Est · ⋯** *(was "Owner"; renamed to match the filter bar and Task Detail, which already said Assignee)*.
- **Chevrons:** every collapsible row (month, category, and a task that has subtasks) starts with a right-pointing chevron that rotates to point down when open. Month and category groups start open; tasks start collapsed. A task with no subtasks gets an empty chevron-sized spacer instead, so titles stay aligned. The whole month/category header row is the toggle; on a task row only the chevron toggles, because the title opens Task Detail.
- **Guide lines:** a gutter of one 20px step per ancestor level (none on months, one on categories, two on tasks, three on subtasks). Each step carries a 1px vertical line in the border color, centred under that ancestor's chevron. Rows have no vertical padding of their own, so the lines of consecutive rows meet and read as one continuous guide from a parent down through its children.
- **Subtask rows** (shown when their task is expanded, fetched on expand): done / not-done icon · title, muted (struck through when done), under three guide steps. Clicking one opens the parent task's Task Detail. The task row carries a `2/4` subtask badge beside its title.
- **Due date cell** renders the full date with year (`Aug 8, 2026`), plus `· Today` or `· Overdue` suffix where relevant. Below the date on the same cell: `2/4 subtasks` small line when the task has subtasks (muted, 11px).
- Task title click → Task Detail modal. Status pill inline-editable per 14.3.2.
- `+ Add task in {Category}` link at the bottom of each open category group (MGR).
- `+ Add task` on each Month header, Unscheduled included (MGR, the same gate; PUL-421). It opens the New Task modal (14.3.8) with Month prefilled to that month and Category suggesting the categories already in it. After the save the list refetches along with the header and Board; the new task's month and category groups open even if they were collapsed; and a Month ▾ filter narrowed to another month moves to the new task's month (or to All months for a task with no month). Assignee ▾ is left alone. *(The per-category link still prefills only the category, not the month.)*

**Calendar view:** month grid, header `August 2026` (year always shown), category-colored chips per day, today highlighted with a solid teal circle around the date number. Chip click → Task Detail. Navigation: Prev / Next (server-side date shift, not just visual).

### 14.3.5 Review tab (and `/review` page — same component)
One canonical queue (13.8 `getReviewQueue`): the `/review` page = agency-wide, the project tab = filtered to that project, the dashboard card = `sort oldest`. Columns: Task · Project · Submitted by · Routed to · Summary (truncated) · Hours · Proof link · **Review** button. Tab title shows count. Filter chip: "Routed to me".
**Review Decision modal:** shows time spent vs estimate, proof link, priority, summary, issues, checklist state (read-only); 1–5 star Quality rating (click again to unset); note textarea; **Approve** / **Request Revision** (revision blocks inline without note). `CONFLICT` on decide → toast *"Already reviewed by {name} just now."*

### 14.3.6 Workload tab (MGR/HR)
Per-person capacity view of open tasks (count + est hours), on-break live indicator. Data from open statuses only; dependency-blocked tasks count as open (documented PRD §3.2.5 behavior).

### 14.3.7 Manager QA tab (SA + TL)
Reviewer scorecard: Reviewer · Reviews · Revisions requested · Avg rating given · Avg meta received. Review log table:每 row = a review; meta-rating ▾ 1–5 (13.4.8; own reviews' dropdown disabled). **Spot-check random review** button highlights a random log row.

### 14.3.8 New Task modal / Start Project Wizard

**New Task modal:** fields per 13.4.1; category pre-filled when opened from a category group; month pre-filled (and still editable) when opened from a List Month header (PUL-421); assignee ▾ excludes SA and inactive users. *(PUL-416, Amendment M: there is no "QC required" toggle. Review is mandatory, so `qcRequired` is never sent and the column default, true, applies.)*
- **Month ▾** *(PUL-421)*: `No month` (one-off work, the Unscheduled group) plus Month 1 to 12, labelled like the List headers (`Month 3` plus its calendar month). A prefilled month past 12, from a long template, is added to the list rather than dropped. `createTask` still takes any integer month; 13.4.1 is unchanged.
- **Category:** free text. When opened from the List it also suggests (a native datalist) the categories already in the month Month ▾ shows, following it if the month changes. A new name starts a new category group.

**Start Project wizard** (from a template card or its detail view, or from an account's ⋯ menu in the Projects tree, PUL-417):
- Summary banner at top: `N tasks · N months · N roles · N QC gates will be generated`.
- **Step 0 — Choose template** *(only when opened from the Projects tree, PUL-417.6)*: one row per live template with its `N tasks · N months · …` line. The client and account arrive prefilled from the tree node.
- **Step 1 — Choose client, account & project name:** client ▾ (from `getClients`, 13.8) · account ▾ (the client's live accounts, Amendment M) with an inline **+ New account** (name only, §13.2.4 `createAccount`, for `account.create`; the new account is selected at once) · project name (defaults to template name, editable). *(When there are no active clients, or the viewer cannot create accounts and the client has none, the hint links to `/clients` (§14.12a).)*
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

> **As built (PUL-506 Stage 2), `features/templates/components/start-project-wizard.tsx`.**
> - **Where:** a Start Project button on each template card (§14.4.1) and in the detail header
>   card (§14.4.2), rendered only for `project.create`. HR gets neither the button nor the data
>   behind it (clients, users and template tasks are read only when it is shown). Since PUL-417
>   also an account's ⋯ "Start from template" in the Projects tree, for `project.create` +
>   `template.read`; `/projects` then reads the templates server-side for that viewer only.
> - **State:** the Add Month wizard's pattern (§16.10): one state object declared upfront, the
>   body mounted only while open (mounting is the reset), a `DialogTrigger`, no fetch on open.
>   The step strip is the shared `StepIndicator` (`components/step-indicator.tsx`).
> - **Step 2** shows each picked date below its input as `Sep 10, 2026`. Next is refused when the
>   deadline is before the start, or when the template has `before_deadline` tasks and there is
>   no deadline (the label then drops "(optional)"), so `GATE:no_deadline` is caught here.
> - **Step 3** lists the distinct roles the tasks use (`templateRoles`), each with a task count;
>   tasks with no role are counted in a note and always start unassigned.
> - **Step 4** rows: `#N · title · category · role · rule pill · QC`. The pill is `Day N`,
>   `Nd before deadline` / `On deadline`, or `After #M`, followed by the computed date. Dates come
>   from `computeDueDates` with an empty holidays set, the same call the action makes, and
>   titles from the action's own `projectTaskTitle`, so the preview matches what is generated.
>   If the rules do not resolve, a notice replaces the dates and the server's GATE toast decides.
> - **Toast** (no em dash in UI text): *"'{name}' created. N tasks generated across M months.
>   Opening now."* Errors go through `showErrorToast`.
> - **Landing:** `/projects?project=<id>&tab=list`. The Projects page resolves `?project=` against
>   the workspace tree (an active project; anything else is ignored), derives its account and
>   client, selects it in the tree, and opens the project pane on the List tab with Month and
>   Assignee at All. `?tab=` is checked against the viewer's role. This replaces the prototype's
>   `S.projTab`. Opened from the tree, the dialog closes itself after Generate.
> - **PUL-417.6:** two exports from the same file. `StartProjectWizard` is the template pages'
>   button (fixed template, opens on step 1). `StartProjectDialog` is the controlled dialog the
>   Projects workspace hosts: every live template, step 0 first, client and account prefilled
>   (ids not in the tree are dropped). Accounts created inline are kept in the wizard's state
>   until `router.refresh()` brings them into the page's list.

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
  - **Month header:** chevron · calendar icon · month name (`Month 1 - January 10`, a spaced hyphen, not an em dash) · meta (`N tasks · N categories`) · action buttons **Add category** / **Rename** / `×` delete.
  - **Column header row** (when open): Task · Role · Due rule · Priority · Est · QC gate · Proof · ⋯ *(PUL-416: `qc_required` is always true, so the QC badge now shows on every task and the "QC Gates" stat equals the task count. Whether to drop both is an open UI call, not yet decided.)*
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
- Live label preview: `Month N - MonthName Day` (updates without re-rendering the modal). *(As built, PUL-504: template month names use a spaced hyphen `" - "`, not an em dash. This is also the name saved on the month row, e.g. `Month 2 - October 10`.)*
- **12-month cascade preview** — a scrollable list showing every month that will be created, each with number badge, computed date (`Month 1 - September 10`, `Month 2 - October 10`, `Month 3 - November 10`, …), and pill (`Filling out now` on Month 1, `Auto-created` on 2–12).
- Next button: `Next: Set up Month 1 →`.

**Step 2 — Add categories:**
- Header confirms which month is being set up (`Adding categories for Month N - MonthName Day. Only Month 1 gets set up now; Months 2–12 will be created empty.`).
- Growing list of added categories, each with color dot + × remove.
- Add row: text input with `<datalist>` of preset names (**On-page SEO, Content, Link Building, Technical, Reporting, Design**), Enter or **+ Add** to append. Duplicate names refused with a toast.
- Next button disabled until at least one category exists.

**Step 3 — Add tasks & subtasks:**
- Category tabs across the top (`Content (2)`, `Reporting (1)` — count updates live). Active tab is where new tasks land; switch by click.
- Existing task cards for the active category: header row (`#N` · title · role · due-rule pill · QC badge · × remove) followed by an inline subtask block (existing subtasks as `└ N.M title ×`, then an **Add subtask…** input + **+ Subtask** button).
- **Quick add task** panel below: title (required) · role ▾ (only roles declared on the template) · priority ▾ · est (hours) · due rule ▾ (**Day N / N days before deadline** — dependency-based rules deferred to per-task edit) · ~~QC gate checkbox~~ · Proof required checkbox · **+ Add task**. Enter in title also adds. *(PUL-416: the QC gate checkbox is removed; review is mandatory.)*
- Summary banner: `N tasks · N subtasks · N categories` — live count across all tabs.
- **Save month** button:
  - Creates **Month 1** with the user's categories, tasks, and subtasks.
  - Creates **Months 2–12** as empty scaffolds — each with the correctly cascaded date (`Month 2 - October 10`, etc.), no categories, no tasks — ready for later editing.
  - Auto-expands Month 1 in the detail view; keeps Months 2–12 collapsed.
  - Toast: *"All 12 months created — Month N has X categor(y/ies), Y task(s), Z subtask(s). Months (N+1)–(N+11) are empty scaffolds."*

### 14.4.4 Add/Edit Task modal (from template detail)
Opened from the per-category **Add task** button or the row **Edit** button.
- Fields: name (`{{ClientName}}` token supported and documented inline) · role ▾ · priority ▾ · estimate (hours) · **due-rule editor** (Amendment D — exactly three options: **Day N from month start** / **N days before deadline** / **After task #** with a dependency dropdown of every other task in the template) · ~~QC gate checkbox~~ · Proof required checkbox · Checklist textarea (one item per line). *(PUL-416: the QC checkbox is removed; review is mandatory and the actions accept only `qcRequired: true` or omitted.)*
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
Card grid: avatar, name, title, dept chip, role badge, Active/Deactivated pill; filters (dept, status, search). **+ Add Employee** → modal: email, name, role ▾, title, dept, join date (13.1.1) — copy explains *"They'll sign in with their company Google account. No invitation email is sent."* *(DECIDED Phase 1, PUL-202.3, owner's call: two sentences, no em dash; was "…Google account — no invitation email is sent.")* Card → detail: edit fields (13.1.2); **Change role** (SA only, 13.1.3); **Deactivate** → the **offboarding checklist modal** (13.1.4): lists every open assignment (reassign ▾ / cancel) and every routed review (reroute ▾); the Deactivate button stays disabled until every row is resolved; blocked entirely with an explanation if it would leave <2 managers.

## 14.12a Clients `/clients` (SA, HR, PM, TL)
*(ADDED 2026-09-30: client management moved out of Settings into its own page. No new actions; it uses 13.2's client and account actions.)* Employees don't get the nav item, and the route guard 404s them like every other guarded page (§9.5).

- **Toolbar:** name search · **Show archived** checkbox (off by default) · `N of M` count · **+ Add Client** (SA, HR only).
- **Client list:** one row per client: expand chevron · name · contact · Active/Archived pill · account count (`N`, plus `(+M archived)` when any are archived). **Edit** and **Archive…** on the row (SA, HR only); archive is blocked with `GATE:client_in_use` while the client has live accounts. Clicking a row expands it rather than opening Edit, because not every viewer can edit. Notes are edited in the Edit dialog, not shown as a column.
- **Expanded row:** the client's accounts (name, location, Active/Archived) with **+ Add account**, **Edit**, **Archive…** and **Unarchive** (SA, HR, PM, TL: `account.*`, §9.6 ¹²). Archive is blocked with `GATE:account_in_use` while the account has live projects. For an archived client, Add and Unarchive are not offered.
- **Permission-gated controls are hidden, not disabled.** The page computes one flag per resource with `can()` and requires create, update and archive all to be allowed, so if those cells ever diverge the controls hide rather than over-offer. Presentation only: every action re-authorizes.
- Deliberately a flat list. PUL-417 adds the Client › Account › Project tree to the Projects workspace (§14.3).

## 14.13 Audit Log `/audit` (SA; HR scoped)
Filters: actor ▾, resource type ▾, resource id, date range. Table: time · actor · action · resource · before→after (expandable JSON diff). Paginated. HR sees only leave/employee rows — no toggle, silently scoped. Banner: *"Viewing this log is itself logged."*

## 14.14 Settings `/settings` (SA, HR)
Company name · timezone (display-only Asia/Dhaka) · work days · shift start/end · grace time · work target · half-day target · break allowances · auto-close hours · **Discord webhook URL** (with **Send test** button; DECIDED Phase 1 — was "webhook URL", target is Discord) · **Holidays** editor (date + name rows, 13.7.3). *(inviteExpiryHours, officeIP: deleted.)* *(2026-09-30: the **Clients** section moved out to its own page, `/clients` (§14.12a). Settings holds no client management. Until PUL-903 builds these fields, `/settings` renders the shared placeholder.)*

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
