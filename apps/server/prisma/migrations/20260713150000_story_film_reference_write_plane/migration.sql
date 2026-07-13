-- Durable request idempotency for reference candidates. Existing rows predate
-- the write API, so their immutable UUID is a safe one-time legacy key.
ALTER TABLE "story_film_reference_versions"
  ADD COLUMN "submission_key" VARCHAR(240);

ALTER TABLE "story_film_reference_slots"
  ALTER COLUMN "label" TYPE VARCHAR(240);

UPDATE "story_film_reference_versions"
SET "submission_key" = 'legacy:' || "id"::text
WHERE "submission_key" IS NULL;

ALTER TABLE "story_film_reference_versions"
  ALTER COLUMN "submission_key" SET NOT NULL;

CREATE UNIQUE INDEX "story_film_reference_versions_submission_key_unique"
ON "story_film_reference_versions" ("submission_key");

CREATE FUNCTION "story_reference_version_submission_key_immutable"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."submission_key" IS DISTINCT FROM OLD."submission_key" THEN
    RAISE EXCEPTION 'StoryFilmReferenceVersion submissionKey is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_reference_versions_submission_key_immutable_trg"
BEFORE UPDATE OF "submission_key" ON "story_film_reference_versions"
FOR EACH ROW EXECUTE FUNCTION "story_reference_version_submission_key_immutable"();

-- Changing the approved asset is a production-input change for every clip
-- bound to this slot. Invalidate eagerly so the workbench can never present an
-- old Master as current between approval and the next generation request.
CREATE FUNCTION "story_reference_approval_invalidate_clips"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."approved_version_id" IS NOT DISTINCT FROM OLD."approved_version_id" THEN
    RETURN NULL;
  END IF;

  UPDATE "story_film_clips" c
  SET "production_input_manifest" = NULL,
      "production_input_hash" = NULL,
      "version" = c."version" + 1,
      "master_take_id" = NULL,
      "master_revision" = c."master_revision" +
        CASE WHEN c."master_take_id" IS NULL THEN 0 ELSE 1 END,
      "master_selected_by_user_id" = NULL,
      "master_selected_at" = NULL,
      "updated_at" = CURRENT_TIMESTAMP
  WHERE c."archived_at" IS NULL
    AND (c."production_input_hash" IS NOT NULL OR c."master_take_id" IS NOT NULL)
    AND EXISTS (
      SELECT 1
      FROM "story_film_clip_references" cr
      WHERE cr."clip_id" = c."id"
        AND cr."reference_slot_id" = NEW."id"
    );

  RETURN NULL;
END;
$$;

CREATE TRIGGER "story_film_reference_slots_approval_invalidate_clips_trg"
AFTER UPDATE OF "approved_version_id" ON "story_film_reference_slots"
FOR EACH ROW EXECUTE FUNCTION "story_reference_approval_invalidate_clips"();
