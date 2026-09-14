ALTER TABLE "crew_tasks" ADD COLUMN "deleted_at" TIMESTAMPTZ(6), ADD COLUMN "deleted_by_user_id" VARCHAR(64);
CREATE INDEX "crew_tasks_active_crew_idx" ON "crew_tasks" ("crew_id", "rank", "id") WHERE "deleted_at" IS NULL;
