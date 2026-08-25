-- Chapter-scoped Story production specifications.
--
-- These tables deliberately contain prompts, timings and stable logical
-- references only. They never create paid generation jobs and never reuse the
-- project-scoped StoryReferenceSlot / StoryVideoSelection compatibility path.

CREATE TYPE "StoryProductionSpecStatus" AS ENUM ('current', 'stale', 'archived');
CREATE TYPE "StoryAssetSpecKind" AS ENUM ('character', 'location', 'prop', 'graphic', 'style');
CREATE TYPE "StoryStoryboardClipKind" AS ENUM ('image', 'video');
CREATE TYPE "StoryStoryboardBindingMode" AS ENUM ('follow_selected', 'pinned');
CREATE TYPE "StoryStoryboardCueKind" AS ENUM ('decision', 'interaction', 'dialogue', 'audio', 'overlay');

CREATE TABLE "story_asset_specs" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "story_chapter_id" UUID NOT NULL,
  "stable_key" VARCHAR(120) NOT NULL,
  "kind" "StoryAssetSpecKind" NOT NULL,
  "source_character_id" VARCHAR(120),
  "source_node_ids" JSONB NOT NULL,
  "name" VARCHAR(240) NOT NULL,
  "description" TEXT,
  "image_prompt" TEXT NOT NULL,
  "video_prompt" TEXT,
  "negative_prompt" TEXT,
  "generation_config" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "source_fingerprint" VARCHAR(64) NOT NULL,
  "pending_source_fingerprint" VARCHAR(64),
  "status" "StoryProductionSpecStatus" NOT NULL DEFAULT 'current',
  "version" INTEGER NOT NULL DEFAULT 0,
  "selected_media_version_id" UUID,
  "user_modified_at" TIMESTAMPTZ(6),
  "user_modified_by_user_id" VARCHAR(64),
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "last_planned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_asset_specs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_asset_specs_stable_key_chk"
    CHECK ("stable_key" ~ '^[A-Za-z][A-Za-z0-9._:-]{0,119}$'),
  CONSTRAINT "story_asset_specs_character_source_chk" CHECK (
    ("kind" = 'character' AND "source_character_id" IS NOT NULL)
    OR ("kind" <> 'character' AND "source_character_id" IS NULL)
  ),
  CONSTRAINT "story_asset_specs_source_nodes_chk"
    CHECK (jsonb_typeof("source_node_ids") = 'array' AND jsonb_array_length("source_node_ids") > 0),
  CONSTRAINT "story_asset_specs_nonempty_chk" CHECK (
    btrim("name") <> '' AND btrim("image_prompt") <> ''
  ),
  CONSTRAINT "story_asset_specs_generation_config_chk"
    CHECK (jsonb_typeof("generation_config") = 'object'),
  CONSTRAINT "story_asset_specs_fingerprints_chk" CHECK (
    "source_fingerprint" ~ '^[0-9a-f]{64}$'
    AND ("pending_source_fingerprint" IS NULL OR "pending_source_fingerprint" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "story_asset_specs_version_chk" CHECK ("version" >= 0),
  CONSTRAINT "story_asset_specs_user_modified_chk" CHECK (
    ("user_modified_at" IS NULL AND "user_modified_by_user_id" IS NULL)
    OR ("user_modified_at" IS NOT NULL AND btrim("user_modified_by_user_id") <> '')
  ),
  CONSTRAINT "story_asset_specs_stale_shape_chk" CHECK (
    ("status" = 'stale' AND "pending_source_fingerprint" IS NOT NULL)
    OR ("status" <> 'stale' AND "pending_source_fingerprint" IS NULL)
  )
);

CREATE UNIQUE INDEX "story_asset_specs_chapter_key_unique"
  ON "story_asset_specs" ("story_chapter_id", "stable_key");
CREATE UNIQUE INDEX "story_asset_specs_scope_unique"
  ON "story_asset_specs" ("id", "story_chapter_id", "story_project_id");
CREATE UNIQUE INDEX "story_asset_specs_selected_version_scope_unique"
  ON "story_asset_specs" ("selected_media_version_id", "id", "story_chapter_id", "story_project_id");
CREATE INDEX "story_asset_specs_chapter_kind_status_idx"
  ON "story_asset_specs" ("story_project_id", "story_chapter_id", "kind", "status");

ALTER TABLE "story_asset_specs"
  ADD CONSTRAINT "story_asset_specs_project_fkey"
    FOREIGN KEY ("story_project_id") REFERENCES "story_projects" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_asset_specs_chapter_scope_fkey"
    FOREIGN KEY ("story_chapter_id", "story_project_id")
    REFERENCES "story_chapters" ("id", "story_project_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "story_asset_media_versions" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "story_chapter_id" UUID NOT NULL,
  "asset_spec_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "media_asset_id" UUID NOT NULL,
  "preferred_variant_id" UUID,
  "source_fingerprint" VARCHAR(64) NOT NULL,
  "generation_snapshot" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_asset_media_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_asset_media_versions_number_chk" CHECK ("version_number" > 0),
  CONSTRAINT "story_asset_media_versions_fingerprint_chk"
    CHECK ("source_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "story_asset_media_versions_snapshot_chk"
    CHECK (jsonb_typeof("generation_snapshot") = 'object')
);

CREATE UNIQUE INDEX "story_asset_media_versions_spec_number_unique"
  ON "story_asset_media_versions" ("asset_spec_id", "version_number");
CREATE UNIQUE INDEX "story_asset_media_versions_scope_unique"
  ON "story_asset_media_versions" ("id", "asset_spec_id", "story_chapter_id", "story_project_id");
CREATE INDEX "story_asset_media_versions_chapter_recent_idx"
  ON "story_asset_media_versions" ("story_project_id", "story_chapter_id", "created_at" DESC);
CREATE INDEX "story_asset_media_versions_media_idx"
  ON "story_asset_media_versions" ("media_asset_id");

ALTER TABLE "story_asset_media_versions"
  ADD CONSTRAINT "story_asset_media_versions_project_fkey"
    FOREIGN KEY ("story_project_id") REFERENCES "story_projects" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_asset_media_versions_chapter_scope_fkey"
    FOREIGN KEY ("story_chapter_id", "story_project_id")
    REFERENCES "story_chapters" ("id", "story_project_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_asset_media_versions_spec_scope_fkey"
    FOREIGN KEY ("asset_spec_id", "story_chapter_id", "story_project_id")
    REFERENCES "story_asset_specs" ("id", "story_chapter_id", "story_project_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_asset_media_versions_media_fkey"
    FOREIGN KEY ("media_asset_id") REFERENCES "media_assets" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "story_asset_media_versions_preferred_variant_fkey"
    FOREIGN KEY ("preferred_variant_id", "media_asset_id")
    REFERENCES "media_asset_variants" ("id", "asset_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "story_asset_specs"
  ADD CONSTRAINT "story_asset_specs_selected_version_scope_fkey"
    FOREIGN KEY ("selected_media_version_id", "id", "story_chapter_id", "story_project_id")
    REFERENCES "story_asset_media_versions" ("id", "asset_spec_id", "story_chapter_id", "story_project_id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE TABLE "story_storyboard_sequences" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "story_chapter_id" UUID NOT NULL,
  "plot_node_id" VARCHAR(120) NOT NULL,
  "stable_key" VARCHAR(120) NOT NULL,
  "title" VARCHAR(240),
  "description" TEXT,
  "suggested_duration_ms" INTEGER NOT NULL,
  "duration_ms" INTEGER NOT NULL,
  "source_fingerprint" VARCHAR(64) NOT NULL,
  "pending_source_fingerprint" VARCHAR(64),
  "status" "StoryProductionSpecStatus" NOT NULL DEFAULT 'current',
  "version" INTEGER NOT NULL DEFAULT 0,
  "user_modified_at" TIMESTAMPTZ(6),
  "user_modified_by_user_id" VARCHAR(64),
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "last_planned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_storyboard_sequences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_storyboard_sequences_keys_chk" CHECK (
    "plot_node_id" ~ '^[A-Za-z][A-Za-z0-9._:-]{0,119}$'
    AND "stable_key" ~ '^[A-Za-z][A-Za-z0-9._:-]{0,119}$'
  ),
  CONSTRAINT "story_storyboard_sequences_duration_chk"
    CHECK ("suggested_duration_ms" >= 250 AND "duration_ms" >= 250),
  CONSTRAINT "story_storyboard_sequences_fingerprints_chk" CHECK (
    "source_fingerprint" ~ '^[0-9a-f]{64}$'
    AND ("pending_source_fingerprint" IS NULL OR "pending_source_fingerprint" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "story_storyboard_sequences_version_chk" CHECK ("version" >= 0),
  CONSTRAINT "story_storyboard_sequences_user_modified_chk" CHECK (
    ("user_modified_at" IS NULL AND "user_modified_by_user_id" IS NULL)
    OR ("user_modified_at" IS NOT NULL AND btrim("user_modified_by_user_id") <> '')
  ),
  CONSTRAINT "story_storyboard_sequences_stale_shape_chk" CHECK (
    ("status" = 'stale' AND "pending_source_fingerprint" IS NOT NULL)
    OR ("status" <> 'stale' AND "pending_source_fingerprint" IS NULL)
  )
);

CREATE UNIQUE INDEX "story_storyboard_sequences_chapter_plot_unique"
  ON "story_storyboard_sequences" ("story_chapter_id", "plot_node_id");
CREATE UNIQUE INDEX "story_storyboard_sequences_chapter_key_unique"
  ON "story_storyboard_sequences" ("story_chapter_id", "stable_key");
CREATE UNIQUE INDEX "story_storyboard_sequences_scope_unique"
  ON "story_storyboard_sequences" ("id", "story_chapter_id", "story_project_id");
CREATE INDEX "story_storyboard_sequences_chapter_status_idx"
  ON "story_storyboard_sequences" ("story_project_id", "story_chapter_id", "status");

ALTER TABLE "story_storyboard_sequences"
  ADD CONSTRAINT "story_storyboard_sequences_project_fkey"
    FOREIGN KEY ("story_project_id") REFERENCES "story_projects" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_storyboard_sequences_chapter_scope_fkey"
    FOREIGN KEY ("story_chapter_id", "story_project_id")
    REFERENCES "story_chapters" ("id", "story_project_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "story_storyboard_clips" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "story_chapter_id" UUID NOT NULL,
  "sequence_id" UUID NOT NULL,
  "stable_key" VARCHAR(120) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "rank" INTEGER NOT NULL,
  "kind" "StoryStoryboardClipKind" NOT NULL,
  "track" VARCHAR(64) NOT NULL,
  "start_ms" INTEGER NOT NULL,
  "duration_ms" INTEGER NOT NULL,
  "description" TEXT,
  "image_prompt" TEXT,
  "video_prompt" TEXT,
  "negative_prompt" TEXT,
  "generation_config" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "source_fingerprint" VARCHAR(64) NOT NULL,
  "pending_source_fingerprint" VARCHAR(64),
  "status" "StoryProductionSpecStatus" NOT NULL DEFAULT 'current',
  "version" INTEGER NOT NULL DEFAULT 0,
  "selected_media_version_id" UUID,
  "user_modified_at" TIMESTAMPTZ(6),
  "user_modified_by_user_id" VARCHAR(64),
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "last_planned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_storyboard_clips_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_storyboard_clips_key_chk"
    CHECK ("stable_key" ~ '^[A-Za-z][A-Za-z0-9._:-]{0,119}$'),
  CONSTRAINT "story_storyboard_clips_rank_chk" CHECK ("rank" >= 0),
  CONSTRAINT "story_storyboard_clips_timeline_chk"
    CHECK ("start_ms" >= 0 AND "duration_ms" >= 250),
  CONSTRAINT "story_storyboard_clips_track_chk" CHECK (btrim("track") <> ''),
  CONSTRAINT "story_storyboard_clips_title_chk" CHECK (btrim("title") <> ''),
  CONSTRAINT "story_storyboard_clips_prompt_shape_chk" CHECK (
    ("kind" = 'image' AND "image_prompt" IS NOT NULL AND btrim("image_prompt") <> '' AND "video_prompt" IS NULL)
    OR ("kind" = 'video' AND "video_prompt" IS NOT NULL AND btrim("video_prompt") <> '')
  ),
  CONSTRAINT "story_storyboard_clips_generation_config_chk"
    CHECK (jsonb_typeof("generation_config") = 'object'),
  CONSTRAINT "story_storyboard_clips_fingerprints_chk" CHECK (
    "source_fingerprint" ~ '^[0-9a-f]{64}$'
    AND ("pending_source_fingerprint" IS NULL OR "pending_source_fingerprint" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "story_storyboard_clips_version_chk" CHECK ("version" >= 0),
  CONSTRAINT "story_storyboard_clips_user_modified_chk" CHECK (
    ("user_modified_at" IS NULL AND "user_modified_by_user_id" IS NULL)
    OR ("user_modified_at" IS NOT NULL AND btrim("user_modified_by_user_id") <> '')
  ),
  CONSTRAINT "story_storyboard_clips_stale_shape_chk" CHECK (
    ("status" = 'stale' AND "pending_source_fingerprint" IS NOT NULL)
    OR ("status" <> 'stale' AND "pending_source_fingerprint" IS NULL)
  )
);

CREATE UNIQUE INDEX "story_storyboard_clips_sequence_key_unique"
  ON "story_storyboard_clips" ("sequence_id", "stable_key");
CREATE UNIQUE INDEX "story_storyboard_clips_sequence_rank_unique"
  ON "story_storyboard_clips" ("sequence_id", "rank");
CREATE UNIQUE INDEX "story_storyboard_clips_sequence_scope_unique"
  ON "story_storyboard_clips" ("id", "sequence_id", "story_chapter_id", "story_project_id");
CREATE UNIQUE INDEX "story_storyboard_clips_scope_unique"
  ON "story_storyboard_clips" ("id", "story_chapter_id", "story_project_id");
CREATE UNIQUE INDEX "story_storyboard_clips_selected_version_scope_unique"
  ON "story_storyboard_clips" ("selected_media_version_id", "id", "story_chapter_id", "story_project_id");
CREATE INDEX "story_storyboard_clips_chapter_sequence_idx"
  ON "story_storyboard_clips" ("story_project_id", "story_chapter_id", "sequence_id", "rank");

ALTER TABLE "story_storyboard_clips"
  ADD CONSTRAINT "story_storyboard_clips_project_fkey"
    FOREIGN KEY ("story_project_id") REFERENCES "story_projects" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_storyboard_clips_chapter_scope_fkey"
    FOREIGN KEY ("story_chapter_id", "story_project_id")
    REFERENCES "story_chapters" ("id", "story_project_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_storyboard_clips_sequence_scope_fkey"
    FOREIGN KEY ("sequence_id", "story_chapter_id", "story_project_id")
    REFERENCES "story_storyboard_sequences" ("id", "story_chapter_id", "story_project_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "story_storyboard_clip_asset_bindings" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "story_chapter_id" UUID NOT NULL,
  "storyboard_clip_id" UUID NOT NULL,
  "asset_spec_id" UUID NOT NULL,
  "role" VARCHAR(64) NOT NULL,
  "mode" "StoryStoryboardBindingMode" NOT NULL DEFAULT 'follow_selected',
  "pinned_media_version_id" UUID,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "rank" INTEGER NOT NULL DEFAULT 0,
  "source_fingerprint" VARCHAR(64) NOT NULL,
  "pending_source_fingerprint" VARCHAR(64),
  "status" "StoryProductionSpecStatus" NOT NULL DEFAULT 'current',
  "version" INTEGER NOT NULL DEFAULT 0,
  "user_modified_at" TIMESTAMPTZ(6),
  "user_modified_by_user_id" VARCHAR(64),
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "last_planned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_storyboard_clip_asset_bindings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_storyboard_bindings_mode_chk" CHECK (
    ("mode" = 'follow_selected' AND "pinned_media_version_id" IS NULL)
    OR ("mode" = 'pinned' AND "pinned_media_version_id" IS NOT NULL)
  ),
  CONSTRAINT "story_storyboard_bindings_role_chk" CHECK (btrim("role") <> ''),
  CONSTRAINT "story_storyboard_bindings_rank_chk" CHECK ("rank" >= 0),
  CONSTRAINT "story_storyboard_bindings_fingerprints_chk" CHECK (
    "source_fingerprint" ~ '^[0-9a-f]{64}$'
    AND ("pending_source_fingerprint" IS NULL OR "pending_source_fingerprint" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "story_storyboard_bindings_version_chk" CHECK ("version" >= 0),
  CONSTRAINT "story_storyboard_bindings_user_modified_chk" CHECK (
    ("user_modified_at" IS NULL AND "user_modified_by_user_id" IS NULL)
    OR ("user_modified_at" IS NOT NULL AND btrim("user_modified_by_user_id") <> '')
  ),
  CONSTRAINT "story_storyboard_bindings_stale_shape_chk" CHECK (
    ("status" = 'stale' AND "pending_source_fingerprint" IS NOT NULL)
    OR ("status" <> 'stale' AND "pending_source_fingerprint" IS NULL)
  )
);

CREATE UNIQUE INDEX "story_storyboard_bindings_clip_asset_role_unique"
  ON "story_storyboard_clip_asset_bindings" ("storyboard_clip_id", "asset_spec_id", "role");
CREATE UNIQUE INDEX "story_storyboard_bindings_scope_unique"
  ON "story_storyboard_clip_asset_bindings" ("id", "story_chapter_id", "story_project_id");
CREATE INDEX "story_storyboard_bindings_chapter_clip_idx"
  ON "story_storyboard_clip_asset_bindings" ("story_project_id", "story_chapter_id", "storyboard_clip_id", "rank");

ALTER TABLE "story_storyboard_clip_asset_bindings"
  ADD CONSTRAINT "story_storyboard_bindings_project_fkey"
    FOREIGN KEY ("story_project_id") REFERENCES "story_projects" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_storyboard_bindings_chapter_scope_fkey"
    FOREIGN KEY ("story_chapter_id", "story_project_id")
    REFERENCES "story_chapters" ("id", "story_project_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_storyboard_bindings_clip_scope_fkey"
    FOREIGN KEY ("storyboard_clip_id", "story_chapter_id", "story_project_id")
    REFERENCES "story_storyboard_clips" ("id", "story_chapter_id", "story_project_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_storyboard_bindings_asset_scope_fkey"
    FOREIGN KEY ("asset_spec_id", "story_chapter_id", "story_project_id")
    REFERENCES "story_asset_specs" ("id", "story_chapter_id", "story_project_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_storyboard_bindings_pinned_version_scope_fkey"
    FOREIGN KEY ("pinned_media_version_id", "asset_spec_id", "story_chapter_id", "story_project_id")
    REFERENCES "story_asset_media_versions" ("id", "asset_spec_id", "story_chapter_id", "story_project_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "story_storyboard_clip_media_versions" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "story_chapter_id" UUID NOT NULL,
  "storyboard_clip_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "media_asset_id" UUID NOT NULL,
  "preferred_variant_id" UUID,
  "source_fingerprint" VARCHAR(64) NOT NULL,
  "generation_snapshot" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_storyboard_clip_media_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_storyboard_media_versions_number_chk" CHECK ("version_number" > 0),
  CONSTRAINT "story_storyboard_media_versions_fingerprint_chk"
    CHECK ("source_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "story_storyboard_media_versions_snapshot_chk"
    CHECK (jsonb_typeof("generation_snapshot") = 'object')
);

CREATE UNIQUE INDEX "story_storyboard_media_versions_clip_number_unique"
  ON "story_storyboard_clip_media_versions" ("storyboard_clip_id", "version_number");
CREATE UNIQUE INDEX "story_storyboard_media_versions_scope_unique"
  ON "story_storyboard_clip_media_versions" ("id", "storyboard_clip_id", "story_chapter_id", "story_project_id");
CREATE INDEX "story_storyboard_media_versions_chapter_recent_idx"
  ON "story_storyboard_clip_media_versions" ("story_project_id", "story_chapter_id", "created_at" DESC);
CREATE INDEX "story_storyboard_media_versions_media_idx"
  ON "story_storyboard_clip_media_versions" ("media_asset_id");

ALTER TABLE "story_storyboard_clip_media_versions"
  ADD CONSTRAINT "story_storyboard_media_versions_project_fkey"
    FOREIGN KEY ("story_project_id") REFERENCES "story_projects" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_storyboard_media_versions_chapter_scope_fkey"
    FOREIGN KEY ("story_chapter_id", "story_project_id")
    REFERENCES "story_chapters" ("id", "story_project_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_storyboard_media_versions_clip_scope_fkey"
    FOREIGN KEY ("storyboard_clip_id", "story_chapter_id", "story_project_id")
    REFERENCES "story_storyboard_clips" ("id", "story_chapter_id", "story_project_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_storyboard_media_versions_media_fkey"
    FOREIGN KEY ("media_asset_id") REFERENCES "media_assets" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "story_storyboard_media_versions_preferred_variant_fkey"
    FOREIGN KEY ("preferred_variant_id", "media_asset_id")
    REFERENCES "media_asset_variants" ("id", "asset_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "story_storyboard_clips"
  ADD CONSTRAINT "story_storyboard_clips_selected_version_scope_fkey"
    FOREIGN KEY ("selected_media_version_id", "id", "story_chapter_id", "story_project_id")
    REFERENCES "story_storyboard_clip_media_versions" ("id", "storyboard_clip_id", "story_chapter_id", "story_project_id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE TABLE "story_storyboard_cues" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "story_chapter_id" UUID NOT NULL,
  "sequence_id" UUID NOT NULL,
  "storyboard_clip_id" UUID,
  "stable_key" VARCHAR(120) NOT NULL,
  "kind" "StoryStoryboardCueKind" NOT NULL,
  "plot_decision_id" VARCHAR(120),
  "at_ms" INTEGER NOT NULL,
  "duration_ms" INTEGER,
  "payload" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "source_fingerprint" VARCHAR(64) NOT NULL,
  "pending_source_fingerprint" VARCHAR(64),
  "status" "StoryProductionSpecStatus" NOT NULL DEFAULT 'current',
  "version" INTEGER NOT NULL DEFAULT 0,
  "user_modified_at" TIMESTAMPTZ(6),
  "user_modified_by_user_id" VARCHAR(64),
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "last_planned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_storyboard_cues_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_storyboard_cues_key_chk"
    CHECK ("stable_key" ~ '^[A-Za-z][A-Za-z0-9._:-]{0,119}$'),
  CONSTRAINT "story_storyboard_cues_timeline_chk"
    CHECK ("at_ms" >= 0 AND ("duration_ms" IS NULL OR "duration_ms" > 0)),
  CONSTRAINT "story_storyboard_cues_decision_chk" CHECK (
    ("kind" = 'decision' AND "plot_decision_id" IS NOT NULL AND btrim("plot_decision_id") <> '')
    OR ("kind" <> 'decision')
  ),
  CONSTRAINT "story_storyboard_cues_payload_chk" CHECK (jsonb_typeof("payload") = 'object'),
  CONSTRAINT "story_storyboard_cues_fingerprints_chk" CHECK (
    "source_fingerprint" ~ '^[0-9a-f]{64}$'
    AND ("pending_source_fingerprint" IS NULL OR "pending_source_fingerprint" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "story_storyboard_cues_version_chk" CHECK ("version" >= 0),
  CONSTRAINT "story_storyboard_cues_user_modified_chk" CHECK (
    ("user_modified_at" IS NULL AND "user_modified_by_user_id" IS NULL)
    OR ("user_modified_at" IS NOT NULL AND btrim("user_modified_by_user_id") <> '')
  ),
  CONSTRAINT "story_storyboard_cues_stale_shape_chk" CHECK (
    ("status" = 'stale' AND "pending_source_fingerprint" IS NOT NULL)
    OR ("status" <> 'stale' AND "pending_source_fingerprint" IS NULL)
  )
);

CREATE UNIQUE INDEX "story_storyboard_cues_sequence_key_unique"
  ON "story_storyboard_cues" ("sequence_id", "stable_key");
CREATE UNIQUE INDEX "story_storyboard_cues_scope_unique"
  ON "story_storyboard_cues" ("id", "story_chapter_id", "story_project_id");
CREATE INDEX "story_storyboard_cues_chapter_sequence_idx"
  ON "story_storyboard_cues" ("story_project_id", "story_chapter_id", "sequence_id", "at_ms");

ALTER TABLE "story_storyboard_cues"
  ADD CONSTRAINT "story_storyboard_cues_project_fkey"
    FOREIGN KEY ("story_project_id") REFERENCES "story_projects" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_storyboard_cues_chapter_scope_fkey"
    FOREIGN KEY ("story_chapter_id", "story_project_id")
    REFERENCES "story_chapters" ("id", "story_project_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_storyboard_cues_sequence_scope_fkey"
    FOREIGN KEY ("sequence_id", "story_chapter_id", "story_project_id")
    REFERENCES "story_storyboard_sequences" ("id", "story_chapter_id", "story_project_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_storyboard_cues_clip_sequence_scope_fkey"
    FOREIGN KEY ("storyboard_clip_id", "sequence_id", "story_chapter_id", "story_project_id")
    REFERENCES "story_storyboard_clips" ("id", "sequence_id", "story_chapter_id", "story_project_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "story_production_mutation_receipts" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "story_chapter_id" UUID NOT NULL,
  "actor_user_id" VARCHAR(64) NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "operation" VARCHAR(96) NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "response" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_production_mutation_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_production_mutations_nonempty_chk" CHECK (
    btrim("actor_user_id") <> '' AND btrim("idempotency_key") <> '' AND btrim("operation") <> ''
  ),
  CONSTRAINT "story_production_mutations_fingerprint_chk"
    CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "story_production_mutations_response_chk"
    CHECK (jsonb_typeof("response") IN ('object', 'array'))
);

CREATE UNIQUE INDEX "story_production_mutations_actor_key_unique"
  ON "story_production_mutation_receipts" ("story_chapter_id", "actor_user_id", "idempotency_key");
CREATE INDEX "story_production_mutations_chapter_recent_idx"
  ON "story_production_mutation_receipts" ("story_project_id", "story_chapter_id", "created_at" DESC);

ALTER TABLE "story_production_mutation_receipts"
  ADD CONSTRAINT "story_production_mutations_project_fkey"
    FOREIGN KEY ("story_project_id") REFERENCES "story_projects" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "story_production_mutations_chapter_scope_fkey"
    FOREIGN KEY ("story_chapter_id", "story_project_id")
    REFERENCES "story_chapters" ("id", "story_project_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- A sequence references the stable node id in the canonical StoryDraft JSON.
-- This trigger is the relational guard until Plot nodes themselves are moved
-- into first-class tables; it rejects both foreign chapters and non-clip nodes.
CREATE FUNCTION "story_storyboard_plot_node_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "story_chapters" chapter
    JOIN "story_drafts" draft
      ON draft."story_project_id" = chapter."story_project_id"
    WHERE chapter."id" = NEW."story_chapter_id"
      AND chapter."story_project_id" = NEW."story_project_id"
      AND chapter."node_ids" @> jsonb_build_array(NEW."plot_node_id")
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(draft."content" #> '{graph,nodes}', '[]'::JSONB)) node
        WHERE node ->> 'nodeId' = NEW."plot_node_id"
          AND node ->> 'kind' = 'clip'
      )
  ) THEN
    RAISE EXCEPTION 'Storyboard sequence Plot node must be a clip owned by the same Story chapter';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "story_storyboard_plot_node_guard_trigger"
BEFORE INSERT OR UPDATE OF "story_project_id", "story_chapter_id", "plot_node_id"
ON "story_storyboard_sequences"
FOR EACH ROW
EXECUTE FUNCTION "story_storyboard_plot_node_guard"();

-- Asset source ids are similarly guarded against the current chapter graph.
-- Character ids are validated against the canonical Story Bible written from
-- the approved screenplay in the same transaction.
CREATE FUNCTION "story_asset_spec_source_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_node JSONB;
BEGIN
  FOR source_node IN SELECT value FROM jsonb_array_elements(NEW."source_node_ids")
  LOOP
    IF jsonb_typeof(source_node) <> 'string' OR NOT EXISTS (
      SELECT 1
      FROM "story_chapters" chapter
      JOIN "story_drafts" draft
        ON draft."story_project_id" = chapter."story_project_id"
      WHERE chapter."id" = NEW."story_chapter_id"
        AND chapter."story_project_id" = NEW."story_project_id"
        AND chapter."node_ids" @> jsonb_build_array(source_node #>> '{}')
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(draft."content" #> '{graph,nodes}', '[]'::JSONB)) node
          WHERE node ->> 'nodeId' = source_node #>> '{}'
        )
    ) THEN
      RAISE EXCEPTION 'Asset Spec source node must be owned by the same Story chapter';
    END IF;
  END LOOP;

  IF NEW."kind" = 'character' AND NOT EXISTS (
    SELECT 1
    FROM "story_chapters" chapter
    JOIN "story_drafts" draft
      ON draft."story_project_id" = chapter."story_project_id"
    WHERE chapter."id" = NEW."story_chapter_id"
      AND chapter."story_project_id" = NEW."story_project_id"
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(draft."content" #> '{storyBible,characters}', '[]'::JSONB)) character
        WHERE character ->> 'id' = NEW."source_character_id"
      )
  ) THEN
    RAISE EXCEPTION 'Character Asset Spec must reference a canonical Story Bible character';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "story_asset_spec_source_guard_trigger"
BEFORE INSERT OR UPDATE OF
  "story_project_id", "story_chapter_id", "kind", "source_character_id", "source_node_ids"
ON "story_asset_specs"
FOR EACH ROW
EXECUTE FUNCTION "story_asset_spec_source_guard"();

-- Validate the timeline only after the whole transaction has reconciled a
-- sequence, so a multi-row update can move adjacent clip boundaries safely.
CREATE FUNCTION "story_storyboard_timeline_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_sequence_id UUID;
  sequence_duration INTEGER;
  previous_end INTEGER := 0;
  visual_clip RECORD;
BEGIN
  IF TG_TABLE_NAME = 'story_storyboard_sequences' THEN
    target_sequence_id := COALESCE(NEW."id", OLD."id");
  ELSE
    target_sequence_id := COALESCE(NEW."sequence_id", OLD."sequence_id");
  END IF;
  SELECT sequence."duration_ms"
    INTO sequence_duration
  FROM "story_storyboard_sequences" sequence
  WHERE sequence."id" = target_sequence_id;

  IF sequence_duration IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  FOR visual_clip IN
    SELECT clip."start_ms", clip."duration_ms"
    FROM "story_storyboard_clips" clip
    WHERE clip."sequence_id" = target_sequence_id
      AND clip."status" <> 'archived'
    ORDER BY clip."start_ms", clip."rank", clip."id"
  LOOP
    IF visual_clip."start_ms" <> previous_end THEN
      RAISE EXCEPTION 'Storyboard visual clips must be continuous and non-overlapping';
    END IF;
    previous_end := visual_clip."start_ms" + visual_clip."duration_ms";
  END LOOP;

  IF previous_end <> sequence_duration THEN
    RAISE EXCEPTION 'Storyboard visual clips must cover the complete sequence duration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "story_storyboard_cues" cue
    WHERE cue."sequence_id" = target_sequence_id
      AND cue."status" <> 'archived'
      AND cue."at_ms" > sequence_duration
  ) THEN
    RAISE EXCEPTION 'Storyboard cue must occur within its sequence duration';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE CONSTRAINT TRIGGER "story_storyboard_clip_timeline_guard_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "story_storyboard_clips"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "story_storyboard_timeline_guard"();

CREATE CONSTRAINT TRIGGER "story_storyboard_sequence_timeline_guard_trigger"
AFTER INSERT OR UPDATE OF "duration_ms" ON "story_storyboard_sequences"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "story_storyboard_timeline_guard"();

CREATE FUNCTION "story_storyboard_cue_timeline_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sequence_duration INTEGER;
BEGIN
  SELECT sequence."duration_ms"
    INTO sequence_duration
  FROM "story_storyboard_sequences" sequence
  WHERE sequence."id" = COALESCE(NEW."sequence_id", OLD."sequence_id");
  IF sequence_duration IS NOT NULL
     AND COALESCE(NEW."at_ms", 0) > sequence_duration THEN
    RAISE EXCEPTION 'Storyboard cue must occur within its sequence duration';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE CONSTRAINT TRIGGER "story_storyboard_cue_timeline_guard_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "story_storyboard_cues"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "story_storyboard_cue_timeline_guard"();
