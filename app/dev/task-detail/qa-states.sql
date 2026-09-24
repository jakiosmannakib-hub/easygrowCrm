-- app/dev/task-detail/qa-states.sql — PUL-407 Stages 2–3b, shared QA fixtures (kept past PUL-409)
--
-- The §14.3.3 modal has states no fixture reaches. `tests/seed.ts` is TEST-database only
-- (`assertTestDb` refuses any DATABASE_URL whose database name lacks "test"), so it cannot
-- populate a dev database at all, and even in the test DB it has no `completed`, `cancelled` or
-- `depends_on` row.
--
-- Rather than reshape `seedMinimal` — §15.5 fixes its cast, and widening it to carry UI QA
-- states would make every DB test slower and vaguer — this arranges the missing states directly
-- in a DEV database.
--
--   docker exec -i easygrowcrm-postgres psql -U easygrowcrm -d easygrowcrm \
--     < app/dev/task-detail/qa-states.sql
--
-- DEV ONLY. It is never imported by application code and never runs in CI — it is piped by hand,
-- and it lives under app/dev/ with the page it feeds. Originally throwaway until the Board
-- (PUL-409); now KEPT as the shared QA fixture for both the isolated-modal harness and manual QA
-- of the Board — see page.tsx for why the harness stays.
--
-- ── Fully self-contained ─────────────────────────────────────────────────────────────────
-- A hand-seeded dev DB has only the super_admin from seed-admin.sql: no clients, no projects,
-- and no non-SA user. So this file CREATES ITS OWN — `qa_client`, `qa_project`, `qa_archived_project`,
-- `qa_assignee` and (PUL-412, a review-routing target) `qa_reviewer` —
-- and depends on nothing but an empty schema. It must not reference `seed_tl` / `seed_pm` /
-- `proj_seed`: those are test-DB fixtures and do not exist in dev.
--
-- ── Why a dedicated assignee ─────────────────────────────────────────────────────────────
-- `super_admin` is never a task assignee (§9.7-4, Amendment E), enforced by the
-- `pt_no_sa_assignee` trigger from migration 0006 — whose own comment calls it "the one that
-- holds when someone writes SQL by hand", which is exactly this file. An earlier version
-- assigned tasks to "the first active user", which on a fresh dev DB IS the super_admin; the
-- trigger then aborted the transaction and NO rows loaded at all. `qa_assignee` is a plain
-- `employee`, so it can hold assignments.
--
-- Inserting that user is safe: `user_min_managers` is `BEFORE UPDATE OF active, role` and does
-- not fire on INSERT, and `forbid_super_admin_assignee` only rejects SA *assignees*.
--
-- ── Idempotent ───────────────────────────────────────────────────────────────────────────
-- The cleanup block below runs FIRST, in FK-safe order, so re-running this file is clean rather
-- than a pile of duplicate-key errors. The same block is repeated as a comment at the bottom for
-- when you want the QA rows gone for good.

BEGIN;

-- ── Cleanup (also the uninstall) ─────────────────────────────────────────────────────────
-- FK-safe order: children → tasks → project → client → user. `depends_on` is a self-reference
-- on project_tasks, so it is broken first rather than relying on statement-level FK timing.
-- Children are matched by `task_id`, so a child from an older revision of this file is removed
-- even if its own id prefix has since changed.
-- task_reviews → task_submissions come first: both reference project_tasks AND "user"
-- (submitted_by, reviewer_id), so they must go before either.
DELETE FROM task_reviews         WHERE task_id LIKE 'qa%';
DELETE FROM task_submissions     WHERE task_id LIKE 'qa%';
DELETE FROM task_comments        WHERE task_id LIKE 'qa%';
DELETE FROM task_subtasks        WHERE task_id LIKE 'qa%';
DELETE FROM task_checklist_items WHERE task_id LIKE 'qa%';
UPDATE project_tasks SET depends_on = NULL WHERE id LIKE 'qa%';
DELETE FROM project_tasks        WHERE id LIKE 'qa%';
DELETE FROM projects             WHERE id IN ('qa_project', 'qa_archived_project');
DELETE FROM clients              WHERE id = 'qa_client';
DELETE FROM "user"               WHERE id IN ('qa_assignee', 'qa_reviewer');

-- ── The cast ─────────────────────────────────────────────────────────────────────────────

-- A plain employee, so it is a legal assignee. `email_verified` true and `active` true so it
-- looks like a provisioned account; the name is what the modal header renders next to the
-- avatar (initials fallback — this account has no Google image, which is the normal case).
INSERT INTO "user" (id, name, email, email_verified, role, active)
VALUES ('qa_assignee', 'QA Assignee', 'qa_assignee@test.local', true, 'employee', true);

-- A second manager, ONLY as a review-routing target (PUL-412): the Review tab's "Routed to me"
-- chip needs a submission routed to SOMEONE ELSE to prove it filters. A project_manager because
-- routing hints name managers. Safe to insert and delete: `user_min_managers` is
-- `BEFORE UPDATE OF active, role` — it fires on neither INSERT nor DELETE.
INSERT INTO "user" (id, name, email, email_verified, role, active)
VALUES ('qa_reviewer', 'QA Reviewer', 'qa_reviewer@test.local', true, 'project_manager', true);

INSERT INTO clients (id, name) VALUES ('qa_client', 'QA Client');

-- `created_by` accepts a super_admin, so it takes whatever active user already exists — falling
-- back to `qa_assignee` so this file also loads against a COMPLETELY empty database.
CREATE TEMP TABLE qa_ctx ON COMMIT DROP AS
SELECT COALESCE(
  (SELECT id FROM "user"
   WHERE active AND id NOT IN ('qa_assignee', 'qa_reviewer')
   ORDER BY created_at LIMIT 1),
  'qa_assignee'
) AS actor_id;

INSERT INTO projects (id, client_id, name, type, status, start_date, deadline, created_by)
SELECT 'qa_project', 'qa_client', 'QA Project', 'Retainer', 'active',
       CURRENT_DATE - 30, CURRENT_DATE + 60, ctx.actor_id
FROM qa_ctx ctx;

-- ── The tasks ────────────────────────────────────────────────────────────────────────────
-- `assignee_id` is `qa_assignee` where the header should render a person, and NULL where the
-- "Unassigned" state is the point. Never the super_admin, per the trigger above.

INSERT INTO project_tasks
  (id, project_id, month, category, title, description, assignee_id, due_date,
   status, priority, actual_hours, expected_output, sop_url, created_by)
SELECT * FROM (
  SELECT
    'qa_completed' AS id, 'qa_project' AS project_id, 1 AS month, 'QA' AS category,
    'QA — Completed (manager-closed)' AS title,
    'Renders the "Done" pill with NO icon — the QC-bypass status.' AS description,
    'qa_assignee' AS assignee_id, CURRENT_DATE AS due_date,
    'completed'::task_status AS status, 'medium'::task_priority AS priority,
    2.5 AS actual_hours, 'A closed task' AS expected_output, NULL AS sop_url,
    ctx.actor_id AS created_by
  FROM qa_ctx ctx
  UNION ALL
  SELECT
    'qa_approved', 'qa_project', 1, 'QA', 'QA — Approved (QC passed)',
    'Renders "Done ✓" WITH the check-shield icon. The icon is the only difference from Completed.',
    'qa_assignee', CURRENT_DATE, 'approved', 'high', 3.25, 'An approved task',
    'https://example.com/sop', ctx.actor_id
  FROM qa_ctx ctx
  UNION ALL
  -- Unassigned AND no month, so the header must omit "Month N" entirely.
  SELECT
    'qa_cancelled', 'qa_project', NULL, 'QA', 'QA — Cancelled (no month ⇒ no "Month N")',
    NULL, NULL, NULL, 'cancelled', 'low', NULL, NULL, NULL, ctx.actor_id
  FROM qa_ctx ctx
  UNION ALL
  -- The blocker: deliberately NOT approved/completed, so the downstream pill locks.
  SELECT
    'qa_blocker', 'qa_project', 2, 'QA', 'QA — Upstream blocker (in progress)',
    NULL, 'qa_assignee', CURRENT_DATE + 3, 'in_progress', 'urgent', 1.0, NULL, NULL, ctx.actor_id
  FROM qa_ctx ctx
) rows;

-- The dependency-blocked case: its own status is `planned`, but the pill must render Blocked
-- with a lock icon and a tooltip naming `qa_blocker` (§14.3.2, §3.2.5). Unassigned as well, so
-- one task covers both the dependency lock and a second "Unassigned" render. Overdue due date,
-- so `fmtDate` shows its `· Overdue` suffix.
INSERT INTO project_tasks
  (id, project_id, month, category, title, description, assignee_id, due_date,
   status, priority, depends_on, created_by)
SELECT
  'qa_dependent', 'qa_project', 2, 'QA', 'QA — Dependency blocked (stored status: planned)',
  'Pill must show BLOCKED + lock icon + "Blocked by: QA — Upstream blocker (in progress)".',
  NULL, CURRENT_DATE - 2, 'planned', 'medium', 'qa_blocker', ctx.actor_id
FROM qa_ctx ctx;

-- The `submitted` lock banner, assigned — the realistic combination.
INSERT INTO project_tasks
  (id, project_id, month, category, title, description, assignee_id, due_date,
   status, priority, actual_hours, created_by)
SELECT
  'qa_submitted', 'qa_project', 1, 'QA', 'QA — Submitted (lock banner)',
  'Banner: "Awaiting review — checklist, subtasks and hours are locked. Comments stay open."',
  'qa_assignee', CURRENT_DATE, 'submitted', 'high', 4.5, ctx.actor_id
FROM qa_ctx ctx;

-- ── The archived project (PUL-407 Stage 3b) ──────────────────────────────────────────────
-- Archived is read-only EVERYWHERE and for EVERY role, managers included (§13.3.4,
-- `guardProjectNotArchived`). It is the one state that closes the comment box too, because
-- `addComment`'s only guard is that same check — so this task is how you QA the hardest branch
-- of `taskCapabilities`: all four booleans false even for a super_admin.
--
-- Its task is `in_progress` and ASSIGNED, deliberately: without the archive it would be fully
-- editable, so anything still interactive on it is a bug rather than a status effect.
INSERT INTO projects (id, client_id, name, type, status, start_date, deadline, created_by)
SELECT 'qa_archived_project', 'qa_client', 'QA Project (archived)', 'Retainer', 'archived',
       CURRENT_DATE - 120, CURRENT_DATE - 10, ctx.actor_id
FROM qa_ctx ctx;

INSERT INTO project_tasks
  (id, project_id, month, category, title, description, assignee_id, due_date,
   status, priority, actual_hours, created_by)
SELECT
  'qa_archived_task', 'qa_archived_project', 1, 'QA', 'QA — Archived project (all read-only)',
  'Everything must be read-only, for every role: no checklist toggle, no subtask edits, no × , and the comment box replaced by "This project is archived — commenting is closed."',
  'qa_assignee', CURRENT_DATE - 5, 'in_progress', 'medium', 1.5, ctx.actor_id
FROM qa_ctx ctx;

-- Children on the archived task too, so there is something visibly frozen rather than an empty
-- section that proves nothing.
INSERT INTO task_checklist_items (id, task_id, text, done, position)
VALUES
  ('qac_a1', 'qa_archived_task', 'Done before the archive',   true,  1),
  ('qac_a2', 'qa_archived_task', 'Never finished',            false, 2);

INSERT INTO task_subtasks (id, task_id, text, done, position, created_by)
SELECT 'qas_a1', 'qa_archived_task', 'Frozen subtask', false, 1, ctx.actor_id FROM qa_ctx ctx;

INSERT INTO task_comments (id, task_id, author_id, body, created_at)
SELECT 'qacm_a1', 'qa_archived_task', ctx.actor_id,
       'Archiving this — nothing further needed.', now() - interval '3 days'
FROM qa_ctx ctx;

-- ── Children ─────────────────────────────────────────────────────────────────────────────
-- So the (done/total) counts AND the empty states are both exercised: qa_submitted gets a
-- part-done checklist and subtasks; every other task deliberately gets none.
--
-- Note the asymmetry, which is §11.3.1's, not a mistake here: `task_subtasks` carries
-- `created_by` (per-item authorship) and `task_checklist_items` does not (the checklist comes
-- from the template or the manager who owns the gate). Neither child table has `updated_at`.
INSERT INTO task_checklist_items (id, task_id, text, done, position)
VALUES
  ('qac_1', 'qa_submitted', 'Draft written',        true,  1),
  ('qac_2', 'qa_submitted', 'Keywords mapped',      true,  2),
  ('qac_3', 'qa_submitted', 'Internal links added', false, 3);

INSERT INTO task_subtasks (id, task_id, text, done, position, created_by)
SELECT 'qas_1', 'qa_submitted', 'Outline', true, 1, ctx.actor_id FROM qa_ctx ctx
UNION ALL
SELECT 'qas_2', 'qa_submitted', 'First pass', false, 2, ctx.actor_id FROM qa_ctx ctx;

-- Comments, so the thread renders rather than only its empty state. Comments never lock, even
-- at `submitted` (§3.2.3) — which is exactly what the lock banner promises. Two authors, so the
-- thread shows both the assignee and a manager.
INSERT INTO task_comments (id, task_id, author_id, body, created_at)
SELECT 'qacm_1', 'qa_submitted', 'qa_assignee',
       'Sent this over for review — the last checklist item is blocked on the link sheet.',
       now() - interval '2 hours'
UNION ALL
SELECT 'qacm_2', 'qa_submitted', ctx.actor_id,
       'Noted, picking it up this afternoon.', now() - interval '20 minutes'
FROM qa_ctx ctx;

-- ── The review queue (PUL-412) ───────────────────────────────────────────────────────────
-- `getReviewQueue` joins each `submitted` task to its LATEST `task_submissions` row; with no
-- submission row a submitted task is not in the queue at all. So:
--
--   qa_submitted   — TWO submissions (the revision loop). The OLD one routed to qa_reviewer;
--                    the LATEST routed to YOU (the actor — the account you QA as). It therefore
--                    appears under "Routed to me", and its summary / hours / proof are the
--                    latest's, which proves "latest submission wins".
--   qa_submitted_2 — a second submitted task routed to qa_reviewer ONLY, so it appears in the
--                    full queue but NOT under "Routed to me".
--
-- Expected Review tab: 2 rows; "Routed to me" → 1 row (qa_submitted).
--
-- `reviewer_not_submitter` forbids routing a submission to its own submitter. On a completely
-- empty DB the actor falls back to qa_assignee — the submitter — so the latest routing uses
-- NULLIF and degrades to "unrouted" rather than aborting the whole file.
INSERT INTO project_tasks
  (id, project_id, month, category, title, description, assignee_id, due_date,
   status, priority, estimated_hours, created_by)
SELECT
  'qa_submitted_2', 'qa_project', 1, 'QA', 'QA — Submitted, routed to QA Reviewer',
  'In the Review tab''s full queue, NOT under "Routed to me" (routed to QA Reviewer).',
  'qa_assignee', CURRENT_DATE + 1, 'submitted', 'medium', 2.0, ctx.actor_id
FROM qa_ctx ctx;

INSERT INTO task_submissions
  (id, task_id, submitted_by, summary, hours, issues, proof_type, proof_value, reviewer_id,
   created_at)
SELECT 'qasub_1_old', 'qa_submitted', 'qa_assignee',
       'First pass — superseded by the resubmission.', 3.0, NULL,
       -- Cast in the FIRST union branch: otherwise the column resolves as text and the enum
       -- insert fails (same reason as the task inserts above).
       'url'::proof_type, 'https://example.com/proof/old', 'qa_reviewer', now() - interval '1 day'
UNION ALL
SELECT 'qasub_1_new', 'qa_submitted', 'qa_assignee',
       'Resubmitted with the internal links fixed and the keyword map attached.', 4.5,
       'The link sheet is still missing two URLs.',
       'google_doc', 'https://docs.google.com/document/d/qa-proof', NULLIF(ctx.actor_id, 'qa_assignee'),
       now() - interval '2 hours'
FROM qa_ctx ctx
UNION ALL
SELECT 'qasub_2', 'qa_submitted_2', 'qa_assignee',
       'Audit complete — findings in the sheet.', 1.75, NULL,
       'url', 'https://example.com/proof/audit', 'qa_reviewer', now() - interval '5 hours';

COMMIT;

-- ── Uninstall ────────────────────────────────────────────────────────────────────────────
--   BEGIN;
--   DELETE FROM task_reviews         WHERE task_id LIKE 'qa%';
--   DELETE FROM task_submissions     WHERE task_id LIKE 'qa%';
--   DELETE FROM task_comments        WHERE task_id LIKE 'qa%';
--   DELETE FROM task_subtasks        WHERE task_id LIKE 'qa%';
--   DELETE FROM task_checklist_items WHERE task_id LIKE 'qa%';
--   UPDATE project_tasks SET depends_on = NULL WHERE id LIKE 'qa%';
--   DELETE FROM project_tasks        WHERE id LIKE 'qa%';
--   DELETE FROM projects             WHERE id IN ('qa_project', 'qa_archived_project');
--   DELETE FROM clients              WHERE id = 'qa_client';
--   DELETE FROM "user"               WHERE id IN ('qa_assignee', 'qa_reviewer');
--   COMMIT;
