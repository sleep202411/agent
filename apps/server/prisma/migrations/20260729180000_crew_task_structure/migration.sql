-- Add the structural planning layer that production work needs beyond a flat
-- issue list: subtask hierarchy, acyclic blocking edges and configurable typed
-- fields. Cross-crew links are rejected both by composite foreign keys and by
-- application validation.

CREATE TYPE "CrewTaskFieldType" AS ENUM (
  'text',
  'number',
  'single_select',
  'multi_select',
  'date',
  'checkbox',
  'user'
);

ALTER TABLE "crew_tasks"
  ADD COLUMN "parent_id" UUID;

CREATE UNIQUE INDEX "crew_tasks_id_crew_unique"
  ON "crew_tasks"("id", "crew_id");
CREATE INDEX "crew_tasks_crew_parent_rank_idx"
  ON "crew_tasks"("crew_id", "parent_id", "rank", "id");
ALTER TABLE "crew_tasks"
  ADD CONSTRAINT "crew_tasks_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "crew_tasks"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "crew_task_dependencies" (
  "crew_id" TEXT NOT NULL,
  "blocking_task_id" UUID NOT NULL,
  "blocked_task_id" UUID NOT NULL,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_task_dependencies_pkey"
    PRIMARY KEY ("blocking_task_id", "blocked_task_id"),
  CONSTRAINT "crew_task_dependencies_not_self_check"
    CHECK ("blocking_task_id" <> "blocked_task_id")
);

CREATE INDEX "crew_task_dependencies_blocked_idx"
  ON "crew_task_dependencies"("crew_id", "blocked_task_id", "created_at");
CREATE INDEX "crew_task_dependencies_blocker_idx"
  ON "crew_task_dependencies"("crew_id", "blocking_task_id", "created_at");
ALTER TABLE "crew_task_dependencies"
  ADD CONSTRAINT "crew_task_dependencies_blocking_fkey"
  FOREIGN KEY ("blocking_task_id", "crew_id")
  REFERENCES "crew_tasks"("id", "crew_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_task_dependencies"
  ADD CONSTRAINT "crew_task_dependencies_blocked_fkey"
  FOREIGN KEY ("blocked_task_id", "crew_id")
  REFERENCES "crew_tasks"("id", "crew_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "crew_task_fields" (
  "id" UUID NOT NULL,
  "crew_id" TEXT NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "description" VARCHAR(240) NOT NULL DEFAULT '',
  "type" "CrewTaskFieldType" NOT NULL,
  "options" JSONB NOT NULL DEFAULT '[]',
  "position" INTEGER NOT NULL DEFAULT 0,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_task_fields_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_task_fields_position_check" CHECK ("position" >= 0),
  CONSTRAINT "crew_task_fields_options_array_check"
    CHECK (jsonb_typeof("options") = 'array')
);

CREATE UNIQUE INDEX "crew_task_fields_id_crew_unique"
  ON "crew_task_fields"("id", "crew_id");
CREATE UNIQUE INDEX "crew_task_fields_crew_name_unique"
  ON "crew_task_fields"("crew_id", "name");
CREATE INDEX "crew_task_fields_crew_position_idx"
  ON "crew_task_fields"("crew_id", "position", "created_at");
ALTER TABLE "crew_task_fields"
  ADD CONSTRAINT "crew_task_fields_crew_id_fkey"
  FOREIGN KEY ("crew_id") REFERENCES "crews"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "crew_task_field_values" (
  "crew_id" TEXT NOT NULL,
  "task_id" UUID NOT NULL,
  "field_id" UUID NOT NULL,
  "value" JSONB NOT NULL,
  "updated_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_task_field_values_pkey" PRIMARY KEY ("task_id", "field_id"),
  CONSTRAINT "crew_task_field_values_not_json_null_check"
    CHECK ("value" <> 'null'::jsonb)
);

CREATE INDEX "crew_task_field_values_lookup_idx"
  ON "crew_task_field_values"("crew_id", "field_id", "updated_at" DESC);
ALTER TABLE "crew_task_field_values"
  ADD CONSTRAINT "crew_task_field_values_task_fkey"
  FOREIGN KEY ("task_id", "crew_id")
  REFERENCES "crew_tasks"("id", "crew_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_task_field_values"
  ADD CONSTRAINT "crew_task_field_values_field_fkey"
  FOREIGN KEY ("field_id", "crew_id")
  REFERENCES "crew_task_fields"("id", "crew_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
