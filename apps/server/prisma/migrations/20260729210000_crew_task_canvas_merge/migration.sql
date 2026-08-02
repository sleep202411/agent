ALTER TABLE "crew_task_submissions"
  ADD COLUMN "production_version_id" UUID,
  ADD COLUMN "merged_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "crew_task_submissions_production_version_unique"
  ON "crew_task_submissions" ("production_version_id");

CREATE INDEX "crew_task_submissions_production_version_idx"
  ON "crew_task_submissions" ("production_version_id");

ALTER TABLE "crew_task_submissions"
  ADD CONSTRAINT "crew_task_submissions_production_version_fkey"
  FOREIGN KEY ("production_version_id")
  REFERENCES "platform_document_versions" ("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
