-- Video-first / manual-bind relaxation of the build ready-guard.
-- A manually bound video (current_video_source_attempt_id IS NULL) is the
-- shot's content, not an AI-generation output: it is exempt from
-- generation-provenance (spec/input hash freshness, attempt identity),
-- output-contract (duration ± tolerance), and continuity-QA checks. All
-- integrity/playability checks (asset ready, checksum consistency,
-- not-deleted, not-moderation-blocked) still apply.

CREATE OR REPLACE FUNCTION "story_build_ready_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  project_format "StoryFormat";
  current_production_revision INTEGER;
  expected_clips INTEGER;
  actual_clips INTEGER;
BEGIN
  IF NEW."status" <> 'ready' OR OLD."status" = 'ready' THEN
    RETURN NEW;
  END IF;
  SELECT "format" INTO project_format FROM "story_projects" WHERE "id" = NEW."story_project_id";
  IF project_format <> 'interactive_film' THEN
    RETURN NEW;
  END IF;
  SELECT "production_revision", "target_clip_count"
  INTO current_production_revision, expected_clips
  FROM "story_film_specs" WHERE "revision_id" = NEW."source_revision_id";
  IF current_production_revision IS NULL OR current_production_revision <> NEW."source_production_revision" THEN
    RAISE EXCEPTION 'Film Build source production revision is stale' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO actual_clips FROM "story_film_build_clips" WHERE "build_id" = NEW."id";
  IF (NEW."kind" = 'production' AND actual_clips <> expected_clips)
     OR (NEW."kind" = 'preview' AND actual_clips < 1) THEN
    RAISE EXCEPTION 'Film Build clip manifest is incomplete' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "story_film_build_clips" AS build_clip
    JOIN "story_film_clips" AS clip ON clip."id" = build_clip."clip_id"
    JOIN "story_build_assets" AS build_asset ON build_asset."id" = build_clip."build_asset_id"
    JOIN "media_assets" AS media_asset ON media_asset."id" = build_asset."asset_id"
    JOIN "media_asset_variants" AS media_variant ON media_variant."id" = build_asset."variant_id"
    WHERE build_clip."build_id" = NEW."id"
      AND (
        -- Integrity / playability checks — always enforced (manual + generated).
        build_clip."story_project_id" <> NEW."story_project_id"
        OR build_clip."revision_id" <> NEW."source_revision_id"
        OR clip."archived_at" IS NOT NULL
        OR clip."current_video_asset_id" IS NULL
        OR clip."current_video_variant_id" IS NULL
        OR build_clip."checksum_sha256" IS DISTINCT FROM clip."current_video_checksum_sha256"
        OR jsonb_typeof(clip."current_video_technical_checks") <> 'array'
        OR jsonb_array_length(clip."current_video_technical_checks") = 0
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(clip."current_video_technical_checks") AS check_row
          WHERE check_row->>'status' IS DISTINCT FROM 'passed'
        )
        OR build_asset."role" <> 'video'
        OR build_asset."asset_id" IS DISTINCT FROM clip."current_video_asset_id"
        OR build_asset."variant_id" IS DISTINCT FROM clip."current_video_variant_id"
        OR build_asset."checksum_sha256" IS DISTINCT FROM clip."current_video_checksum_sha256"
        OR build_asset."duration_ms" IS DISTINCT FROM build_clip."duration_ms"
        OR media_asset."kind" <> 'video' OR media_asset."status" <> 'ready'
        OR media_asset."moderation_status" = 'blocked' OR media_asset."deleted_at" IS NOT NULL
        OR media_variant."asset_id" IS DISTINCT FROM media_asset."id"
        OR media_variant."status" <> 'ready' OR media_variant."deleted_at" IS NOT NULL
        OR media_variant."checksum_sha256" IS DISTINCT FROM build_clip."checksum_sha256"
        -- Generation-provenance + output-contract checks — a manually bound
        -- video (no source generation attempt) IS the content and is exempt.
        OR (
          clip."current_video_source_attempt_id" IS NOT NULL
          AND (
            clip."current_video_spec_hash" IS DISTINCT FROM clip."spec_hash"
            OR clip."current_video_input_hash" IS DISTINCT FROM clip."production_input_hash"
            OR build_clip."source_generation_attempt_id" IS DISTINCT FROM clip."current_video_source_attempt_id"
            OR build_clip."clip_spec_hash" IS DISTINCT FROM clip."current_video_spec_hash"
            OR build_clip."production_input_hash" IS DISTINCT FROM clip."current_video_input_hash"
            OR (clip."spec_json" #>> '{outputContract,durationMs}') IS NULL
            OR (clip."spec_json" #>> '{outputContract,durationToleranceMs}') IS NULL
            OR build_clip."duration_ms" <
              (clip."spec_json" #>> '{outputContract,durationMs}')::INTEGER -
              (clip."spec_json" #>> '{outputContract,durationToleranceMs}')::INTEGER
            OR build_clip."duration_ms" >
              (clip."spec_json" #>> '{outputContract,durationMs}')::INTEGER +
              (clip."spec_json" #>> '{outputContract,durationToleranceMs}')::INTEGER
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Film Build contains a stale, unusable, or mismatched current video' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "story_film_clip_dependencies" AS dependency
    JOIN "story_film_build_clips" AS upstream_clip
      ON upstream_clip."build_id" = NEW."id" AND upstream_clip."clip_id" = dependency."predecessor_clip_id"
    JOIN "story_build_assets" AS upstream_asset ON upstream_asset."id" = upstream_clip."build_asset_id"
    JOIN "story_film_build_clips" AS downstream_clip
      ON downstream_clip."build_id" = NEW."id" AND downstream_clip."clip_id" = dependency."successor_clip_id"
    JOIN "story_build_assets" AS downstream_asset ON downstream_asset."id" = downstream_clip."build_asset_id"
    JOIN "story_film_clips" AS downstream_clip_row ON downstream_clip_row."id" = downstream_clip."clip_id"
    LEFT JOIN "story_film_continuity_checks" AS continuity
      ON continuity."dependency_id" = dependency."id"
      AND continuity."downstream_variant_id" = downstream_asset."variant_id"
      AND continuity."downstream_checksum_sha256" = downstream_asset."checksum_sha256"
      AND continuity."decision" IN ('pass', 'waived')
     WHERE dependency."revision_id" = NEW."source_revision_id"
       AND dependency."kind" IN ('continuity', 'convergence')
       -- Continuity QA is a generated-video concern; manual downstream binds are exempt.
       AND downstream_clip_row."current_video_source_attempt_id" IS NOT NULL
       AND continuity."id" IS NULL
   ) THEN
    RAISE EXCEPTION 'Film Build is missing a passing continuity check for its exact media variants' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
