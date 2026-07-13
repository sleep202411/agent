-- A Master variant may legitimately differ from its authored target inside the
-- immutable output-contract tolerance. The original ready guard compared the
-- frozen actual duration to target_duration_ms exactly, contradicting the
-- application validator and rejecting otherwise valid Builds.
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

  SELECT "format" INTO project_format FROM "story_projects"
  WHERE "id" = NEW."story_project_id";

  IF project_format = 'interactive_film' THEN
    SELECT "production_revision", "target_clip_count"
      INTO current_production_revision, expected_clips
    FROM "story_film_specs" WHERE "revision_id" = NEW."source_revision_id";
    IF current_production_revision IS NULL
       OR current_production_revision <> NEW."source_production_revision" THEN
      RAISE EXCEPTION 'Film Build source production revision is stale'
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*) INTO actual_clips FROM "story_film_build_clips"
    WHERE "build_id" = NEW."id";
    IF (NEW."kind" = 'production' AND actual_clips <> expected_clips)
       OR (NEW."kind" = 'preview' AND actual_clips < 1) THEN
      RAISE EXCEPTION 'Film Build clip manifest is incomplete'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "story_film_build_clips" bc
      JOIN "story_film_clips" c ON c."id" = bc."clip_id"
      JOIN "story_film_takes" t ON t."id" = bc."take_id"
      JOIN "story_build_assets" a ON a."id" = bc."build_asset_id"
      LEFT JOIN "story_film_take_approvals" ta ON ta."take_id" = t."id"
      WHERE bc."build_id" = NEW."id"
        AND (
          bc."story_project_id" <> NEW."story_project_id" OR
          bc."revision_id" <> NEW."source_revision_id" OR
          c."master_take_id" IS DISTINCT FROM t."id" OR
          t."status" <> 'ready' OR t."superseded_at" IS NOT NULL OR ta."take_id" IS NULL OR
          t."clip_spec_hash" <> c."spec_hash" OR bc."clip_spec_hash" <> t."clip_spec_hash" OR
          bc."production_input_hash" <> t."production_input_hash" OR
          bc."checksum_sha256" <> t."output_checksum_sha256" OR
          (c."spec_json" #>> '{outputContract,durationMs}') IS NULL OR
          (c."spec_json" #>> '{outputContract,durationToleranceMs}') IS NULL OR
          bc."duration_ms" <
            (c."spec_json" #>> '{outputContract,durationMs}')::INTEGER -
            (c."spec_json" #>> '{outputContract,durationToleranceMs}')::INTEGER OR
          bc."duration_ms" >
            (c."spec_json" #>> '{outputContract,durationMs}')::INTEGER +
            (c."spec_json" #>> '{outputContract,durationToleranceMs}')::INTEGER OR
          a."duration_ms" IS DISTINCT FROM bc."duration_ms" OR
          a."asset_id" IS DISTINCT FROM t."output_asset_id" OR
          a."variant_id" IS DISTINCT FROM t."output_variant_id" OR
          a."checksum_sha256" <> t."output_checksum_sha256"
        )
    ) THEN
      RAISE EXCEPTION 'Film Build contains a non-approved, stale or mismatched Master Take'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "story_film_build_clips" bc
      JOIN "story_film_clip_references" cr ON cr."clip_id" = bc."clip_id" AND cr."required"
      JOIN "story_film_reference_slots" s ON s."id" = cr."reference_slot_id"
      LEFT JOIN "story_film_take_references" tr
        ON tr."take_id" = bc."take_id"
       AND tr."reference_slot_id" = cr."reference_slot_id"
       AND tr."role" = cr."role" AND tr."position" = cr."position"
       AND tr."reference_version_id" = s."approved_version_id"
      WHERE bc."build_id" = NEW."id"
        AND (s."approved_version_id" IS NULL OR tr."take_id" IS NULL)
    ) THEN
      RAISE EXCEPTION 'Film Build Take references are stale or incomplete'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "story_film_clip_dependencies" d
      JOIN "story_film_build_clips" up
        ON up."build_id" = NEW."id" AND up."clip_id" = d."predecessor_clip_id"
      JOIN "story_film_build_clips" down
        ON down."build_id" = NEW."id" AND down."clip_id" = d."successor_clip_id"
      LEFT JOIN "story_film_continuity_checks" cc
        ON cc."dependency_id" = d."id"
       AND cc."upstream_take_id" = up."take_id"
       AND cc."downstream_take_id" = down."take_id"
       AND cc."decision" IN ('pass', 'waived')
      WHERE d."revision_id" = NEW."source_revision_id"
        AND d."kind" IN ('continuity', 'convergence')
        AND cc."id" IS NULL
    ) THEN
      RAISE EXCEPTION 'Film Build is missing a passing continuity check'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
