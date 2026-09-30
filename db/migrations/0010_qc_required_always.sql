-- 0010_qc_required_always: PUL-416.4, Amendment M
--
-- Every task closes through review, so QA is never optional. Backfills any `qc_required = false`
-- row to true on both tables, then adds a CHECK so `false` can never be written again. The
-- column itself stays: the row shape is stable and old exports keep reading it.
--
-- No audit row, by ruling at PUL-416: this is a schema migration, not an actor's mutation, and
-- `audit_log.actor_id` is a foreign key to a real user. The row counts are reported with
-- RAISE NOTICE instead, so whoever runs the migration sees what it changed.
--
-- `version` and `updated_at` are deliberately NOT bumped: no human edited these tasks, and a
-- stale form can no longer send `false` back (the actions refuse it), so there is no lost
-- update for the optimistic lock to catch.
--
-- Hand-written around the drizzle-kit output (the two ADD CONSTRAINT statements);
-- `meta/0010_snapshot.json` is the generated final state.
--
-- RE-RUNNABLE: the backfill is idempotent (a second run updates 0 rows) and each constraint is
-- added only when missing, so running this whole file twice is a no-op.

DO $$
DECLARE
	n integer;
BEGIN
	UPDATE "project_tasks" SET "qc_required" = true WHERE "qc_required" = false;
	GET DIAGNOSTICS n = ROW_COUNT;
	RAISE NOTICE '0010_qc_required_always: project_tasks backfilled % row(s) to qc_required = true', n;

	UPDATE "template_tasks" SET "qc_required" = true WHERE "qc_required" = false;
	GET DIAGNOSTICS n = ROW_COUNT;
	RAISE NOTICE '0010_qc_required_always: template_tasks backfilled % row(s) to qc_required = true', n;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_tasks_qc_required_check') THEN
		ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_qc_required_check" CHECK ("project_tasks"."qc_required" = true);
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_tasks_qc_required_check') THEN
		ALTER TABLE "template_tasks" ADD CONSTRAINT "template_tasks_qc_required_check" CHECK ("template_tasks"."qc_required" = true);
	END IF;
END $$;
