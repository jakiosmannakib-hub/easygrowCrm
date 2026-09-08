-- Migration 004 in §11.9's numbering (drizzle is 0-based, so 0003 on disk) — PUL-201.
--
-- Hardening only: no schema change. The employee entity IS the Better Auth "user" table
-- (created in 0001_better_auth), so there is nothing for drizzle-kit to diff here — hence the
-- --custom migration. Functions and triggers are outside drizzle's snapshot (same as
-- 0002_audit_log), so `drizzle-kit check` stays green.
--
-- Both routines use CREATE OR REPLACE so re-running the file is harmless.

-- Invariant §9.7-5: at least two active manager-level users at all times.
-- Fires on any UPDATE that deactivates or demotes; blocks the deadlock where the
-- no-self-review rule (§9.7-1) has no eligible reviewer left.
CREATE OR REPLACE FUNCTION enforce_min_two_managers() RETURNS trigger AS $$
BEGIN
  IF (SELECT count(*) FROM "user"
      WHERE active AND role IN ('super_admin','team_leader','project_manager')
        AND id <> new.id) +
     (CASE WHEN new.active AND new.role IN ('super_admin','team_leader','project_manager')
           THEN 1 ELSE 0 END) < 2 THEN
    RAISE EXCEPTION 'operation would leave fewer than two active manager-level users';
  END IF;
  RETURN new;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS user_min_managers ON "user";
--> statement-breakpoint
CREATE TRIGGER user_min_managers BEFORE UPDATE OF active, role
  ON "user" FOR EACH ROW EXECUTE FUNCTION enforce_min_two_managers();
--> statement-breakpoint
-- Amendment E / §9.7-4 belt-and-braces: super_admin is never a task assignee.
-- The FUNCTION ONLY lands here. Its trigger (pt_no_sa_assignee) is attached in migration 008
-- (PUL-401), because project_tasks does not exist yet.
CREATE OR REPLACE FUNCTION forbid_super_admin_assignee() RETURNS trigger AS $$
BEGIN
  IF new.assignee_id IS NOT NULL AND
     (SELECT role FROM "user" WHERE id = new.assignee_id) = 'super_admin' THEN
    RAISE EXCEPTION 'super_admin cannot be a task assignee';
  END IF;
  RETURN new;
END $$ LANGUAGE plpgsql;
