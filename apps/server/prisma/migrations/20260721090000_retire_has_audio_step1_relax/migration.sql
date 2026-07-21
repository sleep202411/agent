-- Retire the `has_audio` video flag — STEP 1 of 3: RELAX.
--
-- Read `prisma/RETIRE-HAS-AUDIO-RUNBOOK.md` before deploying anything in this
-- series. Short version of the plan:
--
--   step 1  RELAX       this migration. Schema only, no application change.
--   step 2  STOP USING  application release only, no migration.
--   step 3  DROP        prisma/migrations-staged/..._step3_drop, promoted and
--                       shipped as its own release after step 2 is everywhere.
--
-- WHY THE FLAG GOES AT ALL
--
-- Nothing is allowed to read it any more. Whether a clip carries an audio track
-- is the creator's business — what they uploaded is what plays. The player asks
-- the browser for audible playback and falls back to muted only when the
-- browser actually refuses, so no stored flag can silence a film. The flag was
-- never useful in its stated direction either: muting a video that has no audio
-- changes nothing. It could only ever do harm, and it did — a one-off direct
-- ingest wrote `has_audio = false` on clips that do contain AAC stereo, and that
-- wrong row is what muted a published film.
--
-- WHY THIS STEP RELAXES INSTEAD OF DROPPING
--
-- Two unrelated hazards are being kept apart, and fusing them is what forces
-- compatibility shims:
--
--   a) A writer that OMITS the columns meets a schema that still demands them.
--      Every rule below rejects such a write, so the rules have to be loosened
--      before the code that omits them exists. That is this step.
--   b) A reader that still NAMES the columns meets a schema where they are
--      gone. Prisma names every column explicitly in its SELECTs, so a
--      `DROP COLUMN` breaks the previous image the instant it commits — and the
--      deploy runs `prisma migrate deploy` from the new pod's `db-migrate` init
--      container (deploy/helm/fizzdragon/templates/server.yaml) while the
--      previous image is still serving traffic. That is step 3, and it is only
--      safe once no such reader is left.
--
-- This step is backward compatible by construction: it only ever REMOVES a
-- reason to reject. Nothing is dropped, no column changes type, no value is
-- rewritten. The old code keeps writing real `has_audio` values and they still
-- satisfy every loosened rule, so this migration can ship on its own, ahead of
-- any application change, and sit in production indefinitely.
--
-- WHAT WOULD REJECT A WRITE THAT OMITS THE COLUMNS, AND WHAT IS DONE ABOUT IT
--
--   story_video_build_clips.has_audio — NOT NULL with no default, so every
--     frozen clip INSERT would fail outright. The NOT NULL goes.
--   story_build_assets.has_audio — the column is already nullable, but
--     story_build_assets_video_metadata_chk demands `has_audio IS NOT NULL` for
--     `role = 'video'`, so every video build asset INSERT would fail. The
--     conjunct goes.
--   story_video_selections.current_has_audio — the column is already nullable,
--     but story_video_selections_media_shape_chk demands it NOT NULL on a
--     populated selection and NULL on an empty one. A writer that names neither
--     trips BOTH branches: the write that selects a video, and the write that
--     clears one (Prisma leaves a column it does not model at its previous
--     value). Both conjuncts go.
--   media_asset_variants.has_audio — the column is already nullable and nothing
--     rejects the variant write itself, but two plpgsql guards read it and
--     reject the rows built on top of it. See below.
--
-- GUARDS REBUILT, AND ONLY THESE THREE
--
-- These are exactly the guards that REJECT on the flag. They are rebuilt here
-- because a rejection cannot wait for a later release.
--
--   story_video_generation_attempt_integrity_guard — refuses a terminal video
--     attempt whose output variant has `has_audio IS NULL`, which is every
--     variant probed after step 2. Every AI video generation would fail at
--     `ready`.
--   story_video_selection_media_guard — requires
--     `variant.has_audio = NEW.current_has_audio`. With either side NULL the
--     comparison is NULL, the matching row drops out of the EXISTS, and every
--     current-video write raises.
--   story_build_ready_guard — compares the frozen clip's flag against the live
--     variant's. A post-step-2 build freezes NULL while a pre-cutover variant
--     still carries `true`, so `IS DISTINCT FROM` fires and no build containing
--     a pre-cutover video can reach `ready`. Its sibling comparison (build asset
--     vs clip) cannot fire, because one pod writes both rows from the same value
--     in one transaction; it is removed in the same pass anyway so that step 3
--     stays a pure column drop with no logic left to re-derive.
--
-- None of the three loses coverage. `has_audio` was derived from the same bytes
-- as checksum_sha256, so a copy of it could only go stale when the checksum —
-- still compared in every one of these guards — went stale with it. The single
-- case the flag caught alone was a re-probe CORRECTING it on unchanged bytes,
-- which is exactly the inspection being retired.
--
-- GUARDS DELIBERATELY NOT TOUCHED HERE
--
--   story_video_media_asset_invalidation and story_video_media_variant_invalid-
--     ation only WRITE `current_has_audio = NULL` and change-detect on
--     `has_audio`. Both stay valid while the columns exist, both keep doing the
--     right thing for the previous image, and neither can reject anything. Step
--     3 rewrites them, because that is when they would break.
--   media_asset_variants_story_video_invalidation_trg lists `has_audio` in its
--     `UPDATE OF` set. That column list is a recorded dependency, but only a
--     DROP COLUMN forces the trigger to be dropped and recreated — and this step
--     drops no column. Step 3 handles it.
--
-- NO COMPATIBILITY SHIM
--
-- Deliberately none. An earlier attempt fused the schema change and the
-- application change into one release and needed a BEFORE trigger to keep
-- `current_has_audio` in step with the rest of the selection tuple, because the
-- previous image raises on a partially-populated tuple. Splitting the work
-- removes the schema half of that problem entirely, and the residue — a
-- previous-image pod reading a selection that a new-image pod just rewrote,
-- during the step 2 rollout window only — is a bounded, self-clearing 500 on one
-- project, not corruption. The runbook states it plainly under step 2. A trigger
-- that survives into production to paper over one minute of rollout is the more
-- expensive of the two, and it can only ever be partly right.
--
-- PG16 (local dev) vs PG17 (prod)
--
-- From PG17 a NOT NULL constraint is ALSO a `pg_constraint` row with
-- `contype = 'n'`, which has burned this repo before: a bulk `RENAME CONSTRAINT`
-- loop collided with the 63-character identifier limit on those PG17-only rows
-- and crash-looped db-migrate. Nothing here enumerates, renames, or names a
-- not-null constraint. The single not-null change is written as
-- `ALTER COLUMN ... DROP NOT NULL`, addressed by column name, and the server
-- removes the catalog row itself on both versions. The two check constraints are
-- `contype = 'c'` and are addressed by their own explicit names. This migration
-- is version-neutral.
--
-- LOCKING
--
-- Prisma runs the whole file in one transaction, so every lock it takes is held
-- until commit and `NOT VALID` + `VALIDATE CONSTRAINT` would buy nothing. Both
-- rebuilt check constraints are strictly weaker than the ones they replace, so
-- the validating scan cannot fail; both tables are small (Story Studio product
-- plane, created 2026-07). Expect sub-second ACCESS EXCLUSIVE.

ALTER TABLE "story_video_build_clips"
  ALTER COLUMN "has_audio" DROP NOT NULL;

ALTER TABLE "story_build_assets"
  DROP CONSTRAINT "story_build_assets_video_metadata_chk";
ALTER TABLE "story_build_assets"
  ADD CONSTRAINT "story_build_assets_video_metadata_chk" CHECK (
    "role" <> 'video' OR (
      "content_type" = 'video/mp4' AND
      "browser_safe_mp4" IS TRUE AND
      "duration_ms" > 0 AND
      "width" > 0 AND
      "height" > 0
    )
  );

-- The remaining nine media columns keep their all-or-nothing shape. Only
-- `current_has_audio` stops being spoken about, and that is exactly what lets
-- BOTH write shapes through: the old one that populates it alongside the tuple,
-- and the new one that never mentions it and therefore leaves whatever is there.
ALTER TABLE "story_video_selections"
  DROP CONSTRAINT "story_video_selections_media_shape_chk";
ALTER TABLE "story_video_selections"
  ADD CONSTRAINT "story_video_selections_media_shape_chk" CHECK (
    (
      "current_asset_id" IS NULL AND
      "current_variant_id" IS NULL AND
      "current_source_generation_attempt_id" IS NULL AND
      "current_checksum_sha256" IS NULL AND
      "current_content_type" IS NULL AND
      "current_duration_ms" IS NULL AND
      "current_width" IS NULL AND
      "current_height" IS NULL AND
      "current_browser_safe_mp4" IS NULL
    ) OR (
      "current_asset_id" IS NOT NULL AND
      "current_variant_id" IS NOT NULL AND
      "current_checksum_sha256" ~ '^[0-9a-f]{64}$' AND
      "current_content_type" = 'video/mp4' AND
      "current_duration_ms" > 0 AND
      "current_width" > 0 AND
      "current_height" > 0 AND
      "current_browser_safe_mp4" IS TRUE AND
      "set_at" IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION "story_video_generation_attempt_integrity_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  expected_workspace UUID;
  selection_target_key VARCHAR(128);
  current_selection_version INTEGER;
  job_workspace UUID;
  job_project UUID;
  job_type TEXT;
  job_status TEXT;
  job_block_key VARCHAR(128);
  job_surface VARCHAR(64);
  job_deleted_at TIMESTAMPTZ;
  output_job UUID;
  output_asset_from_job UUID;
  output_type TEXT;
  output_deleted_at TIMESTAMPTZ;
  asset_workspace UUID;
  asset_kind TEXT;
  asset_status TEXT;
  asset_moderation TEXT;
  asset_deleted_at TIMESTAMPTZ;
  variant_asset UUID;
  variant_status TEXT;
  variant_checksum TEXT;
  variant_content_type TEXT;
  variant_duration_ms INTEGER;
  variant_width INTEGER;
  variant_height INTEGER;
  variant_metadata JSONB;
  variant_deleted_at TIMESTAMPTZ;
BEGIN
  SELECT project."workspace_id", selection."target_key", selection."version"
    INTO expected_workspace, selection_target_key, current_selection_version
  FROM "story_projects" AS project
  JOIN "story_video_selections" AS selection
    ON selection."story_project_id" = project."id"
  WHERE project."id" = NEW."story_project_id"
    AND selection."id" = NEW."selection_id";

  IF expected_workspace IS NULL THEN
    RAISE EXCEPTION 'STORY_VIDEO_ATTEMPT_SCOPE: selection must belong to the exact Story project'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT'
     AND NEW."selection_version_at_submit" IS DISTINCT FROM current_selection_version THEN
    RAISE EXCEPTION 'STORY_VIDEO_ATTEMPT_SELECTION_VERSION: submission must freeze the exact reserved selection version'
      USING ERRCODE = '23514';
  END IF;

  SELECT "workspace_id", "project_id", "type"::text, "status"::text,
         "document_block_id", "source_surface", "deleted_at"
    INTO job_workspace, job_project, job_type, job_status,
         job_block_key, job_surface, job_deleted_at
  FROM "ai_jobs"
  WHERE "id" = NEW."ai_job_id";

  IF job_workspace IS DISTINCT FROM expected_workspace
     OR job_project IS NOT NULL
     OR job_type IS DISTINCT FROM 'video'
     OR job_block_key IS DISTINCT FROM selection_target_key
     OR job_surface IS DISTINCT FROM 'story-studio'
     OR job_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'STORY_VIDEO_ATTEMPT_JOB_SCOPE: AiJob must be the active Story video job for this workspace and target'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."ai_job_output_id" IS NOT NULL THEN
    SELECT "job_id", "asset_id", "type"::text, "deleted_at"
      INTO output_job, output_asset_from_job, output_type, output_deleted_at
    FROM "ai_outputs"
    WHERE "id" = NEW."ai_job_output_id";
    IF output_job IS DISTINCT FROM NEW."ai_job_id"
       OR output_asset_from_job IS DISTINCT FROM NEW."output_asset_id"
       OR output_type IS DISTINCT FROM 'video'
       OR output_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'STORY_VIDEO_ATTEMPT_OUTPUT_JOB: output must be the active exact AiJob output asset'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."output_asset_id" IS NOT NULL THEN
    SELECT "workspace_id", "kind"::text, "status"::text,
           "moderation_status"::text, "deleted_at"
      INTO asset_workspace, asset_kind, asset_status,
           asset_moderation, asset_deleted_at
    FROM "media_assets"
    WHERE "id" = NEW."output_asset_id";

    SELECT "asset_id", "status"::text, "checksum_sha256", "content_type",
           "duration_ms", "width", "height", "metadata", "deleted_at"
      INTO variant_asset, variant_status, variant_checksum, variant_content_type,
           variant_duration_ms, variant_width, variant_height,
           variant_metadata, variant_deleted_at
    FROM "media_asset_variants"
    WHERE "id" = NEW."output_variant_id";

    IF asset_workspace IS DISTINCT FROM expected_workspace
       OR asset_kind IS DISTINCT FROM 'video'
       OR variant_asset IS DISTINCT FROM NEW."output_asset_id"
       OR variant_checksum IS DISTINCT FROM NEW."output_checksum_sha256" THEN
      RAISE EXCEPTION 'STORY_VIDEO_ATTEMPT_OUTPUT_IDENTITY: output must freeze one exact workspace asset and variant checksum'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."status" IN ('ready', 'superseded') THEN
    IF job_status IS DISTINCT FROM 'completed'
       OR asset_status IS DISTINCT FROM 'ready'
       OR asset_moderation = 'blocked'
       OR asset_deleted_at IS NOT NULL
       OR variant_status IS DISTINCT FROM 'ready'
       OR variant_deleted_at IS NOT NULL
       OR variant_content_type IS DISTINCT FROM 'video/mp4'
       OR variant_duration_ms IS NULL OR variant_duration_ms <= 0
       OR variant_width IS NULL OR variant_width <= 0
       OR variant_height IS NULL OR variant_height <= 0
       OR (
         variant_metadata->>'browserSafeMp4' IS DISTINCT FROM 'true' AND
         variant_metadata->'videoProbe'->>'browserSafeMp4' IS DISTINCT FROM 'true'
       )
       OR NOT EXISTS (
         SELECT 1
         FROM "media_object_placements" AS placement
         WHERE placement."asset_id" = NEW."output_asset_id"
           AND placement."variant_id" = NEW."output_variant_id"
           AND placement."status" = 'active'
           AND placement."deleted_at" IS NULL
       ) THEN
      RAISE EXCEPTION 'STORY_VIDEO_ATTEMPT_OUTPUT_NOT_READY: terminal video output must be active, browser-safe, placed, and byte-exact'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "story_video_selection_media_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."current_asset_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "story_projects" AS project
    JOIN "media_assets" AS asset
      ON asset."id" = NEW."current_asset_id"
     AND asset."workspace_id" = project."workspace_id"
    JOIN "media_asset_variants" AS variant
      ON variant."id" = NEW."current_variant_id"
     AND variant."asset_id" = asset."id"
    WHERE project."id" = NEW."story_project_id"
      AND asset."kind" = 'video'
      AND asset."status" = 'ready'
      AND asset."moderation_status" <> 'blocked'
      AND asset."deleted_at" IS NULL
      AND variant."status" = 'ready'
      AND variant."deleted_at" IS NULL
      AND variant."content_type" = 'video/mp4'
      AND (
        variant."metadata"->>'browserSafeMp4' = 'true' OR
        variant."metadata"->'videoProbe'->>'browserSafeMp4' = 'true'
      )
      AND variant."checksum_sha256" = NEW."current_checksum_sha256"
      AND variant."content_type" = NEW."current_content_type"
      AND variant."duration_ms" = NEW."current_duration_ms"
      AND variant."width" = NEW."current_width"
      AND variant."height" = NEW."current_height"
      AND NEW."current_browser_safe_mp4" IS TRUE
      AND EXISTS (
        SELECT 1
        FROM "media_object_placements" AS placement
        WHERE placement."asset_id" = NEW."current_asset_id"
          AND placement."variant_id" = NEW."current_variant_id"
          AND placement."status" = 'active'
          AND placement."deleted_at" IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'STORY_VIDEO_SELECTION_MEDIA_INVALID: current video must match one exact active browser-safe ready MP4 variant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "story_build_ready_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" <> 'ready' OR OLD."status" = 'ready' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "story_video_build_clips" AS clip
    JOIN "story_build_assets" AS build_asset
      ON build_asset."id" = clip."build_asset_id"
     AND build_asset."build_id" = clip."build_id"
    JOIN "media_assets" AS media_asset
      ON media_asset."id" = build_asset."asset_id"
    JOIN "media_asset_variants" AS media_variant
      ON media_variant."id" = build_asset."variant_id"
     AND media_variant."asset_id" = build_asset."asset_id"
    LEFT JOIN "story_video_generation_attempts" AS generation
      ON generation."id" = clip."source_generation_attempt_id"
     AND generation."story_project_id" = clip."story_project_id"
    WHERE clip."build_id" = NEW."id"
      AND (
        clip."story_project_id" IS DISTINCT FROM NEW."story_project_id" OR
        build_asset."story_project_id" IS DISTINCT FROM NEW."story_project_id" OR
        build_asset."role" IS DISTINCT FROM 'video' OR
        build_asset."logical_key" IS DISTINCT FROM clip."logical_key" OR
        build_asset."checksum_sha256" IS DISTINCT FROM clip."checksum_sha256" OR
        build_asset."content_type" IS DISTINCT FROM clip."content_type" OR
        build_asset."duration_ms" IS DISTINCT FROM clip."duration_ms" OR
        build_asset."width" IS DISTINCT FROM clip."width" OR
        build_asset."height" IS DISTINCT FROM clip."height" OR
        build_asset."browser_safe_mp4" IS DISTINCT FROM clip."browser_safe_mp4" OR
        build_asset."browser_safe_mp4" IS NOT TRUE OR
        clip."browser_safe_mp4" IS NOT TRUE OR
        media_asset."kind" IS DISTINCT FROM 'video' OR
        media_asset."status" IS DISTINCT FROM 'ready' OR
        media_asset."moderation_status" = 'blocked' OR
        media_asset."deleted_at" IS NOT NULL OR
        media_variant."status" IS DISTINCT FROM 'ready' OR
        media_variant."deleted_at" IS NOT NULL OR
        (
          media_variant."metadata"->>'browserSafeMp4' IS DISTINCT FROM 'true' AND
          media_variant."metadata"->'videoProbe'->>'browserSafeMp4' IS DISTINCT FROM 'true'
        ) OR
        media_variant."checksum_sha256" IS DISTINCT FROM clip."checksum_sha256" OR
        media_variant."content_type" IS DISTINCT FROM clip."content_type" OR
        media_variant."duration_ms" IS DISTINCT FROM clip."duration_ms" OR
        media_variant."width" IS DISTINCT FROM clip."width" OR
        media_variant."height" IS DISTINCT FROM clip."height" OR
        NOT EXISTS (
          SELECT 1
          FROM "media_object_placements" AS placement
          WHERE placement."asset_id" = build_asset."asset_id"
            AND placement."variant_id" = build_asset."variant_id"
            AND placement."status" = 'active'
            AND placement."deleted_at" IS NULL
        ) OR
        (clip."source_generation_attempt_id" IS NOT NULL AND (
          generation."id" IS NULL OR
          generation."status" IS DISTINCT FROM 'ready' OR
          generation."output_asset_id" IS DISTINCT FROM build_asset."asset_id" OR
          generation."output_variant_id" IS DISTINCT FROM build_asset."variant_id" OR
          generation."output_checksum_sha256" IS DISTINCT FROM clip."checksum_sha256"
        ))
      )
  ) OR EXISTS (
    SELECT 1
    FROM "story_build_assets" AS build_asset
    LEFT JOIN "story_video_build_clips" AS clip
      ON clip."build_asset_id" = build_asset."id"
     AND clip."build_id" = build_asset."build_id"
    WHERE build_asset."build_id" = NEW."id"
      AND build_asset."role" = 'video'
      AND clip."build_asset_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'StoryBuild contains incomplete or mismatched frozen video media'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
