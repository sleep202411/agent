-- Persist creator-owned Story Studio canvas coordinates independently from
-- canonical story content. The composite tenant key prevents a layout from
-- ever being attached to a project in another workspace.

CREATE TABLE "story_canvas_layouts" (
  "story_project_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "schema_version" VARCHAR(64) NOT NULL DEFAULT 'story-canvas-layout-v1',
  "node_positions" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updated_by_user_id" VARCHAR(64) NOT NULL,
  "updated_by_session_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_canvas_layouts_pkey"
    PRIMARY KEY ("story_project_id", "workspace_id"),
  CONSTRAINT "story_canvas_layouts_project_workspace_fkey"
    FOREIGN KEY ("story_project_id", "workspace_id")
    REFERENCES "story_projects" ("id", "workspace_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "story_canvas_layouts_schema_nonempty_chk"
    CHECK (btrim("schema_version") <> ''),
  CONSTRAINT "story_canvas_layouts_positions_object_chk"
    CHECK (jsonb_typeof("node_positions") = 'object'),
  CONSTRAINT "story_canvas_layouts_revision_chk"
    CHECK ("revision" >= 0)
);

CREATE INDEX "story_canvas_layouts_workspace_recent_idx"
  ON "story_canvas_layouts" ("workspace_id", "updated_at" DESC);

-- Product Story Projects created before this migration receive an empty but
-- fully valid canvas layout. Their creator is the most accurate provenance
-- available for the initial persisted projection.
INSERT INTO "story_canvas_layouts" (
  "story_project_id",
  "workspace_id",
  "schema_version",
  "node_positions",
  "revision",
  "updated_by_user_id",
  "updated_by_session_id",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  "workspace_id",
  'story-canvas-layout-v1',
  '{}'::JSONB,
  0,
  "created_by_user_id",
  NULL,
  "created_at",
  CURRENT_TIMESTAMP
FROM "story_projects";
