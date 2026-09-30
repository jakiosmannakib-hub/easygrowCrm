-- 0009_accounts — PUL-414, Amendment M, §11.2 (§11.9 logical 010a)
--
-- Client › Account › Project. Adds `accounts`, replaces `projects.client_id` with
-- `projects.account_id`, and backfills one account per existing client (same name, same
-- timestamps, same archived state) so every existing project keeps its client.
--
-- Hand-written from two drizzle-kit generations (add, then drop) so the column swap never
-- went through drizzle-kit's interactive rename prompt; `meta/0009_snapshot.json` is the final
-- state and `drizzle-kit generate` reports no changes against it.
--
-- RE-RUNNABLE: every statement is guarded, so running this whole file a second time is a no-op.
-- The backfill runs only while `projects.client_id` still exists, and backfilled ids are
-- deterministic (`acc_` || client id), so a re-run cannot duplicate an account.

CREATE TABLE IF NOT EXISTS "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"website" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_client_id_clients_id_fk') THEN
		ALTER TABLE "accounts" ADD CONSTRAINT "accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_client_idx" ON "accounts" USING btree ("client_id") WHERE "accounts"."deleted_at" is null;
--> statement-breakpoint
-- Nullable until the backfill has filled it.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "account_id" text;
--> statement-breakpoint
-- The backfill. EXECUTE keeps `client_id` out of the plan, so the block still parses and runs
-- on a re-run after the column is gone.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'client_id'
	) THEN
		EXECUTE $sql$
			INSERT INTO "accounts" ("id", "client_id", "name", "created_at", "updated_at", "deleted_at")
			SELECT 'acc_' || c."id", c."id", c."name", c."created_at", c."updated_at", c."deleted_at"
			FROM "clients" c
			ON CONFLICT ("id") DO NOTHING
		$sql$;
		EXECUTE $sql$
			UPDATE "projects" SET "account_id" = 'acc_' || "client_id" WHERE "account_id" IS NULL
		$sql$;
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "account_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_account_id_accounts_id_fk') THEN
		ALTER TABLE "projects" ADD CONSTRAINT "projects_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_account_idx" ON "projects" USING btree ("account_id") WHERE "projects"."deleted_at" is null;
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_client_id_clients_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "projects_client_idx";
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "client_id";
