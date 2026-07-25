CREATE TABLE "story_production_canvases" (
    "story_project_id" UUID NOT NULL,
    "schema_version" VARCHAR(64) NOT NULL DEFAULT 'story-production-canvas-v1',
    "content" JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[],"assets":[]}',
    "updated_by_user_id" VARCHAR(64) NOT NULL,
    "updated_by_session_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_production_canvases_pkey" PRIMARY KEY ("story_project_id")
);

INSERT INTO "story_production_canvases" (
    "story_project_id",
    "updated_by_user_id"
)
SELECT
    "id",
    "created_by_user_id"
FROM "story_projects";

ALTER TABLE "story_production_canvases"
ADD CONSTRAINT "story_production_canvases_story_project_id_fkey"
FOREIGN KEY ("story_project_id")
REFERENCES "story_projects"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
