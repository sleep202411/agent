-- Evolve CrewTask into the work-item layer of a Notion/GitHub-Projects style
-- production planner. Existing Issue conversations and submissions remain
-- intact; planning views, cycles, labels, ordering and stable issue numbers
-- are added around them.

CREATE TYPE "CrewTaskViewLayout" AS ENUM ('table', 'board', 'calendar', 'timeline');
CREATE TYPE "CrewTaskViewScope" AS ENUM ('backlog', 'active', 'review', 'completed', 'all');
CREATE TYPE "CrewTaskCycleStatus" AS ENUM ('planned', 'active', 'completed', 'cancelled');

ALTER TABLE "crew_tasks"
  ADD COLUMN "number" INTEGER,
  ADD COLUMN "start_at" TIMESTAMPTZ(6),
  ADD COLUMN "estimate_points" INTEGER,
  ADD COLUMN "cycle_id" UUID,
  ADD COLUMN "rank" DECIMAL(36,18) NOT NULL DEFAULT 1024;

WITH numbered AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "crew_id"
      ORDER BY "created_at", "id"
    ) AS "crew_number"
  FROM "crew_tasks"
)
UPDATE "crew_tasks" AS task
SET
  "number" = numbered."crew_number",
  "rank" = numbered."crew_number" * 1024
FROM numbered
WHERE task."id" = numbered."id";

ALTER TABLE "crew_tasks"
  ALTER COLUMN "number" SET NOT NULL,
  ADD CONSTRAINT "crew_tasks_number_check" CHECK ("number" > 0),
  ADD CONSTRAINT "crew_tasks_estimate_points_check"
    CHECK ("estimate_points" IS NULL OR "estimate_points" >= 0),
  ADD CONSTRAINT "crew_tasks_rank_check" CHECK ("rank" >= 0);

CREATE UNIQUE INDEX "crew_tasks_crew_number_unique"
  ON "crew_tasks"("crew_id", "number");
CREATE INDEX "crew_tasks_crew_rank_idx"
  ON "crew_tasks"("crew_id", "rank", "id");
CREATE INDEX "crew_tasks_crew_cycle_rank_idx"
  ON "crew_tasks"("crew_id", "cycle_id", "rank", "id");

CREATE TABLE "crew_task_views" (
  "id" UUID NOT NULL,
  "crew_id" TEXT NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "layout" "CrewTaskViewLayout" NOT NULL,
  "scope" "CrewTaskViewScope" NOT NULL DEFAULT 'all',
  "group_by" VARCHAR(32),
  "filters" JSONB NOT NULL DEFAULT '{}',
  "sorts" JSONB NOT NULL DEFAULT '[]',
  "visible_fields" JSONB NOT NULL DEFAULT '[]',
  "position" INTEGER NOT NULL DEFAULT 0,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_task_views_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_task_views_position_check" CHECK ("position" >= 0)
);

CREATE UNIQUE INDEX "crew_task_views_crew_name_unique"
  ON "crew_task_views"("crew_id", "name");
CREATE INDEX "crew_task_views_crew_position_idx"
  ON "crew_task_views"("crew_id", "position", "created_at");
ALTER TABLE "crew_task_views"
  ADD CONSTRAINT "crew_task_views_crew_id_fkey"
  FOREIGN KEY ("crew_id") REFERENCES "crews"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "crew_task_cycles" (
  "id" UUID NOT NULL,
  "crew_id" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "goal" TEXT NOT NULL DEFAULT '',
  "status" "CrewTaskCycleStatus" NOT NULL DEFAULT 'planned',
  "start_at" TIMESTAMPTZ(6) NOT NULL,
  "end_at" TIMESTAMPTZ(6) NOT NULL,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_task_cycles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_task_cycles_number_check" CHECK ("number" > 0),
  CONSTRAINT "crew_task_cycles_dates_check" CHECK ("end_at" > "start_at")
);

CREATE UNIQUE INDEX "crew_task_cycles_crew_number_unique"
  ON "crew_task_cycles"("crew_id", "number");
CREATE INDEX "crew_task_cycles_crew_status_idx"
  ON "crew_task_cycles"("crew_id", "status", "start_at", "end_at");
ALTER TABLE "crew_task_cycles"
  ADD CONSTRAINT "crew_task_cycles_crew_id_fkey"
  FOREIGN KEY ("crew_id") REFERENCES "crews"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_tasks"
  ADD CONSTRAINT "crew_tasks_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "crew_task_cycles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "crew_task_labels" (
  "id" UUID NOT NULL,
  "crew_id" TEXT NOT NULL,
  "name" VARCHAR(64) NOT NULL,
  "color" VARCHAR(16) NOT NULL,
  "description" VARCHAR(240) NOT NULL DEFAULT '',
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_task_labels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crew_task_labels_crew_name_unique"
  ON "crew_task_labels"("crew_id", "name");
CREATE INDEX "crew_task_labels_crew_created_idx"
  ON "crew_task_labels"("crew_id", "created_at");
ALTER TABLE "crew_task_labels"
  ADD CONSTRAINT "crew_task_labels_crew_id_fkey"
  FOREIGN KEY ("crew_id") REFERENCES "crews"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "crew_task_label_assignments" (
  "task_id" UUID NOT NULL,
  "label_id" UUID NOT NULL,
  CONSTRAINT "crew_task_label_assignments_pkey" PRIMARY KEY ("task_id", "label_id")
);

CREATE INDEX "crew_task_label_assignments_label_idx"
  ON "crew_task_label_assignments"("label_id", "task_id");
ALTER TABLE "crew_task_label_assignments"
  ADD CONSTRAINT "crew_task_label_assignments_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "crew_tasks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_task_label_assignments"
  ADD CONSTRAINT "crew_task_label_assignments_label_id_fkey"
  FOREIGN KEY ("label_id") REFERENCES "crew_task_labels"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
