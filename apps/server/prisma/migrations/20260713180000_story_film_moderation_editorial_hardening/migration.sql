-- Media moderation is part of the Story production contract, not only a URL
-- presentation concern. These guards make blocked assets unusable even when a
-- caller bypasses the application service.

CREATE FUNCTION "story_take_output_moderation_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  asset_moderation "MediaAssetModerationStatus";
BEGIN
  IF NEW."status" <> 'ready'::"StoryFilmTakeStatus" THEN
    RETURN NEW;
  END IF;
  SELECT "moderation_status" INTO asset_moderation
  FROM "media_assets" WHERE "id" = NEW."output_asset_id";
  IF asset_moderation IS DISTINCT FROM NULL
     AND asset_moderation = 'blocked'::"MediaAssetModerationStatus" THEN
    RAISE EXCEPTION 'A moderation-blocked output cannot become a ready Story Take'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_takes_output_moderation_guard_trg"
BEFORE INSERT OR UPDATE OF "status", "output_asset_id" ON "story_film_takes"
FOR EACH ROW EXECUTE FUNCTION "story_take_output_moderation_guard"();
CREATE TRIGGER "story_film_trailer_takes_output_moderation_guard_trg"
BEFORE INSERT OR UPDATE OF "status", "output_asset_id" ON "story_film_trailer_takes"
FOR EACH ROW EXECUTE FUNCTION "story_take_output_moderation_guard"();

CREATE FUNCTION "story_take_reference_asset_moderation_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  asset_moderation "MediaAssetModerationStatus";
BEGIN
  SELECT "moderation_status" INTO asset_moderation
  FROM "media_assets" WHERE "id" = NEW."asset_id";
  IF asset_moderation = 'blocked'::"MediaAssetModerationStatus" THEN
    RAISE EXCEPTION 'A moderation-blocked asset cannot be frozen as a Story Take reference'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_take_references_asset_moderation_guard_trg"
BEFORE INSERT ON "story_film_take_references"
FOR EACH ROW EXECUTE FUNCTION "story_take_reference_asset_moderation_guard"();
CREATE TRIGGER "story_film_trailer_take_references_asset_moderation_guard_trg"
BEFORE INSERT ON "story_film_trailer_take_references"
FOR EACH ROW EXECUTE FUNCTION "story_take_reference_asset_moderation_guard"();

CREATE FUNCTION "story_reference_approval_asset_moderation_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  asset_moderation "MediaAssetModerationStatus";
BEGIN
  SELECT a."moderation_status" INTO asset_moderation
  FROM "story_film_reference_versions" v
  JOIN "media_assets" a ON a."id" = v."asset_id"
  WHERE v."id" = NEW."reference_version_id";
  IF asset_moderation = 'blocked'::"MediaAssetModerationStatus" THEN
    RAISE EXCEPTION 'A moderation-blocked ReferenceVersion cannot be approved'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_reference_approvals_asset_moderation_guard_trg"
BEFORE INSERT ON "story_film_reference_approvals"
FOR EACH ROW EXECUTE FUNCTION "story_reference_approval_asset_moderation_guard"();

CREATE FUNCTION "story_reference_pointer_asset_moderation_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  asset_moderation "MediaAssetModerationStatus";
BEGIN
  IF NEW."approved_version_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT a."moderation_status" INTO asset_moderation
  FROM "story_film_reference_versions" v
  JOIN "media_assets" a ON a."id" = v."asset_id"
  WHERE v."id" = NEW."approved_version_id";
  IF asset_moderation = 'blocked'::"MediaAssetModerationStatus" THEN
    RAISE EXCEPTION 'A moderation-blocked ReferenceVersion cannot be selected for a Slot'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_reference_slots_asset_moderation_guard_trg"
BEFORE INSERT OR UPDATE OF "approved_version_id" ON "story_film_reference_slots"
FOR EACH ROW EXECUTE FUNCTION "story_reference_pointer_asset_moderation_guard"();

CREATE FUNCTION "story_take_approval_output_moderation_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  asset_moderation "MediaAssetModerationStatus";
BEGIN
  IF TG_TABLE_NAME = 'story_film_take_approvals' THEN
    SELECT a."moderation_status" INTO asset_moderation
    FROM "story_film_takes" t
    JOIN "media_assets" a ON a."id" = t."output_asset_id"
    WHERE t."id" = NEW."take_id";
  ELSE
    SELECT a."moderation_status" INTO asset_moderation
    FROM "story_film_trailer_takes" t
    JOIN "media_assets" a ON a."id" = t."output_asset_id"
    WHERE t."id" = NEW."take_id";
  END IF;
  IF asset_moderation = 'blocked'::"MediaAssetModerationStatus" THEN
    RAISE EXCEPTION 'A moderation-blocked Story Take output cannot be approved'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_take_approvals_output_moderation_guard_trg"
BEFORE INSERT ON "story_film_take_approvals"
FOR EACH ROW EXECUTE FUNCTION "story_take_approval_output_moderation_guard"();
CREATE TRIGGER "story_film_trailer_take_approvals_output_moderation_guard_trg"
BEFORE INSERT ON "story_film_trailer_take_approvals"
FOR EACH ROW EXECUTE FUNCTION "story_take_approval_output_moderation_guard"();

CREATE FUNCTION "story_master_output_moderation_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  asset_moderation "MediaAssetModerationStatus";
BEGIN
  IF NEW."master_take_id" IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'story_film_clips' THEN
    SELECT a."moderation_status" INTO asset_moderation
    FROM "story_film_takes" t
    JOIN "media_assets" a ON a."id" = t."output_asset_id"
    WHERE t."id" = NEW."master_take_id";
  ELSE
    SELECT a."moderation_status" INTO asset_moderation
    FROM "story_film_trailer_takes" t
    JOIN "media_assets" a ON a."id" = t."output_asset_id"
    WHERE t."id" = NEW."master_take_id";
  END IF;
  IF asset_moderation = 'blocked'::"MediaAssetModerationStatus" THEN
    RAISE EXCEPTION 'A moderation-blocked Story Take output cannot become Master'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_clips_master_output_moderation_guard_trg"
BEFORE INSERT OR UPDATE OF "master_take_id" ON "story_film_clips"
FOR EACH ROW EXECUTE FUNCTION "story_master_output_moderation_guard"();
CREATE TRIGGER "story_film_trailers_master_output_moderation_guard_trg"
BEFORE INSERT OR UPDATE OF "master_take_id" ON "story_film_trailers"
FOR EACH ROW EXECUTE FUNCTION "story_master_output_moderation_guard"();

-- A new block decision invalidates every Story production surface in the same
-- moderation transaction. Clearing the approved Slot pointer invokes the
-- existing reference invalidation trigger, which clears production manifests
-- and Masters for all bound Clips and Trailers.
CREATE FUNCTION "story_media_block_invalidate_production"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."moderation_status" <> 'blocked'::"MediaAssetModerationStatus"
     OR OLD."moderation_status" = 'blocked'::"MediaAssetModerationStatus" THEN
    RETURN NULL;
  END IF;

  UPDATE "story_film_reference_slots" s
  SET "approved_version_id" = NULL,
      "version" = s."version" + 1,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE EXISTS (
    SELECT 1 FROM "story_film_reference_versions" v
    WHERE v."id" = s."approved_version_id" AND v."asset_id" = NEW."id"
  );

  UPDATE "story_film_clips" c
  SET "master_take_id" = NULL,
      "master_revision" = c."master_revision" + 1,
      "master_selected_by_user_id" = NULL,
      "master_selected_at" = NULL,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE c."master_take_id" IN (
    SELECT t."id" FROM "story_film_takes" t
    WHERE t."output_asset_id" = NEW."id"
  );

  UPDATE "story_film_trailers" t
  SET "master_take_id" = NULL,
      "master_revision" = t."master_revision" + 1,
      "version" = t."version" + 1,
      "master_selected_by_user_id" = NULL,
      "master_selected_at" = NULL,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE t."master_take_id" IN (
    SELECT tt."id" FROM "story_film_trailer_takes" tt
    WHERE tt."output_asset_id" = NEW."id"
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER "media_assets_story_production_invalidation_trg"
AFTER UPDATE OF "moderation_status" ON "media_assets"
FOR EACH ROW EXECUTE FUNCTION "story_media_block_invalidate_production"();

-- Trailer approval is an editorial decision. `textReadability = na` is valid
-- only for an output with no on-screen text; every other mandatory dimension
-- must pass. Reviewers make that visual determination on the produced Take.
ALTER TABLE "story_film_trailer_take_reviews"
  DROP CONSTRAINT "story_film_trailer_take_reviews_approve_chk";
ALTER TABLE "story_film_trailer_take_reviews"
  ADD CONSTRAINT "story_film_trailer_take_reviews_approve_chk" CHECK (
    "decision" <> 'approve' OR (
      "technical_passed" AND "safety_passed" AND
      "checklist"->>'technical' = 'pass' AND
      "checklist"->>'storyFidelity' = 'pass' AND
      "checklist"->>'identityConsistency' = 'pass' AND
      "checklist"->>'visualConsistency' = 'pass' AND
      "checklist"->>'pacing' = 'pass' AND
      "checklist"->>'textReadability' IN ('pass', 'na') AND
      "checklist"->>'rights' = 'pass' AND
      "checklist"->>'safety' = 'pass'
    )
  );

CREATE FUNCTION "story_trailer_editorial_approval_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  review_checklist JSONB;
BEGIN
  SELECT "checklist" INTO review_checklist
  FROM "story_film_trailer_take_reviews"
  WHERE "id" = NEW."review_id" AND "take_id" = NEW."take_id";
  IF review_checklist IS NULL
     OR review_checklist->>'technical' <> 'pass'
     OR review_checklist->>'storyFidelity' <> 'pass'
     OR review_checklist->>'identityConsistency' <> 'pass'
     OR review_checklist->>'visualConsistency' <> 'pass'
     OR review_checklist->>'pacing' <> 'pass'
     OR review_checklist->>'textReadability' NOT IN ('pass', 'na')
     OR review_checklist->>'rights' <> 'pass'
     OR review_checklist->>'safety' <> 'pass' THEN
    RAISE EXCEPTION 'Trailer Take Approval requires every mandatory editorial check to pass'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_trailer_take_approvals_editorial_guard_trg"
BEFORE INSERT ON "story_film_trailer_take_approvals"
FOR EACH ROW EXECUTE FUNCTION "story_trailer_editorial_approval_guard"();
