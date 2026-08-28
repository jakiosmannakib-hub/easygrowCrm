# EasyGrowCrm — Product Requirements Document (§1–§8: Overview & Foundations)

**Target stack:** Next.js + TypeScript + PostgreSQL

This document is the narrative overview of EasyGrowCrm — its purpose, roles, modules, workflows, and the reasoning behind the core decisions. The binding technical specification lives in §9–§17 (Auth, Attendance, Schema, Tech Stack, API Contract, UI Spec, Testing, Design Principles, Build Plan); where a detail here and there differ, §9–§17 govern.

---

## 1. Overview & Purpose

### 1.1 What EasyGrowCrm HRM is

EasyGrowCrm HRM is a single internal operating system for a small-to-mid-sized digital agency. It combines three things that would normally be three separate SaaS subscriptions:

1. **HR & attendance** — sign-in/sign-out, break tracking, leave requests, and attendance history.
2. **Project management** — a ClickUp/Monday-style client work hierarchy (Client → Project → retainer month → category → task → subtask), with a Board view, List view, Calendar view, project templates, dependencies, and role-based task generation.
3. **Quality control** — a submission → QC review → approve/revise loop with a Manager QA layer where the Head of SEO rates the managers' reviews.

The prototype was built for **EasyGrow Digital**, an SEO/GEO agency based in Chattogram, Bangladesh. Company details are seeded but should be configurable:

- Timezone: `Asia/Dhaka (GMT+6)`
- Work week: Sun–Thu (Bangladesh weekend is Fri–Sat)
- Standard shift: 09:00–18:00
- Late grace: 15 minutes (on-time sign-in = by 09:15)
- Break allowance: 60 minutes/day

### 1.2 Who it's for

- **Super admin / founder** — full visibility, runs the business, spot-checks the QA layer.
- **Admin/HR** — manages employee profiles, invitations, leave approvals, company settings.
- **Project managers and team leads (roughly 5–7 of them)** — the QC layer, review submitted work, approve or request revisions, oversee workload.
- **Executives (roughly 15+)** — do the delivery work, submit for review, log time, follow SOPs.
- The Head of SEO / super admin also runs the **Manager QA** layer, rating managers' reviews on quality.

Team size assumption: ~15–20 people to start, designed to scale to ~50 without restructuring.

### 1.3 Problems it solves

- **Fragmented tools** — one tool for HR, another for time tracking, another for projects, another for QC, all disconnected. EasyGrowCrm unifies them so daily plans, project tasks, sign-in and EOD reports feed each other.
- **Silent QC bypass** — in most systems executives can mark work "done" and it ships. EasyGrowCrm forces every project task through a QC queue that only a manager can close.
- **Recurring monthly work reinvented every month** — templated retainers with role-based assignment and smart due-date rules let a Local SEO monthly campaign be started in ~60 seconds.
- **Invisible workload** — real-time capacity view against 8h daily / 40h weekly / ~176h monthly targets so PMs can see who has room before assigning more work.
- **No accountability trail** — every submission, review, revision, rating, and comment is logged; the Head of SEO can rate any manager's review 1–5 and spot-check random reviews.

### 1.4 Design north stars

- **One "task box" everywhere.** Clicking a task in Board, List, or Daily Task Plan opens the identical detail modal. One control (`StatusPillSelect`) is used in every view so status changes work the same way in Board, List, Daily Plan, and Task Detail.
- **HR data and project data reconcile.** Time logged on a project task is the same data as hours logged at sign-out; there is no separate timesheet.
- **QC is a queue, not a task list.** Review work has its own tab so it doesn't get buried among personal tasks.
- **Nothing can be edited after submission.** Submission locks the checklist and subtasks; only comments stay open. Managers can override status if they need to. Subtasks are a distinct, explicitly-permissioned sub-object (§9.6 ⁷, §14.3.3).
- **Employees never approve their own work.** Enforced at the state-machine level, not just UI.

---

## 2. User Roles & Permissions

Four roles ship. Every capability below is exhaustive — go feature by feature.

### 2.1 super_admin (founder / Head of SEO)

**Can see:**
- Everything visible to any role.
- Manager QA tab in Projects (only super_admin and team_leader see this; see §3.3).
- All employees, all projects, all attendance, all reports, all templates.
- All notifications company-wide.

**Can do:**
- Full access to Settings (company info, shift rules, webhook URL).
- Create, add, edit, deactivate any employee (accounts are provisioned directly — no invitation email; §13.1.1).
- Create, edit, delete Project Templates.
- Add tasks to any template; remove tasks from any template.
- Start a project from any template.
- Create ad-hoc project tasks in any project.
- Reassign any task, change any task's due date, change any task's status directly.
- Submit for review (as any employee they act as); approve or request revision on any submission.
- **Rate manager reviews 1–5** on the Manager QA tab (the meta-rating layer).
- **Spot-check a random review** on the Manager QA tab.
- Approve or reject leave requests.
- Export any report (Excel).
- View and add to their own private "My Tasks" list.

**Can't do:**
- Approve their own submissions (enforced by rule: `reviewer_id ≠ submitter_id`).

### 2.2 admin_hr

**Can see:**
- Everything the super_admin sees except the Manager QA tab in Projects.
- Attendance history (full 2-year set), all employees' EOD reports, all leaves.

**Can do:**
- Full access to Settings.
- Full access to Employees module (add, edit, deactivate). HR also manages Clients — create/edit/archive (§9.6 ¹⁰).
- Approve/reject leave requests.
- All project-side capabilities of a project_manager (create tasks, assign, review, approve/revise).
- Add and remove template tasks; create and delete templates.
- Start projects from templates.
- Access their own private "My Tasks" list.
- Export any report.

**Can't do:**
- Rate manager reviews (not on the Manager QA tab).
- Approve their own submissions.

### 2.3 project_manager

**Can see:**
- Dashboard, Attendance (today's team view + history), Projects, Project Templates, My Tasks, Daily Task Plan (their own + team filter), End-of-Day Reports (all), Leave Requests, Manager Review page, Reports.
- Workload tab in Projects (capacity view of the whole team).
- Review queue tab in Projects.

**Cannot see:**
- The Employees module (super_admin/admin_hr only).
- Settings.
- Manager QA tab (super_admin and team_leader only).

**Can do:**
- Assign any task in projects they manage; change assignees and due dates.
- Add tasks to any template; remove tasks from any template; create and delete templates.
- Start a project from any template.
- Create ad-hoc project tasks in any project.
- Submit their own work for review; approve or request revision on submissions routed to them (or on any submission).
- Change a task's status directly (override to Approved, Completed, Cancelled, etc.).
- Approve/reject leave for their reports (implementation detail — currently open to any manager).
- Access their own private "My Tasks" list.
- Export the Excel reports (weekly/monthly EOD, client task deliverable reports, attendance history, employee performance).

**Can't do:**
- Approve their own submissions.
- Access Employees or Settings modules.

### 2.4 team_leader

Same as project_manager, **plus** access to the **Manager QA** tab in Projects (rating other managers' reviews). This is the "Head of SEO" level in EasyGrow's structure — one step below super_admin, one step above project_manager.

### 2.5 employee (executive)

**Can see:**
- Dashboard (personalized with their own status + upcoming project tasks).
- Attendance page (own sign-in state, break controls).
- Projects (Board, List, Calendar views; can filter to their own assignments).
- Daily Task Plan (own only).
- End-of-Day Reports (own only).
- Leave Requests (own only).

**Cannot see:**
- Employees module, Settings, Templates, My Tasks, Manager Review, Workload tab, Manager QA tab, Review queue.

**Can do:**
- Sign in (work type + daily plan only; no selfie, IP, or location capture — §3.4).
- Take breaks (Lunch, Prayer, Personal, Meeting, Internet issue, Power issue, Emergency, Other), end breaks.
- Sign out (with per-task status + explanation of any incomplete work).
- Update status on their own open project tasks between **Not Started / Working on it / Blocked** (limited set — they can't push to Approved/Completed).
- **Submit their own project tasks for review** (via the pill dropdown's "➤ Submit for review…" option, or the Submit button on the row/detail).
- Add subtasks, tick checklist items, and comment on any task they can see.
- Enter actual time spent on a task (h+m format).
- Add tasks to the daily plan (from projects, or ad-hoc at sign-in).
- Request leave (Sick, Casual, Emergency, Half day, WFH, Late arrival, Early leave, Overtime).

**Can't do:**
- Approve their own or anyone else's work.
- Mark a project task Approved or Completed directly (the status pill hides those options for employees).
- Rate reviews.
- Create, edit, or delete templates.
- Reassign a task to someone else.
- Change another user's daily plan.
- Access the Manager Review, Workload, Manager QA, Templates, My Tasks, Employees, or Settings pages.

### 2.6 Cross-cutting rules

- **No self-approval.** Enforced regardless of role: the person who submitted a task cannot approve it. This must be enforced at the API layer, not just the UI.
- **Deactivated employees** still appear in historical data but cannot be assigned new tasks and cannot log in.
- **Role changes** should retroactively affect visibility of pages but not rewrite past assignments.

---

## 3. Core Modules

### 3.1 Projects module

The Projects module is the delivery engine. Data hierarchy:

```
Client → Project → Retainer month (currentMonth: N) → Category → Task → Subtask
                                                              ↓
                                                          Checklist items
                                                              ↓
                                                          Comments, Review history
```
This is formalized as the strict hierarchy **Agency → Project → Month → Category → Task → Subtask** (Amendment J), where Months and Categories are real hierarchy levels that live at the **template** and get cloned in at project instantiation. Binding schema: §11.4; binding UI: §14.4. "Retainer month" here and "Month" there are the same concept.

**Views (tabs in the project header, in this order):**

1. **Board** (default) — Monday.com-style grouped table.
2. **List** — collapsible tree grouped by month, then category.
3. **Calendar** — month grid with category-colored task chips.
4. **Review** — QC queue tab (managers only).
5. **Workload** — team capacity view (managers only).
6. **Manager QA** — reviewer scorecard + review log with meta-rating (super_admin + team_leader only).

> **Design decision:** the **Overview tab was deliberately removed** — see §7.

**Filters (in the filter bar, above the project header):**

- Client dropdown
- Project dropdown (scoped to the selected client)
- Month dropdown (`All months`, or specific `Month N — MonthName` labels, calendar-anchored via the project's start date)
- Assignee dropdown (`All assignees` for managers, or a specific person; employees see only themselves)
- Weekly (Excel) and Monthly (Excel) export buttons on the right

**Project header (below the filter bar, above the view):**

- Crumb: `Client › Project name · project type · Month N — MonthName`
- Progress: `X/Y tasks · N%` with a horizontal bar
- **+ New Task** button (visible to everyone with project access)
- Health chip: `On Track | At Risk | Delayed | Critical` (see §3.1.3)

#### 3.1.1 Board view (Monday-style)

Groups tasks by category. For each category group:

- Colored group title bar with the category color.
- Group header: chevron, category name, done count (`3/8`).
- A thick colored stripe down the left edge of every row (Monday's group stripe).
- Columns: Task title, Owner (avatar), **Status pill (interactive dropdown)**, Due date (red when overdue), Priority pill, Est. (h+m format).
- **A colored status distribution bar under each group** summarizing how much is done, working, or stuck.
- **"+ Add task" row** at the bottom of every group (Monday's quick-add). Opens the New Task modal with that category pre-selected.
- Collapsible groups (click the group header).

**Category color palette** (add more as needed):

| Category | Color |
|---|---|
| GBP Management | `#0EA894` |
| Citation Management | `#8B5CF6` |
| Link Building | `#3B82F6` |
| On Page | `#D9860E` |
| New Blog Publish | `#0EA5E9` |
| Content Marketing | `#EA580C` |
| Technical SEO | `#5A63E0` |
| Reporting | `#64748B` |
| Client Update | `#16A34A` |
| Design | `#DB2777` |
| Development | `#0891B2` |
| Kickoff | `#475569` |

**Status pill palette** (Monday's color language):

| Internal status | Displayed label | Color |
|---|---|---|
| Planned | Not Started | `#C4C4C4` |
| In Progress | Working on it | `#FDAB3D` |
| Submitted | Awaiting review | `#579BFC` |
| Revision Required | Needs revision | `#E2445C` |
| Approved | Done | `#00C875` |
| Completed | Done | `#00C875` |
| Blocked | Blocked | `#A25DDC` |
| Cancelled | Cancelled | `#808080` |

**Priority pill palette:**

| Priority | Color |
|---|---|
| Urgent | `#E2445C` |
| High | `#FDAB3D` |
| Medium | `#579BFC` |
| Low | `#C4C4C4` |

**Interactive status pill (`StatusPillSelect`):**
- For **managers/canManage**: full set — Planned, In Progress, Blocked, Revision Required, Approved, Completed, Cancelled.
- For **the assignee (isMe)**: limited set — Planned, In Progress, Blocked (+ the current status if it's outside that set, so nothing gets stuck).
- For **anyone else (or when locked)**: read-only pill.
- If the task is `Submitted | Approved | Completed | Cancelled` the pill is locked for the assignee (only managers can override).
- If the assignee can submit (`Planned | In Progress | Revision Required`, not blocked), the dropdown includes a special "➤ Submit for review…" option that opens the Submit modal.
- If the task is blocked by an unresolved dependency, the pill shows the Blocked color and the tooltip names the dependency.

#### 3.1.2 List view

Groups tasks by month, then by category. Columns match the board (title, owner, status pill, due, priority, est.). Same interactive status pill. Same clickable title.

**Design decision:** the list view was rebuilt to match the board's look and feel — fixed-width columns, the same colored status pill dropdown, the same solid priority pills. Users kept expecting to change status in the list (they couldn't originally) and it wasn't visually consistent with the board.

#### 3.1.3 Project health score

Computed from open tasks (excludes Completed, Approved, Cancelled):

```
overdue_count = # of open tasks with due_date < today
waiting_review = # of tasks with status = Submitted

if overdue_count >= 4      → "Critical"  (#DC2626)
elif overdue_count >= 2    → "Delayed"   (#EA580C)
elif overdue_count == 1
     or waiting_review >= 3 → "At Risk"  (#D97706)
else                       → "On Track" (#16A34A)
```

Recomputed live; shown as a colored chip on the project header.

#### 3.1.4 Review queue (Review tab)

Shows every task with status `Submitted` across the current project (or projects — implementation may narrow scope).

Columns: Task, Project, Submitted by, **Sent to** (chosen reviewer, or "Any manager" if none picked), Summary (truncated), Hours (time spent, h+m), Proof (link if attached), Review button.

Clicking Review opens the Review Decision modal — see §4.

The tab title shows a count: `Review (12)`.

#### 3.1.5 Workload tab

Two sections:

**A. Capacity — Daily / Weekly / Monthly tabs**
Per team member: stacked bar showing Worked (teal `#0EA894`) / Break (amber `#F5B300`) / Remaining (gray) against target hours (8 daily, 40 weekly, ~176 monthly).
- Daily numbers computed live from actual sign-in time, break minutes, and break-in-progress state.
- Weekly/monthly numbers pulled from attendance history.
- Break time > 1h 15m (daily) or > 15% (weekly/monthly) shows in orange as a warning.
- If the person is currently on a break, shows a live-ticking `On break — 12m` cell.

**B. Task workload**
Per team member: open tasks, due today, overdue, total open estimated hours, today's estimated hours vs 8h capacity bar, status label (Overloaded / Balanced / Light). Overloaded = today's hours > 8 or overdue ≥ 3.

#### 3.1.6 Manager QA tab (super_admin + team_leader only)

**Reviewer scorecard table:**
- Manager / reviewer
- Reviews (count)
- Revisions requested (count)
- Avg rating given (of executives' work; 1–5)
- Avg Head rating received (this manager's reviews, rated by the Head of SEO)

**Review log table (below the scorecard):**
- Every review a manager has ever made
- Columns: Reviewer, Task, Project, Decision (Approved / Revision), Rating given, Note, Head rating (a `Rate…` dropdown to set 1–5)
- **"Spot-check random review"** button that highlights a random row for the super admin to audit

**Business rationale:** managers are the QC layer. If nobody watches the watchers, rubber-stamped approvals are the failure mode. This layer catches that.

#### 3.1.7 Client task Excel exports (from the Projects filter bar)

Two buttons: **Weekly (Excel)** = last 7 days by due date; **Monthly (Excel)** = last 30 days.

Rules:
- **Client-forwardable.** One sheet per client (only clients with tasks in the period).
- **Only Completed, Approved, and In Progress tasks** are included (never Submitted, Blocked, Cancelled, Planned).
- Columns: Project, Month, Task name, Category, Due date, Status (Approved is relabeled "Completed" for the client), Time spent (actualHours if set, else submission.hours), Deliverable (proof link only — never the internal summary).
- No assignee, no priority, no internal notes.

> **Design decision:** the export was rebuilt to be client-safe after feedback that internal summaries and priority pills didn't belong in what could be forwarded to clients.

### 3.2 Task lifecycle

See §4 for the full state machine. High-level summary:

- Tasks live inside a project, tied to a category and (optionally) a retainer month.
- Task fields tracked (data model): `id, projectId, month, category, title, description, assigneeId, role, dueDate, status, priority, estimatedHours, actualHours, expectedOutput, proof, qcRequired, proofRequired, clientVisible, sop, dependsOn, checklist[{text,done}], subtasks[{id,text,done}], comments[{id,by,text,at}], submission{summary,hours,issues,at,by,reviewerId}, revisionNote, qualityRating, reviewHistory[{decision,note,rating,metaRating,metaBy,at,by}], createdBy`. The binding row shape is `project_tasks` in §11. (`billable` and `recurring` are not part of it — see §7.3 and §3.2.6.)
- Time entry uses **h+m format everywhere** (e.g. `1h 30m`, `45m`). Storage stays as decimal hours (1.5 = 1h 30m) so math sums correctly; the `HMInput` and `fmtHM` helpers handle conversion.
- **Actual time is user-entered** on the task detail modal ("Actual time (from your time-tracking tool)"). The system does not implement its own stopwatch — it assumes the team uses an external tool for the timer itself.

#### 3.2.1 Subtasks
Ordered list on any task. Each subtask: `{id, text, done}`. Add/toggle is restricted to the assignee and managers (`project_task.subtask_manage`, §9.6 ⁷); HR and non-assignee employees are read-only, and subtasks lock while `Submitted`, same as the checklist. They don't gate submission — informational only.

#### 3.2.2 Checklist
Ordered list of `{text, done}` items on the task. **All checklist items must be ticked before a task can be submitted for review.** This is the SOP-enforcement mechanism.

#### 3.2.3 Comments
Threaded comments on any task, with author avatar and timestamp. Stay open even after submission (unlike checklist/subtasks which lock).

#### 3.2.4 Proof of work
Free-form: `{type, value}`. Proof types available: URL, Google Doc link, Google Sheet link, Screenshot, File upload, Loom video link, Staging site URL, Published page URL, Report link, Other. Some tasks are `proofRequired: true` and cannot be submitted without one.

#### 3.2.5 Dependencies
A task can have `dependsOn: <other task id>`. The dependent task is **locked** (can't be submitted, shown with a lock icon) until the upstream task reaches `Approved` or `Completed`. Templates use this to enforce order (design → dev → QA → launch).

#### 3.2.6 Recurring work

Recurring work is expressed as **explicit numbered template tasks** — "Rank check — week 1/2/3/4," each with its own `day`-kind due rule — rather than one task that regenerates itself. All occurrences are created up front at project instantiation (or, for month-over-month recurrence, by the Add Month wizard's 12-month cascade, §14.4.3). There is no auto-spawn on approval.

### 3.3 Project Templates

Templates are the leverage point — "Start a Local SEO monthly campaign for Client X, Month 8" is a ~60-second wizard.

#### 3.3.1 Data shape

Templates are a strict hierarchy — `templates → template_months → template_categories → template_tasks → template_task_subtasks` (the binding schema is §11.4):

```
Template:         { id, name, description, category, roles: [role_name] }
TemplateMonth:    { id, num, name, start_month, start_day }
TemplateCategory: { id, name }
TemplateTask: {
  title, role, priority, estHours, rule,
  qcRequired, proofRequired, clientVisible,
  sop, checklist: [text], expectedOutput
}
TemplateSubtask:  { id, title }
Rule (one of):
  { kind: "day", n: N }                     # Due on Day N from the month's start
  { kind: "before_deadline", n: N }         # Due N days before deadline (n=0 = on deadline)
  { kind: "after", ref: <template_task_id> } # Due after the referenced task
```

Notes:
- Only three due-rule kinds exist: `day`, `before_deadline`, `after`. Recurrence is explicit numbered tasks (§3.2.6), not a rule kind.
- `after` refs point at a `template_task_id` (never a position), so deleting an unrelated task never shifts another task's reference.
- Subtasks are cloned into live tasks at instantiation (`done = false`, §13.3.2).

#### 3.3.2 Template gallery page

- Grid of template cards. Each card: category label, name, description, meta (`10 tasks · 5 roles · 3 QC gates`), View button, Start Project button. (the meta row also shows a Months count, §14.4.1).
- **+ New Template** button (top right).
- Clicking View opens a full **page** showing the month → category → task → subtask tree (§14.4.2), with inline add-task forms at the category level and an **Add Month wizard** (§14.4.3) that creates all 12 months of a cycle in one step.
- Each template task row in the detail has an **✕ Remove** button.
- **Delete template** with a "Confirm delete?" step; already-running projects are not affected (they hold their own copy of the template's tasks at instantiation). (running projects hold their own copy, §16.7).

#### 3.3.3 Token replacement in titles

Template titles can use `{{ClientName}}`, `{{MonthName}}`, `{{ProjectName}}` — replaced at project launch. Example: `"Prepare {{MonthName}} report for {{ClientName}}"` → `"Prepare July report for The Window Source"`.

> **Design decision:** added because the same template running for 20 clients was producing 20 identical-looking task names in daily plans.

#### 3.3.4 Start Project Wizard (4 steps, §14.3.8)

- **Step 1 — Client & name:** pick the client and project name (defaults to the template name).
- **Step 2 — Dates:** start date and deadline (their own step because month-anchored due-date math depends on them, §13.3.2).
- **Step 3 — Assign roles:** map each template role to a real employee. Unassigned is allowed; those tasks surface in the Unassigned board group. There is no self-claim — a manager assigns them (§13.4.3).
- **Step 4 — Preview:** a table of every task that will be generated, with `{{ClientName}}` tokens resolved and due dates computed, so the user sees exactly what will be created before clicking Create.

#### 3.3.5 Add / edit task in a template (§14.4.4)

Fields: title (with token hint), role (from template.roles), category (from category palette), priority, due rule kind, N value if applicable, estimate (h+m), QC required checkbox, Proof required checkbox, plus a Subtasks panel and a Checklist textarea — all saved together (§14.4.4).

**Rule for removing template tasks:** `after` refs point at a `template_task_id`, so deleting an unrelated task never shifts anyone else's reference. Deleting a task that something else depends on surfaces as a validation error at delete time (`GATE:task_has_dependents`) rather than silently changing another task's due rule.

#### 3.3.6 Seeded templates (ship with these three)

- **Local SEO Monthly Campaign** — 10 tasks: prev-month review, GBP performance check, GBP posts (with QC), publish, citations (with QC), verify citations, weekly rank check (recurring, weekly Mon), local ranking grid check, monthly report, send client update.
- **Website Design Project** — 7 tasks with a full dependency chain: kickoff → wireframes → copy → design → dev → pre-launch QA → launch/handover.
- **Technical SEO Audit** — 4 tasks: crawl, CWV+indexation review, prioritized fix roadmap, QC & deliver.

### 3.4 HR & Attendance

#### 3.4.1 Sign-In flow (opens a modal)

The sign-in modal collects just **Work type** ▾ (In-office / Remote / Client site) and the **Daily plan**. No selfie, IP check, geolocation, or network capture — a deliberate trust decision (§14.6.1).

- **Work type** — In-office / Remote / Client site
- **Daily plan** — a list of tasks the employee commits to for today, each with title, client, category, priority, estimated time (h+m), expected output.
  - **Pre-populated with assigned project tasks due today** so employees don't manually re-enter them. These arrive with a "From [Project]" label and use the category from the project (falling back to "Other" if the project category isn't in the standard task category list — the daily plan category select is tolerant of non-standard values).

Sign-in creates:
- An `attendance` row: `{id, employeeId, date, workTypeToday, signInTime, activeBreak: null, breaks: [], breakMinutes: 0, eodSubmitted: false}` (the binding shape is §11's `attendance` table).
- One `task` row per plan item, all with status `Planned` and `date: TODAY_ISO`.

Linked project tasks that appear in today's plan get their status pushed to `In Progress` on the project side, since the employee has committed to them.

#### 3.4.2 Breaks

- Any signed-in employee can start a break at any time.
- Break types: **Lunch break, Prayer break, Personal break, Meeting, Internet issue, Power issue, Emergency, Other**.
- While on a break, a live-ticking timer shows on the dashboard, on the attendance card, and in the workload capacity view.
- Ending a break rounds elapsed time to the nearest minute, appends `{type, startTime, endTime, minutes}` to `breaks[]`, and increments `breakMinutes` (a running total for the day).
- Default break allowance from Settings is **60 minutes/day**. Exceeding it doesn't block anything but shows warnings and factors into the EOD score.

#### 3.4.3 Sign-Out flow (opens a modal)

Per-task rows (for each task on today's plan):

- Task title, client, category, priority chips (matching the task-box everywhere).
- Status dropdown:
  - For **project-linked tasks**: the done-equivalent option is **"Done — send to review"** (which routes to QC); `In Progress, Partially Completed, Pending, Blocked` also available. "Completed" is not offered to employees — it's a manager-only override elsewhere (§14.3.2).
  - For **ad-hoc tasks**: `Completed, In Progress, Partially Completed, Pending, Blocked`. *(Ad-hoc/daily-only tasks aren't QC-routed, so "Completed" here was never the colliding word — Amendment I's ban is specifically about the option that used to alias with project-task submission.)*
- Time spent (h+m).
- Proof type + link/filename.
- **Reviewer dropdown** (only if project-linked and the status routes to QC): choose which manager/PM/team lead the submission goes to. Defaults to the first available reviewer.

Overall fields:
- **Explanation** — required if any task is not "done" (`Completed` or `Submit for review`).
- **Blockers** — free text.
- **Issues faced** — free text.
- **Tomorrow's priority** — free text.
- **Final remarks** — free text.

> **Design decision:** we **do not** block sign-out when tasks are still "In Progress." Explanation is only required for incomplete tasks (the stricter lock was tried and removed — see §7). Separately, choosing the done option on a linked project task enforces that task's own submission gates — checklist complete, proof attached where required — before sign-out finishes (§10.5, §13.4.6).

Sign-out creates:
- Updates the attendance row with `signOutTime`, `signOutLocation`, `eodSubmitted: true`.
- Creates an `EOD report` row (see §6.1).
- Pushes daily-task status → project-task status (see §3.4.5).

#### 3.4.4 End-of-day record (no score)

There is no productivity score. Sign-out produces an **EOD report** as a free byproduct — which tasks were worked, outcomes, actual hours, and an optional note — but no number is computed from it. Managers give a lightweight, non-blocking acknowledgment: ✓ Reviewed or 🚩 Flagged with a note (§10.8, §13.5.7). Submission gates (checklist, proof) are enforced at submission, not retroactively.

#### 3.4.5 Daily-plan ↔ project-task sync at sign-out

For each row on the sign-out sheet that's linked to a project task:

- If row status is `"Submit for review"` OR `"Completed"`:
  - The daily task's stored status is normalized to a done-equivalent for the EOD report's `done/total` bookkeeping (§14.8).
  - The linked project task's status is set to **`Submitted`**, submission record populated with `{summary, hours, issues, at, by, reviewerId}`, proof attached, `actualHours` populated from the sign-out entry (the atomic sign-out transaction, §13.5.4, gated by checklist/proof completeness, §10.5).
  - A notification is posted with the reviewer names (from all unique reviewers chosen).
- Else the row status flows through as-is to both the daily task and (if not locked) the project task.

Rules that must hold:
- If a project task is already `Submitted | Approved | Completed`, sign-out cannot change it.
- Proof updates always flow to the project task (even without a status change).

#### 3.4.6 Attendance page (top-level nav)

**Today tab** (default):
- Grid of currently-signed-in employees with badges for on-break, work type, sign-in time, break totals.
- Department filter.
- Live break timer next to any on-break employee.

**History tab:**
- Two years (730 days) of attendance history — seeded deterministically via a seeded PRNG so demos always look realistic (see §8.4).
- Filters: employee dropdown (All or specific), date range (from/to).
- Summary counts inline: `421 records · 380 present · 25 late · 16 absent` with color-coded counts.
- Table columns: Date, Employee, Status, Sign in, Sign out, Worked (h+m), Break (h+m) (§14.5).
- Renders first 400 rows on-screen; full set goes into Excel export.
- **Export (Excel)** button — see §6.5.

Employee's own view of Attendance is a card with sign-in status, break controls, and their own history filtered to their user.

#### 3.4.7 Leave Requests

Types (from `LEAVE_TYPES`):
- Sick leave, Casual leave, Emergency leave, Half day, Work from home request, Late arrival request, Early leave request, Overtime request.

Annual quotas (`LEAVE_QUOTAS`): Sick 12, Casual 10, Emergency 5. Others are unlimited but still tracked.

Requests carry `{id, employeeId, type, startDate, endDate, reason, status, requestedAt, decidedBy, decidedAt, managerComment}`. Status: Pending → Approved/Rejected.

`leaveDays()` computes inclusive days between start and end for quota deduction (only Approved leaves against quotaed types count).

Employees can request; managers approve/reject. Approved leaves reduce quotas visible to both the employee and HR.

### 3.5 Employee Performance Reports

Lives at the bottom of the Reports page. Only shows when a **non-Daily** period tab is selected (Weekly / Monthly / Yearly), since single-day averages aren't meaningful.

Per employee (Active employees only, `role ∈ {employee, team_leader}`, sorted by avg score descending):

- **Present / Late / Absent** day counts in the period
- **On-time sign-in %** — signed in by 09:15 (the `GRACE_IN = 9*60+15` constant). Green ≥90%, amber ≥70%, red below.
- **Full-shift sign-out %** — signed out at or after 18:00 (`SHIFT_END = 18*60`). Same color coding.
- **Avg sign-in and sign-out times** (HH:MM)
- **Avg worked hours** and **avg break time** per day (h+m)

**Export (Excel)** button for the current period (generated server-side, §12).

> This report was added specifically because "timely login/logout" was called out as a needed metric. *(Still true — this is exactly why §14.11's Attendance tab kept late-count and avg-hours metrics even after the score was removed.)*

### 3.6 Daily Task Plan page

**Employee view:** their own plan for today, editable status per row, direct **Submit** button for any project-linked task that's still open, click-to-open task detail (project tasks get the full detail modal; ad-hoc tasks get a lightweight modal with just title/priority/estimate/proof/expected output).

**Manager view:**
- Employee filter dropdown (`All employees` or a specific person).
- A **"Submitted for your review" card** at the top with the current QC queue (Task, Project, Submitted by, Time spent, Review button). Nothing waiting? Show a hint explaining that submitted-at-sign-out tasks will appear here.
- The plan table itself uses the same status pill component for project tasks (with the manager's full status set) or a Badge for ad-hoc tasks.

### 3.7 End-of-Day Reports page

Table of EOD reports across all employees (managers see all, employees see own):

- Employee, Date, Completed count/Total count, Planned hrs, Actual hrs, Blockers, Explanation, and acknowledgment state (✓ Reviewed / 🚩 Flagged + note). There's no score and no approve/reject cycle; the report content is immutable (§10.8, §13.5.7).
- Click any row → detail modal with all fields including the per-task breakdown and any explanation.

**Weekly (Excel)** and **Monthly (Excel)** export buttons on the header (§6.2; generated server-side).

### 3.8 Manager Review page

Similar to the Review queue tab in Projects, but scoped agency-wide. Managers use this to work through pending reviews without having to open each project.

### 3.9 Reports page (§14.11)

No leaderboards, no score, no ranking of people against each other. Three tabs:
- **Delivery** — tasks approved per person/project, revision rate, median review turnaround per reviewer.
- **Attendance** — late count, avg net hours, break-exceeded days, early/auto-closed flags.
- **Leave** — usage vs quota.

All tables export server-side.

### 3.10 My Tasks (Personal task list)

Available to super_admin, admin_hr, project_manager, team_leader — **not** to employees.

Private task list per user: `{id, ownerId, title, due, clientId, done}`. Used for client calls, follow-ups, proposals, admin work — anything outside project delivery. Never visible to anyone else.

Simple UI: Add form (title + due + optional client), sorted list (open first, then by due date, then done at the bottom), tick/untick, delete.

### 3.11 Employees module (admin_hr + super_admin only)

- Profile cards for every employee: name, avatar color, department, title, role, work type, status (Active/Deactivated), employment start date, contact info. (§14.12).
- Add a new employee: provisions the account directly (email, name, role, title, dept, join date); they sign in with their company Google account immediately. No invitation email (§13.1.1, §14.12).
- Edit profile fields. (§13.1.2).
- Deactivate/reactivate — deactivation is blocked until every open assignment and routed review is resolved, and always blocked if it would leave fewer than 2 active managers (§13.1.4, §14.12).
- Department chips using the seeded department colors.

### 3.12 Settings (admin_hr + super_admin only)

- **Company:** name, timezone, office location. (No office-IP gate on sign-in.)
- **Shift & attendance rules:** work days, shift start, shift end, late grace minutes, break allowance minutes. These values are read from Settings at runtime, never hardcoded (§10.1).
- **Notifications:** Slack / Discord **webhook URL** — all operational notifications (submissions, approvals, revisions, late alerts) also POST to this endpoint using a Slack+Discord-compatible payload `{text, content}`, fire-and-forget so a dead webhook can never block the UI. (§14.14).
- Settings also includes a **Holidays** editor (feeds working-day math for leave and due-date shifting, §14.14) and a **Clients** section (create/edit/archive, §9.6 ¹⁰, §14.14).

### 3.13 Dashboard

**Employee dashboard:**
- Attendance status card (signed in/out, break controls with live timer, break totals for today).
- **Upcoming project tasks (next 7 days)** — sorted by due date, overdue in red, revision-flagged. Excludes Completed/Approved/Submitted.
- Personal notifications feed.
- Leave balance summary (quotas remaining).

**Admin dashboard:**
- Team-level KPIs: active clients, live projects, tasks due today, team present (§14.2).
- Overdue submissions. (sourced from the canonical `getReviewQueue`, sorted oldest, §14.2).
- A 7-day bar of tasks approved per day (no synthesized score).
- Notifications feed.

### 3.14 Notifications

- Bell with unread count in the header.
- In-app notification list: `{id, text, type, time, read}` where type ∈ `report, attendance, leave, project`.
- Every meaningful action fires a notification: task assigned, task submitted, task approved, revision requested, project started, sign-in late, EOD flagged, leave requested/decided. (A routine ✓ Reviewed doesn't notify; only 🚩 Flagged does — §13.5.7.)
- Notifications also fire to the configured Slack/Discord webhook (§3.12).
- **In-app notifications reset on page refresh (prototype-only).** In production, notifications persist in DB.

---

## 4. Task Lifecycle — Full State Machine

### 4.1 States

Every project task is in exactly one of:

| Status | Displayed as | Meaning |
|---|---|---|
| `Planned` | Not Started | Created, assigned or unassigned, not started |
| `In Progress` | Working on it | Assignee has started work |
| `Blocked` | Blocked | Waiting on external factor or a dependency |
| `Submitted` | Awaiting review | Sent to QC; locked for edits |
| `Revision Required` | Needs revision | QC returned it with a mandatory note |
| `Approved` | Done | QC approved; the "official" done state for reporting |
| `Completed` | Done | Manager-override done (also "done" — treated identically for reporting/exports) |
| `Cancelled` | Cancelled | Scope-cut; excluded from progress and workload |

**Design decision on the two "Done" states:** `Completed` is the manager override / historical status; `Approved` is what results from the QC flow. They're treated identically in all reporting math (`status === "Completed" || status === "Approved"` is the "done" check throughout the code). Both are exposed to managers so a task can be closed without a QC round when appropriate. `Approved` renders with a small check-shield icon that `Completed` doesn't — the visual signal that QC actually reviewed it (§14.3.2). `Completed` is never offered to employees; it only appears as a manager's direct override.

### 4.2 Transitions

Denote actor as **E** = assignee/employee, **M** = manager (project_manager, team_leader, admin_hr, super_admin), **Sys** = automated.

| From | To | Actor | Trigger | Side effects |
|---|---|---|---|---|
| — | `Planned` | E, M | New Task modal, template instantiation | Row inserted, dependency ID resolved if applicable |
| `Planned` | `In Progress` | E, M | Status pill change or added-to-daily-plan on sign-in | — |
| `Planned` / `In Progress` | `Blocked` | E, M | Status pill change | Reason optional in comments |
| `Blocked` | `Planned` / `In Progress` | E, M | Status pill change | — |
| `Planned` / `In Progress` / `Revision Required` | `Submitted` | E | Submit for Review modal, OR sign-out with "Submit for review"/"Completed" for a linked task | Locks checklist, subtasks, actual hours; populates `submission{summary, hours, issues, at, by, reviewerId}`; posts notification; enters Review queue |
| `Submitted` | `Approved` | M (must be ≠ submitter) | Review Decision modal → Approve | Optional 1–5 star rating stored on task + review history |
| `Submitted` | `Revision Required` | M (must be ≠ submitter) | Review Decision modal → Request Revision | **Note is mandatory**; stored as `revisionNote`; task returns to assignee's plan with the note visible |
| `Revision Required` | `Submitted` | E | Resubmit via Submit for Review modal | Same as first submit; appended to `reviewHistory` |
| `Planned` / `In Progress` | `Completed` | M (override) | Status pill direct set | Employee never has this option; skipping QC is a manager choice |
| Any | `Cancelled` | M | Status pill direct set | Excluded from progress and health calcs |

### 4.3 Guards and gates

- **Dependency lock:** if `dependsOn` is set and that task is not `Approved`/`Completed`, the task cannot be submitted. UI shows a lock icon and the tooltip names the dependency. The status pill uses the `Blocked` color while blocked, without actually mutating the stored status.
- **Checklist gate:** if any checklist item is unchecked, submission is refused with an error box in the Submit modal.
- **Proof gate:** if `proofRequired: true`, submission is refused without a proof link/file value.
- **Summary gate:** Submit modal requires a non-empty summary.
- **Revision note gate:** Request Revision requires a non-empty note.
- **Self-review guard:** the person who submitted a task cannot approve it. Enforced server-side.
- **Post-submission lock:** while `Submitted`, only comments can be added. Subtasks, checklist, actual hours all become read-only for the assignee. Managers can still override anything.

### 4.4 Review history

Every review decision appends an entry:

```
{ decision: "approve" | "revision",
  note: string,           // mandatory for "revision"
  rating: 1-5 | null,     // manager's 1-5 rating of executive work
  metaRating: 1-5 | null, // Head of SEO's 1-5 rating of THIS review
  metaBy: userId | null,  // who meta-rated
  at: timestamp,
  by: userId }
```

The full array is visible in the Task Detail modal (with green check for approve, warning for revision) and drives the Manager QA reviewer scorecard.

### 4.5 Manager QA (meta-review)

- Only `super_admin` and `team_leader` see this tab.
- They pick a rating 1–5 from a dropdown on any row in the review log — this updates `reviewHistory[i].metaRating` and `metaBy` on the underlying task.
- Reviewer scorecard aggregates: total reviews, revisions requested, avg rating given (of executive work), avg meta-rating received.
- **"Spot-check random review"** highlights a random row in the log — the reviewer's intended workflow is: click Spot-check → glance at that decision → rate it → move on. Sample size scales with usage.

---

## 5. Workflows End-to-End

### 5.1 Employee's daily flow

1. Employee opens EasyGrowCrm in the morning. Dashboard shows they aren't signed in yet.
2. Clicks **Sign In** on the dashboard or attendance card. Modal opens.
3. Work type is picked. No selfie, IP, or geolocation capture.
4. **Daily plan step** — the modal is pre-filled with any project tasks assigned to them due today, each labeled "From [Project]". They can add more ad-hoc rows (title, client, category, priority, estimate, expected output), remove any row.
5. Submit sign-in. Attendance row created, task rows created, linked project tasks pushed to `In Progress`.
6. Throughout the day: they open Projects, click any task title to open the full detail modal, tick off subtasks and checklist items, log actual time from their external time tracker, comment, and change status from `Planned` → `In Progress` via the pill.
7. Take a break: click **Take a break**, pick a type. Live timer starts. End break with **End break** — minutes are added to `breakMinutes` and appended to `breaks[]`.
8. When a project task is done, they use one of two paths:
   - **From Daily Task Plan** — the row has a **Submit** button for linked project tasks.
   - **From the task detail modal** — **Submit for review** button.
   Either opens the Submit for Review modal: they complete the checklist (all items required), write a summary, log time spent (h+m), attach proof (required if `proofRequired`), optionally note issues, **pick a reviewer** (default = first available manager).
9. Task locks as `Submitted`; a notification fires (in-app + webhook). If they need to add context after submitting, they can still comment.
10. End of day: click **Sign Out**. Modal opens.
11. Per-task rows: for linked project tasks the done-equivalent option is **"Done — send to review"**; `Blocked`/`Pending`/`Partially Completed`/`In Progress` also allowed. Choosing the done option runs the task's checklist/proof gates before it's accepted (§10.5). Time spent, proof, reviewer per task.
12. If any task is not "done", **explanation is required**. Blockers, issues, tomorrow's priority, final remarks all optional.
13. Submit. EOD report created (no score). Any project task marked done flows to `Submitted` on the project side. Notification fires listing the reviewer(s).

### 5.2 Manager starting a project from a template

1. Manager clicks **Project Templates** in the sidebar.
2. Sees the gallery of templates. Clicks **Start Project** on "Local SEO Monthly Campaign."
3. Wizard step 1: enters project name (defaults to "Local SEO Monthly Campaign" — they change it to "Bright Smile Dental — Aug"), picks Bright Smile Dental as the client, sets start date to Aug 1, deadline to Aug 28.
4. Wizard step 2 *(⚠️ step numbers shifted — this is step 3 in the binding 4-step wizard, §14.3.8)*: assigns real people to each role — PM = self, SEO Executive = Rima, Content Writer = Mim, QC = Nusrat, CSM = Tasnim. (Any role can be left unassigned; those tasks will be created unassigned.)
5. Preview step: reviews the table of all 10 tasks with real names, computed due dates (Day 1 → Aug 1, Day 5 → Aug 5, "3 days before deadline" → Aug 25, "after previous approved" → Aug 26), token-substituted titles (`"Prepare August report for Bright Smile Dental"`), dependency icons, QC icons (§14.3.8).
6. Click **Create Project**. All 10 tasks created with server-generated ids, dependency `template_task_id` refs resolved to real task IDs, tokens filled (via a `tplAllTasks` hierarchy walk, §13.3.2). Navigate to the new project.
7. Rima gets a notification: "5 new tasks assigned in Bright Smile Dental — Aug." Her Dashboard's "Upcoming project tasks (next 7 days)" now includes them.
8. Rima signs in the next morning; her plan is pre-populated with the tasks due today.

### 5.3 QC review flow (manager side)

1. Rima submits "Check Google Business Profile performance" from her daily plan.
2. Nusrat gets a notification. Opens **Daily Task Plan**; sees the "Submitted for your review (3)" card at the top.
3. Clicks **Review** on Rima's task. Modal opens with the full submission: checklist state (all ticked), time logged (1h 30m vs 1h 30m estimate — within), proof link (attached), summary, issues (none reported), and review history (empty).
4. Nusrat clicks the proof link, verifies the work.
5. Nusrat rates the task **4/5** stars and clicks **Approve**. Task moves to `Approved`. Notification fires to Rima; the reviewer's scorecard updates.
6. Alternate path: if Nusrat clicks **Request Revision** without a note, the modal blocks with an error. She writes "The GBP performance numbers are last month's — please pull August data" and clicks Request Revision. Task moves to `Revision Required`, revisionNote stored, review history appended. Rima gets a notification, sees the task with the **"Needs revision"** pill in Projects and in her Daily Task Plan (with the note visible in the detail modal).

### 5.4 Head of SEO auditing manager reviews

1. Jahid (Head of SEO / team_leader) opens Projects → **Manager QA** tab.
2. Reviewer scorecard shows Nusrat has done 47 reviews this month, requested revision on 3, avg rating given 4.2/5, and no meta-rating yet (12 unrated).
3. Clicks **Spot-check random review**. Row highlights: Nusrat approved Rima's "Publish August blogs" with rating 5/5 and no note.
4. Jahid opens the underlying task (via the task title link), skims the deliverable proof, comments, and decides Nusrat's 5/5 was warranted.
5. Sets the Head rating for this review to **5** in the dropdown. `reviewHistory[i].metaRating = 5, metaBy = jahid.id`. Nusrat's "Avg Head rating received" updates.

### 5.5 Attendance and break tracking through a day

1. **09:12** — Rima signs in. `attendance.signInTime = 09:12`, on-time (within 15-min grace).
2. **09:15** — starts working on her first task, pill goes to `In Progress`.
3. **12:30** — takes Lunch break. `activeBreak = { type: "Lunch break", startTime: 12:30 }`. Live timer starts on her dashboard.
4. **13:15** — ends break. Elapsed 45 min → `breaks.push({type: "Lunch break", startTime, endTime, minutes: 45}); breakMinutes = 45`.
5. **15:00** — takes Prayer break for 10 min. `breakMinutes = 55`.
6. **17:45** — signs out. Modal opens with per-task rows. She marks 2 project tasks as "Submit for review," picks Nusrat as reviewer for both; marks 1 ad-hoc task as "Completed"; leaves nothing as In Progress. No explanation needed since everything's "done."
7. The two project tasks pass their submission gates (checklist complete, proof attached) as part of the atomic sign-out transaction (§13.5.4).
8. Two project tasks flow to `Submitted` on the project side with reviewerId = Nusrat. (reviewer is a routing hint, not exclusive, §13.4.6).
9. Nusrat's Daily Task Plan review card ticks up by 2.
10. Attendance history entry created with `signIn: 09:12, signOut: 17:45, workedH: 7.75, breakMin: 55`.

---

## 6. Reports & Exports

Excel exports are generated **server-side** (§12; e.g. PUL-413, PUL-901) so the full dataset never has to reach the browser and client-safe filtering happens before anything leaves the server. Filenames follow `<name>-<period-or-range>-<YYYY-MM-DD>.xlsx`.

### 6.1 EOD reports (data model)

Each report row:

```
{ id, employeeId, date, plannedHours, actualHours,
  totalCount, completedCount,
  blockers, explanation, issuesFaced, tomorrowPriority, finalRemarks,
  computedScore, approvalStatus, managerComment,
  screenshot: "" }
```
The binding `eod_reports` shape is §11.6: no `computedScore`; acknowledgment is `reviewed_at, reviewed_by, flagged, manager_note` (no approve/reject); content columns are immutable at the database level (`REVOKE UPDATE`).

### 6.2 EOD Reports page — Weekly / Monthly Excel export

Two sheets in one workbook:

**Tasks sheet:** every daily task in the period.
Columns: Date, Employee, Task, Client, Category, Priority, Status, Estimated (h+m), Actual (h+m), Attached report/proof.

**EOD Summary sheet:** every EOD report in the period.
Columns: Date, Employee, Completed (fraction like `5/6`), Planned hrs, Actual hrs, Blockers, Explanation, Issues faced, acknowledgment state (reviewed/flagged), Manager note.

### 6.3 Client Task Excel export (from Projects filter bar)

Weekly = last 7 days by due date; Monthly = last 30. One sheet per client (only clients with tasks in the period).

Rules for inclusion: task must have `status ∈ {Completed, Approved, In Progress}`. Deliberate exclusions: Submitted, Blocked, Cancelled, Planned.

Columns (client-safe): Project, Month (with calendar month name), Task name, Category, Due date, Status (Approved relabeled "Completed"), Time spent (actualHours if set, else submission.hours), Deliverable (proof link only — never internal summary).

Deliberately **not** included: assignee, priority, internal comments, submission notes.

### 6.4 Employee Performance Excel export

From the Reports page (Weekly / Monthly / Yearly tabs).

Columns: Employee, Department, Days present, Late, Absent, On-time sign-in %, Full-shift sign-out %, Avg sign-in (HH:MM), Avg sign-out (HH:MM), Avg worked (h+m), Avg break (h+m). (Feeds §14.11's Attendance tab.)

### 6.5 Attendance History Excel export

From the Attendance History tab.

Columns: Date, Employee, Status, Sign in, Sign out, Worked (h+m), Break (h+m).

Range respects the date filters. Filename encodes the from/to dates.

### 6.6 Notifications / activity log

Not user-exported in the prototype. In production, an activity-log table should back all notifications and support CSV export for audits. In production this is the **Audit Log**: append-only, immutable at the database level, with before/after diffs on every mutation and its own page (§14.13).

---

## 7. Explicitly Out of Scope

These features **were built during prototype iteration and then explicitly removed**. Do not reintroduce them without checking with the product owner first. Each is listed with what it was and why it was removed, so the reasoning is preserved.

### 7.1 Client Portal (preview)

**What it was:** a read-only page for managers to preview what each client would see — filtered to `clientVisible: true` tasks, with statuses collapsed to Completed / In progress / Scheduled milestones, progress bar per project, and deliverable links on completed items.

**Why removed:** deferred. The `clientVisible` flag is still stored on tasks and used by the client Excel exports; a real client login is Phase 3.

### 7.2 Sign-out lock preventing "In Progress" tasks

**What it was:** at sign-out, if any task was still `In Progress`, the submit button was blocked with an error requiring the employee to explicitly resolve each task to Completed / Submit for review / Partially Completed / Pending / Blocked.

**Why removed:** felt too restrictive in practice. The current rule — **explanation required if any task is not "done"** — is what stays. Do not add the hard block back.

### 7.3 Retainer budget burn tracking

**What it was:** a `retainerValue` field on each project (asked for in the wizard), plus a role-cost-rate map (`$8/h executives up to $25/h admin`), producing a "Budget burn" column on the Projects Overview with a bar that turned amber past 75% and red past 100%.

**Why removed:** the agency didn't want internal cost economics visible in the tool. Do not reintroduce the retainer value field, the cost rate map, or the burn column.

### 7.4 Projects Overview tab

**What it was:** a tab in the Projects module showing every project at a glance — health chip, progress bar, budget burn, overdue count, next deadline, client notes.

**Why removed:** the same information is now visible per-project in the header (progress bar + health chip), and the Overview tab was competing with the Board view for the default landing spot. Client notes went away with it — if they come back, the request is to put them on the project header or as a task-area tab, not in a top-level tab.

### 7.5 Client notes panel

Removed with the Overview tab. See §7.4.

### 7.6 Auto-time-tracking / built-in stopwatch

Never built. `actualHours` is user-entered from an external tool. Do not build a Toggl-clone inside EasyGrowCrm unless explicitly asked.

---

## 8. Known Conventions and Decisions Worth Preserving

### 8.1 Collision-proof ID generation (`uid()`)

**Decision:** all in-app IDs come from a single helper:

```
let __uidCounter = 0;
function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${(++__uidCounter).toString(36)}`;
}
```

**Why:** `Date.now()` alone can (and does) repeat within the same millisecond when a template generates 10 tasks in a loop. Duplicate IDs corrupt React reconciliation (cursor jumps, wrong toggles, disappearing input fields). Timestamp + monotonic counter guarantees uniqueness for the life of the session. In production, prefer `crypto.randomUUID()` server-side and reserve `uid()` for the client only.

Prefixes in use: `e` (employee), `pt` (project task), `p` (project), `tpl` (template), `st` (subtask), `c` (comment), `n` (project note), `mt` (my-task/personal), `l` (leave), `att` (attendance), `task` (daily task), `rep` (EOD report).

### 8.2 Time as decimal hours internally, h+m at the UI edge

Times are stored as decimal hours (`1.5` = 1h 30m). `fmtHM(1.5)` → `"1h 30m"`; `HMInput` converts entered `{H, M}` back to decimal. This keeps sums (`workedH`, `openHrs`, capacity math) trivially correct while displays and inputs remain human. Never store minutes-only; never store strings.

### 8.3 `patchProjectTask` accepts a function OR object *(prototype-only pattern — see note at end)*

```
function patchProjectTask(ptId, patch) {
  setProjectTasks(prev => prev.map(p => {
    if (p.id !== ptId) return p;
    const updates = typeof patch === "function" ? patch(p) : patch;
    return { ...p, ...updates };
  }));
}
```

**Why:** the task detail modal passes functional updates (e.g. `p => ({ subtasks: [...p.subtasks, newSub] })`). A naive `{...p, ...patch}` would spread the function itself into state and crash when the next update tried to use it. Any similar patcher in the new codebase should handle both shapes. *(This is a client-state pattern for React `setState`. It doesn't map directly onto the real architecture — mutations are server actions that write to Postgres inside a transaction, not client-side patchers, §16.2. The underlying lesson — be deliberate about the shape a patch function can take, and don't let a functional update accidentally get spread as data — is still worth knowing, but there's no `patchProjectTask` equivalent to build in the real app.)*

### 8.4 Deterministic history generation

Attendance and EOD history is generated via a **seeded PRNG** (`seedRand(seed) = ((sin(seed) * 10000) mod 1)`) so that on any given browser refresh the same person has the same past. This makes demos and screenshots stable. Charts always look real without needing a giant hardcoded fixture.

In production this is replaced by real DB data; the seeding logic is prototype-only.

### 8.5 Reviewer routing

- Every submission (via the Submit modal or via sign-out) can name a specific `reviewerId`. If none is picked, the submission still queues but shows "Any manager."
- The QC queue displays who the task was sent to.
- **The chosen reviewer is not exclusive** — any manager can still review; it's a routing hint, not a lock. Deliberate, so someone who's out that day doesn't stall the queue.

### 8.7 The `StatusPillSelect` unification

Board, List, Daily Task Plan, and Task Detail all use one component with one behavior. Adding a new place that changes status? Use the same component; do not implement a parallel status control. Consistency across surfaces matters more than surface-specific customization.

### 8.8 Employees see one done option: "Done — send to review"

Employees get exactly one done-equivalent option at sign-out: **"Done — send to review,"** which routes the linked project task to `Submitted`. "Completed" is never shown to employees — it exists only as a manager's explicit QC-bypass override elsewhere, and a CI grep keeps it out of employee-facing surfaces (PUL-809). Giving employees a "Completed" option created two meanings for one word (employee: "I finished"; manager: "skipped QC"), so the affordance was kept and the word changed.

### 8.9 Individual metrics are avoided

There is no per-employee score. If any individual metric is ever introduced, the fairness rule to design in from day one is: don't penalize someone today for a QC decision that hasn't happened yet.

### 8.10 Manager QA reasoning

If nobody watches the watchers, rubber-stamped approvals happen. The Manager QA layer costs almost nothing to run (star ratings on already-visible data) and closes the loop. Even if it's used sparingly, its existence changes reviewer behavior.

### 8.11 Category color palette is authoritative

The `CATEGORY_COLOR` map (see §3.1.1 table) is the single source of truth for category colors across Board group stripes, List group headers, Calendar chips, and status-distribution bars. Add new categories to the map, not ad-hoc.

### 8.12 Status color palette matches Monday's language

Deliberate: teams that already know Monday.com recognize the palette instantly. Don't repaint (green stays `#00C875`, red stays `#E2445C`, etc.) unless a full rebranding decision is made.

### 8.13 Working days = Sun–Thu

Bangladesh convention. Every "today," "this week," "this month" filter must respect the configured `workDays` in Settings — not the browser's locale default. All date math should also respect the timezone from Settings (`Asia/Dhaka` by default), not the browser timezone, or people in different regions will see wrong "today."

### 8.14 Webhook notifications are additive, not replacing

Every in-app notification also fires to the Slack/Discord webhook. Don't route only "urgent" notifications there — the current design is that ops managers work in Slack/Discord and want everything, in-app is redundant for them. If quieting is later needed, add per-user preferences rather than filtering at the source.

### 8.15 Deliberate absence of features

Many things a full ClickUp/Monday clone has are intentionally not here:
- No time-tracking stopwatch (§7.6).
- No Kanban/board view beyond the Monday-style grouped table.
- No template editor UI beyond add/remove task (creating brand-new tasks from scratch inside the template editor is possible via the same form; a WYSIWYG rearranger was not built).
- No Gantt chart. Dependencies exist but aren't visualized as bars.
- No client login / portal.
- No profitability reporting.
- No API/webhook system beyond outbound notification webhooks.

These are Phase 2/3 candidates; do not add them silently to the MVP scope.

### 8.16 Toolchain notes carried from the prototype

- The prototype was verified with `esbuild` after each change; carry that habit into the new build pipeline (fast compile checks catch mistakes cheaply). *(The habit is preserved and formalized well beyond a compile check — §15's testing strategy, with its 31 mandatory test files (§15.4) and CI gate sequence (§15.9), is the "cheap check catches mistakes" instinct grown up.)*
- In the backend, `Date.now()` / `new Date()` are banned everywhere in `features/**`; every time read goes through the injectable clock port (`clock.now()`, §16.6), enforced by the `easygrowcrm/no-direct-date` ESLint rule (§12.5) so timing logic can be tested with frozen time.
- SheetJS (`xlsx`) is the export library; if switching to server-side generation, keep column names and file naming conventions identical so downstream users don't have to relearn. *(This prediction came true — see the §6 note above. The naming convention `<name>-<period-or-range>-<YYYY-MM-DD>.xlsx` is preserved in the binding server-side exports.)*

---

*End of §1–§8. This document is the narrative overview; the binding technical specification is §9–§17. The prototype (`easygrowcrm-prototype.html`) is a visual reference for look and layout only (Amendment A), never for behavior. Precedence: §9–§17 → this document → prototype.*
