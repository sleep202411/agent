-- Durable creator-only draft release intent.
--
-- The public publication lifecycle remains unchanged. Draft delivery has its
-- own receipt because it neither authorizes anonymous media nor participates
-- in Java's player-current authority. The exact immutable request is claimed
-- under the Story project write fence before any Java POST.

BEGIN;

CREATE TABLE "story_experience_draft_releases" (
  "id" UUID NOT NULL,
  "build_id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "game_id" VARCHAR(160) NOT NULL,
  "content_version" VARCHAR(160) NOT NULL,
  "request_hash" VARCHAR(64) NOT NULL,
  "status" "StoryExperiencePublicationStatus" NOT NULL DEFAULT 'pending',
  "requested_by_user_id" VARCHAR(64) NOT NULL,
  "manifest_url" TEXT,
  "confirmed_at" TIMESTAMPTZ(6),
  "rejected_at" TIMESTAMPTZ(6),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "first_attempt_at" TIMESTAMPTZ(6),
  "last_attempt_at" TIMESTAMPTZ(6),
  "next_attempt_at" TIMESTAMPTZ(6),
  "last_attempted_by_user_id" VARCHAR(64),
  "lease_owner" VARCHAR(160),
  "lease_acquired_at" TIMESTAMPTZ(6),
  "lease_expires_at" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(128),
  "last_error_detail" TEXT,
  "last_error_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_experience_draft_releases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_experience_draft_releases_identity_chk" CHECK (
    btrim("game_id") <> '' AND
    btrim("content_version") <> '' AND
    btrim("requested_by_user_id") <> '' AND
    "request_hash" ~ '^[0-9a-f]{64}$' AND
    (
      "last_attempted_by_user_id" IS NULL OR
      btrim("last_attempted_by_user_id") <> ''
    )
  ),
  CONSTRAINT "story_experience_draft_releases_manifest_url_chk" CHECK (
    "manifest_url" IS NULL OR "manifest_url" ~* '^https?://'
  ),
  CONSTRAINT "story_experience_draft_releases_time_order_chk" CHECK (
    "updated_at" >= "created_at" AND
    ("first_attempt_at" IS NULL OR "first_attempt_at" >= "created_at") AND
    ("last_attempt_at" IS NULL OR "last_attempt_at" >= "first_attempt_at") AND
    ("confirmed_at" IS NULL OR "confirmed_at" >= "first_attempt_at") AND
    ("rejected_at" IS NULL OR "rejected_at" >= "first_attempt_at") AND
    ("last_error_at" IS NULL OR "last_error_at" >= "first_attempt_at")
  ),
  CONSTRAINT "story_experience_draft_releases_status_shape_chk" CHECK (
    (
      "status" = 'confirmed' AND
      "manifest_url" IS NOT NULL AND
      "confirmed_at" IS NOT NULL AND
      "rejected_at" IS NULL
    ) OR (
      "status" = 'rejected' AND
      "manifest_url" IS NULL AND
      "confirmed_at" IS NULL AND
      "rejected_at" IS NOT NULL
    ) OR (
      "status" IN ('pending', 'uncertain') AND
      "manifest_url" IS NULL AND
      "confirmed_at" IS NULL AND
      "rejected_at" IS NULL
    )
  ),
  CONSTRAINT "story_experience_draft_releases_attempt_shape_chk" CHECK (
    "attempt_count" >= 0 AND
    (
      (
        "attempt_count" = 0 AND
        "first_attempt_at" IS NULL AND
        "last_attempt_at" IS NULL AND
        "last_attempted_by_user_id" IS NULL
      ) OR (
        "attempt_count" > 0 AND
        "first_attempt_at" IS NOT NULL AND
        "last_attempt_at" IS NOT NULL AND
        "last_attempted_by_user_id" IS NOT NULL
      )
    ) AND
    ("status" = 'pending' OR "attempt_count" > 0)
  ),
  CONSTRAINT "story_experience_draft_releases_lease_shape_chk" CHECK (
    (
      "lease_owner" IS NULL AND
      "lease_acquired_at" IS NULL AND
      "lease_expires_at" IS NULL
    ) OR (
      "lease_owner" IS NOT NULL AND
      btrim("lease_owner") <> '' AND
      "lease_acquired_at" IS NOT NULL AND
      "lease_expires_at" > "lease_acquired_at" AND
      "status" IN ('pending', 'uncertain') AND
      "attempt_count" > 0
    )
  ),
  CONSTRAINT "story_experience_draft_releases_terminal_work_chk" CHECK (
    "status" IN ('pending', 'uncertain') OR (
      "next_attempt_at" IS NULL AND
      "lease_owner" IS NULL AND
      "lease_acquired_at" IS NULL AND
      "lease_expires_at" IS NULL
    )
  ),
  CONSTRAINT "story_experience_draft_releases_retry_schedule_chk" CHECK (
    "next_attempt_at" IS NULL OR "status" IN ('pending', 'uncertain')
  ),
  CONSTRAINT "story_experience_draft_releases_error_shape_chk" CHECK (
    (
      "last_error_at" IS NULL AND
      "last_error_code" IS NULL AND
      "last_error_detail" IS NULL
    ) OR (
      "last_error_at" IS NOT NULL AND
      "last_error_detail" IS NOT NULL AND
      btrim("last_error_detail") <> '' AND
      ("last_error_code" IS NULL OR btrim("last_error_code") <> '')
    )
  ),
  CONSTRAINT "story_experience_draft_releases_terminal_error_chk" CHECK (
    "status" NOT IN ('uncertain', 'rejected') OR "last_error_at" IS NOT NULL
  ),
  CONSTRAINT "story_experience_draft_releases_error_attempt_chk" CHECK (
    "last_error_at" IS NULL OR "attempt_count" > 0
  )
);

CREATE UNIQUE INDEX "story_experience_draft_releases_build_id_key"
  ON "story_experience_draft_releases" ("build_id");
CREATE UNIQUE INDEX "story_experience_draft_releases_build_scope_unique"
  ON "story_experience_draft_releases" ("build_id", "story_project_id");
CREATE UNIQUE INDEX "story_experience_draft_releases_game_version_unique"
  ON "story_experience_draft_releases" ("game_id", "content_version");
CREATE INDEX "story_experience_draft_releases_project_recent_idx"
  ON "story_experience_draft_releases" (
    "story_project_id", "status", "created_at" DESC
  );
CREATE INDEX "story_experience_draft_releases_retry_idx"
  ON "story_experience_draft_releases" (
    "status", "next_attempt_at", "lease_expires_at"
  );

ALTER TABLE "story_experience_draft_releases"
  ADD CONSTRAINT "story_experience_draft_releases_build_scope_fkey"
  FOREIGN KEY ("build_id", "story_project_id")
  REFERENCES "story_builds" ("id", "story_project_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_experience_draft_releases_project_id_fkey"
  FOREIGN KEY ("story_project_id")
  REFERENCES "story_projects" ("id") ON DELETE RESTRICT;

CREATE FUNCTION "story_experience_draft_release_insert_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  build_row "story_builds"%ROWTYPE;
BEGIN
  SELECT * INTO build_row
  FROM "story_builds"
  WHERE "id" = NEW."build_id"
    AND "story_project_id" = NEW."story_project_id"
  FOR SHARE;

  IF build_row."id" IS NULL
     OR build_row."status" <> 'ready'
     OR build_row."kind" <> 'production'
     OR build_row."scope"->>'kind' IS DISTINCT FROM 'full'
     OR build_row."runtime_schema_version" <> 2
     OR build_row."runtime_json"->>'channel' IS DISTINCT FROM 'production'
     OR build_row."runtime_json"->>'buildId' IS DISTINCT FROM NEW."build_id"::text
     OR build_row."runtime_json"->>'gameId' IS DISTINCT FROM NEW."game_id"
     OR build_row."runtime_json"->>'contentVersion' IS DISTINCT FROM NEW."content_version" THEN
    RAISE EXCEPTION 'Experience draft release must match a ready full production Runtime Manifest v2 Build'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" <> 'pending'
     OR NEW."attempt_count" <> 0
     OR NEW."manifest_url" IS NOT NULL
     OR NEW."confirmed_at" IS NOT NULL
     OR NEW."rejected_at" IS NOT NULL
     OR NEW."next_attempt_at" IS NOT NULL
     OR NEW."lease_owner" IS NOT NULL
     OR NEW."last_error_at" IS NOT NULL THEN
    RAISE EXCEPTION 'Experience draft release must be inserted as a pending exact-request receipt'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION "story_experience_draft_release_update_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."build_id" IS DISTINCT FROM OLD."build_id"
     OR NEW."story_project_id" IS DISTINCT FROM OLD."story_project_id"
     OR NEW."game_id" IS DISTINCT FROM OLD."game_id"
     OR NEW."content_version" IS DISTINCT FROM OLD."content_version"
     OR NEW."request_hash" IS DISTINCT FROM OLD."request_hash"
     OR NEW."requested_by_user_id" IS DISTINCT FROM OLD."requested_by_user_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Experience draft release identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" IN ('confirmed', 'rejected')
     AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'Terminal Experience draft release status is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."manifest_url" IS NOT NULL
     AND NEW."manifest_url" IS DISTINCT FROM OLD."manifest_url" THEN
    RAISE EXCEPTION 'Confirmed Experience draft Manifest URL is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."confirmed_at" IS NOT NULL
     AND NEW."confirmed_at" IS DISTINCT FROM OLD."confirmed_at" THEN
    RAISE EXCEPTION 'Experience draft confirmation time is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."rejected_at" IS NOT NULL
     AND NEW."rejected_at" IS DISTINCT FROM OLD."rejected_at" THEN
    RAISE EXCEPTION 'Experience draft rejection time is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."attempt_count" < OLD."attempt_count"
     OR (
       OLD."first_attempt_at" IS NOT NULL AND
       NEW."first_attempt_at" IS DISTINCT FROM OLD."first_attempt_at"
     )
     OR (
       OLD."last_attempt_at" IS NOT NULL AND
       NEW."last_attempt_at" < OLD."last_attempt_at"
     ) THEN
    RAISE EXCEPTION 'Experience draft release attempts are append-only'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" IN ('confirmed', 'rejected')
     AND ROW(
       NEW."attempt_count",
       NEW."first_attempt_at",
       NEW."last_attempt_at",
       NEW."next_attempt_at",
       NEW."last_attempted_by_user_id",
       NEW."lease_owner",
       NEW."lease_acquired_at",
       NEW."lease_expires_at",
       NEW."last_error_code",
       NEW."last_error_detail",
       NEW."last_error_at"
     ) IS DISTINCT FROM ROW(
       OLD."attempt_count",
       OLD."first_attempt_at",
       OLD."last_attempt_at",
       OLD."next_attempt_at",
       OLD."last_attempted_by_user_id",
       OLD."lease_owner",
       OLD."lease_acquired_at",
       OLD."lease_expires_at",
       OLD."last_error_code",
       OLD."last_error_detail",
       OLD."last_error_at"
     ) THEN
    RAISE EXCEPTION 'Terminal Experience draft release history is immutable'
      USING ERRCODE = '55000';
  END IF;

  -- uncertain -> rejected is safe: the reconciliation replay re-sends the
  -- exact immutable request, so a deterministic Java rejection of the replay
  -- proves the original POST never committed. Without it a receipt wedged
  -- 'uncertain' by a deterministic rejection could never terminate (DELETE is
  -- forbidden, identity is immutable, build_id is unique).
  IF NOT (
    NEW."status" = OLD."status" OR
    (
      OLD."status" = 'pending' AND
      NEW."status" IN ('confirmed', 'uncertain', 'rejected')
    ) OR (
      OLD."status" = 'uncertain' AND
      NEW."status" IN ('confirmed', 'rejected')
    )
  ) THEN
    RAISE EXCEPTION 'Invalid Experience draft release lifecycle transition: % -> %',
      OLD."status", NEW."status"
      USING ERRCODE = '23514';
  END IF;

  NEW."updated_at" := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE FUNCTION "story_experience_draft_release_delete_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Experience draft release receipts cannot be deleted'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "story_experience_draft_releases_insert_guard_trg"
BEFORE INSERT ON "story_experience_draft_releases"
FOR EACH ROW EXECUTE FUNCTION "story_experience_draft_release_insert_guard"();

CREATE TRIGGER "story_experience_draft_releases_update_guard_trg"
BEFORE UPDATE ON "story_experience_draft_releases"
FOR EACH ROW EXECUTE FUNCTION "story_experience_draft_release_update_guard"();

CREATE TRIGGER "story_experience_draft_releases_no_delete_trg"
BEFORE DELETE ON "story_experience_draft_releases"
FOR EACH ROW EXECUTE FUNCTION "story_experience_draft_release_delete_guard"();

COMMIT;
