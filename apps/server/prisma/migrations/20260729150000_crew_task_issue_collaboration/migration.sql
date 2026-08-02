-- Turn CrewTask from a status record into an Issue-style collaboration
-- surface: optimistic editing plus one ordered timeline for comments,
-- attachments and immutable activity events.

ALTER TABLE "crew_tasks"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "crew_tasks"
  ADD CONSTRAINT "crew_tasks_version_check" CHECK ("version" > 0);

CREATE TABLE "crew_task_timeline_items" (
  "id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "kind" VARCHAR(64) NOT NULL,
  "actor_user_id" VARCHAR(64),
  "body" TEXT,
  "mentions" JSONB NOT NULL DEFAULT '[]',
  "payload" JSONB NOT NULL DEFAULT '{}',
  "client_key" VARCHAR(64),
  "reply_to_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "edited_at" TIMESTAMPTZ(6),
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_task_timeline_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_task_timeline_version_check" CHECK ("version" > 0),
  CONSTRAINT "crew_task_timeline_comment_body_check"
    CHECK (
      "kind" <> 'comment'
      OR "body" IS NOT NULL
      OR "deleted_at" IS NOT NULL
    )
);

CREATE INDEX "crew_task_timeline_recent_idx"
  ON "crew_task_timeline_items"("task_id", "created_at" DESC, "id" DESC);
CREATE INDEX "crew_task_timeline_reply_idx"
  ON "crew_task_timeline_items"("reply_to_id");
CREATE UNIQUE INDEX "crew_task_timeline_client_key_unique"
  ON "crew_task_timeline_items"("task_id", "actor_user_id", "client_key");

ALTER TABLE "crew_task_timeline_items"
  ADD CONSTRAINT "crew_task_timeline_items_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "crew_tasks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_task_timeline_items"
  ADD CONSTRAINT "crew_task_timeline_items_reply_to_id_fkey"
  FOREIGN KEY ("reply_to_id") REFERENCES "crew_task_timeline_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "crew_task_timeline_assets" (
  "id" UUID NOT NULL,
  "timeline_id" UUID NOT NULL,
  "asset_node_id" UUID NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "crew_task_timeline_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_task_timeline_assets_position_check" CHECK ("position" >= 0)
);

CREATE UNIQUE INDEX "crew_task_timeline_assets_unique"
  ON "crew_task_timeline_assets"("timeline_id", "asset_node_id");
CREATE UNIQUE INDEX "crew_task_timeline_assets_position_unique"
  ON "crew_task_timeline_assets"("timeline_id", "position");
CREATE INDEX "crew_task_timeline_assets_node_idx"
  ON "crew_task_timeline_assets"("asset_node_id");

ALTER TABLE "crew_task_timeline_assets"
  ADD CONSTRAINT "crew_task_timeline_assets_timeline_id_fkey"
  FOREIGN KEY ("timeline_id") REFERENCES "crew_task_timeline_items"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crew_task_timeline_assets"
  ADD CONSTRAINT "crew_task_timeline_assets_asset_node_id_fkey"
  FOREIGN KEY ("asset_node_id") REFERENCES "crew_asset_nodes"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
