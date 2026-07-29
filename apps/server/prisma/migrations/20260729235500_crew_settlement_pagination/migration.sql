-- Settlement rows are always queried as a crew finance ledger. Keep the crew
-- identity on the row instead of forcing every page/count through a task join.
ALTER TABLE "crew_settlement_items"
  ADD COLUMN "crew_id" VARCHAR;

UPDATE "crew_settlement_items" AS settlement
SET "crew_id" = task."crew_id"
FROM "crew_tasks" AS task
WHERE task."id" = settlement."task_id";

ALTER TABLE "crew_settlement_items"
  ALTER COLUMN "crew_id" SET NOT NULL,
  ADD CONSTRAINT "crew_settlement_items_crew_id_fkey"
    FOREIGN KEY ("crew_id") REFERENCES "crews"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "crew_settlement_items_crew_status_created_idx"
  ON "crew_settlement_items" (
    "crew_id",
    "status",
    "created_at" DESC,
    "id" DESC
  );
