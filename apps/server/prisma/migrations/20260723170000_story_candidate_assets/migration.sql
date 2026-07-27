CREATE TABLE "story_candidate_assets" (
  "story_project_id" UUID NOT NULL,
  "media_asset_id" UUID NOT NULL,
  "added_by_user_id" VARCHAR(64) NOT NULL,
  "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_candidate_assets_pkey"
    PRIMARY KEY ("story_project_id", "media_asset_id"),
  CONSTRAINT "story_candidate_assets_story_project_id_fkey"
    FOREIGN KEY ("story_project_id")
    REFERENCES "story_projects"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "story_candidate_assets_media_asset_id_fkey"
    FOREIGN KEY ("media_asset_id")
    REFERENCES "media_assets"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX "story_candidate_assets_project_recent_idx"
  ON "story_candidate_assets"("story_project_id", "added_at" DESC);

CREATE INDEX "story_candidate_assets_media_idx"
  ON "story_candidate_assets"("media_asset_id");
