CREATE TYPE "CrewProductionKind" AS ENUM ('interactive_film', 'series');
CREATE TYPE "CrewTaskKind" AS ENUM (
  'script',
  'gameplay',
  'plot_tree',
  'art',
  'storyboard',
  'voice',
  'music',
  'edit',
  'qa',
  'other'
);

ALTER TABLE "crews"
ADD COLUMN "production_kind" "CrewProductionKind" NOT NULL DEFAULT 'series';

ALTER TABLE "crew_asset_nodes"
ADD COLUMN "folder_key" VARCHAR(64),
ADD COLUMN "linked_studio_media_asset_id" UUID,
ADD COLUMN "linked_project_id" UUID,
ADD COLUMN "linked_story_project_id" UUID;

CREATE UNIQUE INDEX "crew_asset_nodes_folder_key_unique"
ON "crew_asset_nodes" ("crew_id", "folder_key");

CREATE INDEX "crew_asset_nodes_linked_studio_media_idx"
ON "crew_asset_nodes" ("linked_studio_media_asset_id");

ALTER TABLE "crew_asset_nodes"
ADD CONSTRAINT "crew_asset_nodes_linked_studio_media_fkey"
FOREIGN KEY ("linked_studio_media_asset_id") REFERENCES "media_assets"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "crew_asset_nodes"
ADD CONSTRAINT "crew_asset_nodes_linked_project_fkey"
FOREIGN KEY ("linked_project_id") REFERENCES "platform_projects"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "crew_asset_nodes"
ADD CONSTRAINT "crew_asset_nodes_linked_story_project_fkey"
FOREIGN KEY ("linked_story_project_id") REFERENCES "story_projects"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "crew_tasks"
ADD COLUMN "task_kind" "CrewTaskKind";

CREATE INDEX "crew_tasks_crew_kind_idx"
ON "crew_tasks" ("crew_id", "task_kind");

CREATE TABLE "crew_task_kind_templates" (
  "id" UUID NOT NULL,
  "crew_id" TEXT NOT NULL,
  "kind" "CrewTaskKind" NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_task_kind_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "crew_task_kind_templates_crew_kind_idx"
ON "crew_task_kind_templates" ("crew_id", "kind");

ALTER TABLE "crew_task_kind_templates"
ADD CONSTRAINT "crew_task_kind_templates_crew_fkey"
FOREIGN KEY ("crew_id") REFERENCES "crews"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
