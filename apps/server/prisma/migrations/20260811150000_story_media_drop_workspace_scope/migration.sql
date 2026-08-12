-- Story media guards no longer require the asset to live in the project's workspace.
--
-- Uploads never record one: the client omits `x-fizz-workspace-id`, the server
-- stores null, and `asset.workspace_id = project.workspace_id` can never match a
-- null. 4,210 uploaded assets were therefore unusable — a creator could see a
-- clip sitting ready on their own canvas and be told it was not.
--
-- The application-side checks were dropped first (candidate media, cover
-- selection, cover publishing, video production). These three triggers carried
-- the same predicate, so the wall simply moved: adding a candidate succeeded and
-- selecting it as the current video failed with a bare `Internal server error`,
-- which is worse than the message it replaced.
--
-- Workspace equality was never the control that mattered here. Every write that
-- reaches these triggers has already passed `requireScopedProject`, which
-- decides whether the caller may edit that story project, and the asset id can
-- only come from that project's own canvas. Every other guarantee these guards
-- make is untouched: kind, ready status, moderation, soft-delete, variant
-- identity (checksum / content type / duration / dimensions) and an active
-- placement are all still required.
--
-- Bodies below are the live definitions read back with pg_get_functiondef, with
-- exactly one line removed from each, so nothing else can drift by transcription.

CREATE OR REPLACE FUNCTION public.story_video_selection_media_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."current_asset_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "story_projects" AS project
    JOIN "media_assets" AS asset
      ON asset."id" = NEW."current_asset_id"
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
      AND variant."content_type" ~* '^video/'
      AND variant."checksum_sha256"
        IS NOT DISTINCT FROM NEW."current_checksum_sha256"
      AND variant."content_type" = NEW."current_content_type"
      AND variant."duration_ms"
        IS NOT DISTINCT FROM NEW."current_duration_ms"
      AND variant."width" IS NOT DISTINCT FROM NEW."current_width"
      AND variant."height" IS NOT DISTINCT FROM NEW."current_height"
      AND EXISTS (
        SELECT 1
        FROM "media_object_placements" AS placement
        WHERE placement."asset_id" = NEW."current_asset_id"
          AND placement."variant_id" = NEW."current_variant_id"
          AND placement."status" = 'active'
          AND placement."deleted_at" IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'STORY_VIDEO_SELECTION_MEDIA_INVALID: current video must be one active ready video variant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.story_video_reference_approval_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM 1
  FROM "story_reference_versions"
  WHERE "id" = NEW."reference_version_id"
  FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1
    FROM "story_reference_reviews" AS review
    JOIN "story_reference_versions" AS version
      ON version."id" = NEW."reference_version_id"
    JOIN "story_projects" AS project
      ON project."id" = version."story_project_id"
    JOIN "media_assets" AS asset
      ON asset."id" = version."asset_id"
    JOIN "media_asset_variants" AS variant
      ON variant."id" = version."variant_id"
     AND variant."asset_id" = asset."id"
    WHERE review."id" = NEW."review_id"
      AND review."reference_version_id" = NEW."reference_version_id"
      AND review."decision" = 'approve'
      AND review."technical_passed"
      AND review."safety_passed"
      AND review."sequence" = version."review_revision"
      AND review."checklist"->>'technical' = 'pass'
      AND review."checklist"->>'rights' = 'pass'
      AND review."checklist"->>'safety' = 'pass'
      AND review."checklist"->>'identityContinuity' <> 'fail'
      AND version."status" = 'ready'
      AND asset."kind" = 'image'
      AND asset."status" = 'ready'
      AND asset."moderation_status" <> 'blocked'
      AND asset."deleted_at" IS NULL
      AND variant."status" = 'ready'
      AND variant."deleted_at" IS NULL
      AND variant."checksum_sha256" = version."checksum_sha256"
      AND EXISTS (
        SELECT 1
        FROM "media_object_placements" AS placement
        WHERE placement."asset_id" = version."asset_id"
          AND placement."variant_id" = version."variant_id"
          AND placement."status" = 'active'
          AND placement."deleted_at" IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'STORY_REFERENCE_APPROVAL_INVALID: approval requires the latest passing review and exact usable reference media'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.story_video_approved_pointer_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  previous_version_number INTEGER;
  next_version_number INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."approved_version_id" IS NOT NULL THEN
    IF NEW."approved_version_id" IS NULL THEN
      RAISE EXCEPTION 'STORY_REFERENCE_APPROVED_POINTER_REVERSE: an approved pointer cannot be cleared'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."approved_version_id" IS DISTINCT FROM OLD."approved_version_id" THEN
      SELECT "version_number" INTO previous_version_number
      FROM "story_reference_versions"
      WHERE "id" = OLD."approved_version_id";
      SELECT "version_number" INTO next_version_number
      FROM "story_reference_versions"
      WHERE "id" = NEW."approved_version_id";
      IF next_version_number IS NULL
         OR previous_version_number IS NULL
         OR next_version_number <= previous_version_number THEN
        RAISE EXCEPTION 'STORY_REFERENCE_APPROVED_POINTER_REVERSE: replacement must advance to a newer approved version'
          USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;

  IF NEW."approved_version_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "story_reference_versions" AS version
    JOIN "story_reference_approvals" AS approval
      ON approval."reference_version_id" = version."id"
    JOIN "story_projects" AS project
      ON project."id" = version."story_project_id"
    JOIN "media_assets" AS asset
      ON asset."id" = version."asset_id"
    JOIN "media_asset_variants" AS variant
      ON variant."id" = version."variant_id"
     AND variant."asset_id" = asset."id"
    WHERE version."id" = NEW."approved_version_id"
      AND version."reference_slot_id" = NEW."id"
      AND version."story_project_id" = NEW."story_project_id"
      AND version."status" = 'ready'
      AND asset."kind" = 'image'
      AND asset."status" = 'ready'
      AND asset."moderation_status" <> 'blocked'
      AND asset."deleted_at" IS NULL
      AND variant."status" = 'ready'
      AND variant."deleted_at" IS NULL
      AND variant."checksum_sha256" = version."checksum_sha256"
      AND EXISTS (
        SELECT 1
        FROM "media_object_placements" AS placement
        WHERE placement."asset_id" = version."asset_id"
          AND placement."variant_id" = version."variant_id"
          AND placement."status" = 'active'
          AND placement."deleted_at" IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'STORY_REFERENCE_APPROVED_POINTER_INVALID: pointer must target an approved ready exact version of this slot'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
