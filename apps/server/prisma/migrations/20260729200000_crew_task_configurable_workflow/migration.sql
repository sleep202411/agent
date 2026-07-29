-- Separate the product-configurable board workflow from the stable task
-- lifecycle. A crew may add as many workflow states as it needs while
-- submission, review, revision and settlement continue to use CrewTaskStatus.

CREATE TABLE "crew_task_workflow_states" (
  "id" UUID NOT NULL,
  "crew_id" TEXT NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "color" VARCHAR(16) NOT NULL,
  "semantic" "CrewTaskStatus" NOT NULL,
  "system_key" VARCHAR(32),
  "position" INTEGER NOT NULL DEFAULT 0,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_task_workflow_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_task_workflow_states_position_check" CHECK ("position" >= 0),
  CONSTRAINT "crew_task_workflow_states_version_check" CHECK ("version" > 0),
  CONSTRAINT "crew_task_workflow_states_color_check"
    CHECK ("color" ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT "crew_task_workflow_states_system_key_check"
    CHECK (
      "system_key" IS NULL OR
      "system_key" IN (
        'open',
        'in_progress',
        'submitted',
        'revision_requested',
        'approved',
        'cancelled'
      )
    ),
  CONSTRAINT "crew_task_workflow_states_system_semantic_check"
    CHECK ("system_key" IS NULL OR "system_key" = "semantic"::text)
);

CREATE UNIQUE INDEX "crew_task_workflow_states_id_crew_unique"
  ON "crew_task_workflow_states"("id", "crew_id");
CREATE UNIQUE INDEX "crew_task_workflow_states_crew_system_key_unique"
  ON "crew_task_workflow_states"("crew_id", "system_key");
CREATE UNIQUE INDEX "crew_task_workflow_states_crew_name_unique"
  ON "crew_task_workflow_states"("crew_id", lower("name"));
CREATE INDEX "crew_task_workflow_states_crew_order_idx"
  ON "crew_task_workflow_states"("crew_id", "archived", "position", "created_at");

ALTER TABLE "crew_task_workflow_states"
  ADD CONSTRAINT "crew_task_workflow_states_crew_id_fkey"
  FOREIGN KEY ("crew_id") REFERENCES "crews"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "crew_task_workflow_states" (
  "id",
  "crew_id",
  "name",
  "color",
  "semantic",
  "system_key",
  "position",
  "created_by_user_id"
)
SELECT
  gen_random_uuid(),
  crew."id",
  defaults."name",
  defaults."color",
  defaults."semantic"::"CrewTaskStatus",
  defaults."system_key",
  defaults."position",
  crew."founder_id"
FROM "crews" AS crew
CROSS JOIN (
  VALUES
    ('To do', '#8B919B', 'open', 'open', 0),
    ('In progress', '#63A8FF', 'in_progress', 'in_progress', 1),
    ('In review', '#E9B949', 'submitted', 'submitted', 2),
    ('Changes requested', '#EF646B', 'revision_requested', 'revision_requested', 3),
    ('Completed', '#58B889', 'approved', 'approved', 4),
    ('Cancelled', '#6F7580', 'cancelled', 'cancelled', 5)
) AS defaults("name", "color", "semantic", "system_key", "position");

ALTER TABLE "crew_tasks"
  ADD COLUMN "workflow_state_id" UUID;

UPDATE "crew_tasks" AS task
SET "workflow_state_id" = workflow_state."id"
FROM "crew_task_workflow_states" AS workflow_state
WHERE workflow_state."crew_id" = task."crew_id"
  AND workflow_state."system_key" = task."status"::text;

ALTER TABLE "crew_tasks"
  ALTER COLUMN "workflow_state_id" SET NOT NULL;

CREATE INDEX "crew_tasks_crew_workflow_state_rank_idx"
  ON "crew_tasks"("crew_id", "workflow_state_id", "rank", "id");

ALTER TABLE "crew_tasks"
  ADD CONSTRAINT "crew_tasks_workflow_state_crew_fkey"
  FOREIGN KEY ("workflow_state_id", "crew_id")
  REFERENCES "crew_task_workflow_states"("id", "crew_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
