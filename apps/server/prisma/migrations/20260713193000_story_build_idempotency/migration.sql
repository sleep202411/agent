-- Durable, semantic idempotency for Story Film Build creation.

ALTER TABLE "story_builds"
  ADD COLUMN "submission_key" VARCHAR(240),
  ADD COLUMN "request_fingerprint" VARCHAR(64);

-- The product-plane migration already protects every Build UPDATE with a
-- lifecycle trigger. Drop only the trigger (not its function) while legacy
-- rows receive their one-time replay identity; otherwise terminal rows and
-- the version increment invariant would correctly reject this data migration.
-- The stricter replacement is installed again below before the migration
-- commits, so no application transaction can observe an unguarded table.
DROP TRIGGER IF EXISTS "story_builds_lifecycle_guard_trg"
ON "story_builds";

-- No Build write API existed before this migration. Refuse to pretend legacy
-- rows are replayable: if a local development database contains hand-written
-- rows, give them a unique non-client namespace while retaining their audit
-- history.
UPDATE "story_builds"
SET
  "submission_key" = 'legacy:' || "id"::text,
  "request_fingerprint" = encode(
    digest(
      concat_ws(
        ':',
        "story_project_id"::text,
        "source_revision_id"::text,
        "build_number"::text,
        "kind"::text,
        "scope"::text,
        "source_production_revision"::text
      ),
      'sha256'
    ),
    'hex'
  );

ALTER TABLE "story_builds"
  ALTER COLUMN "submission_key" SET NOT NULL,
  ALTER COLUMN "request_fingerprint" SET NOT NULL,
  ADD CONSTRAINT "story_builds_submission_key_nonempty_chk"
    CHECK (btrim("submission_key") <> ''),
  ADD CONSTRAINT "story_builds_request_fingerprint_chk"
    CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "story_builds_submission_key_key" UNIQUE ("submission_key");

-- The lifecycle guard is the Build envelope's mutability boundary. Include
-- both idempotency fields in that frozen envelope so replay identity can never
-- be rewritten after insertion (including while the Build is non-terminal).
CREATE OR REPLACE FUNCTION "story_build_lifecycle_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" IN ('ready', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'Terminal StoryBuild is immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW."story_project_id" IS DISTINCT FROM OLD."story_project_id"
     OR NEW."source_revision_id" IS DISTINCT FROM OLD."source_revision_id"
     OR NEW."build_number" IS DISTINCT FROM OLD."build_number"
     OR NEW."submission_key" IS DISTINCT FROM OLD."submission_key"
     OR NEW."request_fingerprint" IS DISTINCT FROM OLD."request_fingerprint"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."scope" IS DISTINCT FROM OLD."scope"
     OR NEW."source_production_revision" IS DISTINCT FROM OLD."source_production_revision"
     OR NEW."input_hash" IS DISTINCT FROM OLD."input_hash"
     OR NEW."input_manifest_hash" IS DISTINCT FROM OLD."input_manifest_hash"
     OR NEW."runtime_schema_version" IS DISTINCT FROM OLD."runtime_schema_version"
     OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'StoryBuild frozen input fields are immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'StoryBuild update must increment version by exactly one'
      USING ERRCODE = '23514';
  END IF;
  IF NOT (
    NEW."status" = OLD."status" OR
    (OLD."status" = 'queued' AND NEW."status" IN ('validating', 'compiling', 'ready', 'failed', 'cancelled')) OR
    (OLD."status" = 'validating' AND NEW."status" IN ('compiling', 'ready', 'failed', 'cancelled')) OR
    (OLD."status" = 'compiling' AND NEW."status" IN ('ready', 'failed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'Invalid StoryBuild status transition % -> %',
      OLD."status", NEW."status" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_builds_lifecycle_guard_trg"
BEFORE UPDATE OR DELETE ON "story_builds"
FOR EACH ROW EXECUTE FUNCTION "story_build_lifecycle_guard"();
