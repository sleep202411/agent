-- One generation job represents exactly one immutable StoryFilmTake.
-- Retry creates a new Take and a new AiJob; it never reuses either row.
CREATE UNIQUE INDEX "story_film_takes_ai_job_unique"
ON "story_film_takes" ("ai_job_id");

ALTER TABLE "story_film_takes"
ADD COLUMN "submission_key" VARCHAR(240);

-- Existing local fixture rows predate the production API. Preserve them with
-- deterministic audit keys before making the submission contract required.
UPDATE "story_film_takes"
SET "submission_key" = 'legacy:' || "id"::text
WHERE "submission_key" IS NULL;

ALTER TABLE "story_film_takes"
ALTER COLUMN "submission_key" SET NOT NULL;

CREATE UNIQUE INDEX "story_film_takes_submission_key_unique"
ON "story_film_takes" ("submission_key");

CREATE FUNCTION "story_take_submission_key_immutable"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."submission_key" IS DISTINCT FROM OLD."submission_key" THEN
    RAISE EXCEPTION 'StoryFilmTake submissionKey is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_film_takes_submission_key_immutable_trg"
BEFORE UPDATE OF "submission_key" ON "story_film_takes"
FOR EACH ROW EXECUTE FUNCTION "story_take_submission_key_immutable"();
