ALTER TABLE "crew_production_pages"
  ADD COLUMN "start_date" DATE,
  ADD CONSTRAINT "crew_production_pages_date_order"
    CHECK (
      "start_date" IS NULL OR
      "target_date" IS NULL OR
      "target_date" >= "start_date"
    );

CREATE TABLE "crew_production_label_assignments" (
  "crew_id" TEXT NOT NULL,
  "label_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_production_label_assignments_pkey"
    PRIMARY KEY ("crew_id", "label_id"),
  CONSTRAINT "crew_production_label_assignments_crew_id_fkey"
    FOREIGN KEY ("crew_id") REFERENCES "crew_production_pages"("crew_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "crew_production_label_assignments_label_id_fkey"
    FOREIGN KEY ("label_id") REFERENCES "crew_task_labels"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "crew_production_label_assignments_label_idx"
  ON "crew_production_label_assignments"("label_id", "crew_id");
