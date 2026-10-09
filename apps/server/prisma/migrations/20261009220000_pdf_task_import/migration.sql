CREATE TABLE "crew_pdf_task_imports" (
  "id" UUID NOT NULL PRIMARY KEY,
  "crew_id" TEXT NOT NULL REFERENCES "crews"("id") ON DELETE CASCADE,
  "user_id" VARCHAR(64) NOT NULL,
  "source_hash" VARCHAR(64) NOT NULL,
  "status" VARCHAR(20) NOT NULL,
  "proposals" JSONB NOT NULL DEFAULT '{}',
  "selection" JSONB,
  "task_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL
);
CREATE INDEX "crew_pdf_task_imports_crew_id_user_id_created_at_idx" ON "crew_pdf_task_imports"("crew_id", "user_id", "created_at");
