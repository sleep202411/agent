-- Java owns interactive-film publication, current-version authority, and the
-- CDN Manifest. Nest persists the publication lifecycle before the first Java
-- POST so retries, ambiguous responses, reconciliation, and anonymous media
-- authorization survive process crashes and page refreshes.

BEGIN;

CREATE TYPE "StoryExperiencePublicationStatus" AS ENUM (
  'pending',
  'confirmed',
  'uncertain',
  'rejected'
);

CREATE TABLE "story_experience_publications" (
  "id" UUID NOT NULL,
  "build_id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "game_id" VARCHAR(160) NOT NULL,
  "content_version" VARCHAR(160) NOT NULL,
  "status" "StoryExperiencePublicationStatus" NOT NULL DEFAULT 'pending',
  "requested_set_current" BOOLEAN NOT NULL DEFAULT TRUE,
  "requested_by_user_id" VARCHAR(64) NOT NULL,
  "media_authorized_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "media_authorization_revoked_at" TIMESTAMPTZ(6),
  "manifest_url" TEXT,
  "published_at" TIMESTAMPTZ(6),
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
  "authority_is_current" BOOLEAN,
  "authority_game_exists" BOOLEAN,
  "authority_current_version" VARCHAR(160),
  "authority_manifest_url" TEXT,
  "authority_checked_at" TIMESTAMPTZ(6),
  "reconciliation_attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_reconciliation_attempt_at" TIMESTAMPTZ(6),
  "next_reconciliation_at" TIMESTAMPTZ(6),
  "reconciliation_lease_owner" VARCHAR(160),
  "reconciliation_lease_acquired_at" TIMESTAMPTZ(6),
  "reconciliation_lease_expires_at" TIMESTAMPTZ(6),
  "last_reconciliation_error_code" VARCHAR(128),
  "last_reconciliation_error_detail" TEXT,
  "last_reconciliation_error_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_experience_publications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_experience_publications_identity_nonempty_chk" CHECK (
    btrim("game_id") <> '' AND
    btrim("content_version") <> '' AND
    btrim("requested_by_user_id") <> '' AND
    ("last_attempted_by_user_id" IS NULL OR btrim("last_attempted_by_user_id") <> '')
  ),
  CONSTRAINT "story_experience_publications_manifest_urls_chk" CHECK (
    ("manifest_url" IS NULL OR "manifest_url" ~* '^https?://') AND
    ("authority_manifest_url" IS NULL OR "authority_manifest_url" ~* '^https?://')
  ),
  CONSTRAINT "story_experience_publications_time_order_chk" CHECK (
    "media_authorized_at" >= "created_at" AND
    (
      "media_authorization_revoked_at" IS NULL OR
      "media_authorization_revoked_at" >= "media_authorized_at"
    ) AND
    "updated_at" >= "created_at" AND
    ("first_attempt_at" IS NULL OR "first_attempt_at" >= "created_at") AND
    ("last_attempt_at" IS NULL OR "last_attempt_at" >= "first_attempt_at") AND
    ("published_at" IS NULL OR "published_at" >= "first_attempt_at") AND
    ("rejected_at" IS NULL OR "rejected_at" >= "first_attempt_at") AND
    ("last_error_at" IS NULL OR "last_error_at" >= "first_attempt_at") AND
    (
      "last_reconciliation_attempt_at" IS NULL OR
      "last_reconciliation_attempt_at" >= "created_at"
    ) AND
    (
      "authority_checked_at" IS NULL OR
      "authority_checked_at" >= "last_reconciliation_attempt_at"
    ) AND
    (
      "last_reconciliation_error_at" IS NULL OR
      "last_reconciliation_error_at" >= "last_reconciliation_attempt_at"
    )
  ),
  CONSTRAINT "story_experience_publications_status_shape_chk" CHECK (
    (
      "status" = 'confirmed' AND
      "manifest_url" IS NOT NULL AND
      "published_at" IS NOT NULL AND
      "rejected_at" IS NULL AND
      "media_authorization_revoked_at" IS NULL
    ) OR (
      "status" = 'rejected' AND
      "manifest_url" IS NULL AND
      "published_at" IS NULL AND
      "rejected_at" IS NOT NULL AND
      "media_authorization_revoked_at" IS NOT NULL
    ) OR (
      "status" IN ('pending', 'uncertain') AND
      "manifest_url" IS NULL AND
      "published_at" IS NULL AND
      "rejected_at" IS NULL AND
      "media_authorization_revoked_at" IS NULL
    )
  ),
  CONSTRAINT "story_experience_publications_attempt_shape_chk" CHECK (
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
    )
  ),
  CONSTRAINT "story_experience_publications_attempted_status_chk" CHECK (
    "status" = 'pending' OR "attempt_count" > 0
  ),
  CONSTRAINT "story_experience_publications_lease_shape_chk" CHECK (
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
  CONSTRAINT "story_experience_publications_terminal_publish_work_chk" CHECK (
    "status" IN ('pending', 'uncertain') OR (
      "next_attempt_at" IS NULL AND
      "lease_owner" IS NULL AND
      "lease_acquired_at" IS NULL AND
      "lease_expires_at" IS NULL
    )
  ),
  CONSTRAINT "story_experience_publications_error_shape_chk" CHECK (
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
  CONSTRAINT "story_experience_publications_terminal_error_chk" CHECK (
    "status" NOT IN ('uncertain', 'rejected') OR "last_error_at" IS NOT NULL
  ),
  CONSTRAINT "story_experience_publications_error_attempt_chk" CHECK (
    "last_error_at" IS NULL OR "attempt_count" > 0
  ),
  CONSTRAINT "story_experience_publications_authority_shape_chk" CHECK (
    (
      "authority_checked_at" IS NULL AND
      "authority_is_current" IS NULL AND
      "authority_game_exists" IS NULL AND
      "authority_current_version" IS NULL AND
      "authority_manifest_url" IS NULL
    ) OR (
      "authority_checked_at" IS NOT NULL AND
      "authority_game_exists" = TRUE AND
      "authority_is_current" IS NOT NULL AND
      "authority_current_version" IS NOT NULL AND
      btrim("authority_current_version") <> '' AND
      "authority_manifest_url" IS NOT NULL AND
      "status" IN ('uncertain', 'confirmed') AND
      "reconciliation_attempt_count" > 0 AND
      (
        NOT "authority_is_current" OR (
          "status" = 'confirmed' AND
          "authority_current_version" = "content_version"
          )
        )
    ) OR (
      "authority_checked_at" IS NOT NULL AND
      "authority_game_exists" = FALSE AND
      "authority_is_current" = FALSE AND
      "authority_current_version" IS NULL AND
      "authority_manifest_url" IS NULL AND
      "status" IN ('uncertain', 'confirmed') AND
      "reconciliation_attempt_count" > 0
    )
  ),
  CONSTRAINT "story_experience_publications_reconciliation_attempt_chk" CHECK (
    "reconciliation_attempt_count" >= 0 AND
    (
      (
        "reconciliation_attempt_count" = 0 AND
        "last_reconciliation_attempt_at" IS NULL
      ) OR (
        "reconciliation_attempt_count" > 0 AND
        "last_reconciliation_attempt_at" IS NOT NULL AND
        "status" IN ('uncertain', 'confirmed')
      )
    )
  ),
  CONSTRAINT "story_experience_publications_reconciliation_lease_chk" CHECK (
    (
      "reconciliation_lease_owner" IS NULL AND
      "reconciliation_lease_acquired_at" IS NULL AND
      "reconciliation_lease_expires_at" IS NULL
    ) OR (
      "reconciliation_lease_owner" IS NOT NULL AND
      btrim("reconciliation_lease_owner") <> '' AND
      "reconciliation_lease_acquired_at" IS NOT NULL AND
      "reconciliation_lease_expires_at" > "reconciliation_lease_acquired_at" AND
      "status" IN ('uncertain', 'confirmed') AND
      "reconciliation_attempt_count" > 0
    )
  ),
  CONSTRAINT "story_experience_publications_reconciliation_schedule_chk" CHECK (
    "next_reconciliation_at" IS NULL OR "status" IN ('uncertain', 'confirmed')
  ),
  CONSTRAINT "story_experience_publications_reconciliation_error_chk" CHECK (
    (
      "last_reconciliation_error_at" IS NULL AND
      "last_reconciliation_error_code" IS NULL AND
      "last_reconciliation_error_detail" IS NULL
    ) OR (
      "last_reconciliation_error_at" IS NOT NULL AND
      "last_reconciliation_error_detail" IS NOT NULL AND
      btrim("last_reconciliation_error_detail") <> '' AND
      (
        "last_reconciliation_error_code" IS NULL OR
        btrim("last_reconciliation_error_code") <> ''
      )
    )
  ),
  CONSTRAINT "story_experience_publications_reconciliation_error_attempt_chk" CHECK (
    "last_reconciliation_error_at" IS NULL OR
    "reconciliation_attempt_count" > 0
  )
);

CREATE UNIQUE INDEX "story_experience_publications_build_id_key"
  ON "story_experience_publications" ("build_id");
CREATE UNIQUE INDEX "story_experience_publications_build_scope_unique"
  ON "story_experience_publications" ("build_id", "story_project_id");
CREATE UNIQUE INDEX "story_experience_publications_game_version_unique"
  ON "story_experience_publications" ("game_id", "content_version");
CREATE INDEX "story_experience_publications_project_recent_idx"
  ON "story_experience_publications" (
    "story_project_id", "status", "created_at" DESC
  );
CREATE INDEX "story_experience_publications_project_lease_idx"
  ON "story_experience_publications" (
    "story_project_id", "status", "lease_expires_at"
  );
CREATE INDEX "story_experience_publications_publish_retry_idx"
  ON "story_experience_publications" (
    "status", "next_attempt_at", "lease_expires_at"
  );
CREATE INDEX "story_experience_publications_reconcile_retry_idx"
  ON "story_experience_publications" (
    "status", "next_reconciliation_at", "reconciliation_lease_expires_at"
  );
CREATE INDEX "story_experience_publications_authority_current_idx"
  ON "story_experience_publications" (
    "game_id", "authority_is_current", "authority_checked_at" DESC
  );

ALTER TABLE "story_experience_publications"
  ADD CONSTRAINT "story_experience_publications_build_scope_fkey"
  FOREIGN KEY ("build_id", "story_project_id")
  REFERENCES "story_builds" ("id", "story_project_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "story_experience_publications_project_id_fkey"
  FOREIGN KEY ("story_project_id")
  REFERENCES "story_projects" ("id") ON DELETE RESTRICT;

CREATE FUNCTION "story_experience_publication_insert_guard"()
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
    RAISE EXCEPTION 'Experience publication must match a ready full production Runtime Manifest v2 Build'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" <> 'pending'
     OR NEW."attempt_count" <> 0
     OR NEW."manifest_url" IS NOT NULL
     OR NEW."published_at" IS NOT NULL
     OR NEW."rejected_at" IS NOT NULL
     OR NEW."media_authorization_revoked_at" IS NOT NULL
     OR NEW."next_attempt_at" IS NOT NULL
     OR NEW."lease_owner" IS NOT NULL
     OR NEW."last_error_at" IS NOT NULL
     OR NEW."authority_checked_at" IS NOT NULL
     OR NEW."reconciliation_attempt_count" <> 0
     OR NEW."next_reconciliation_at" IS NOT NULL
     OR NEW."reconciliation_lease_owner" IS NOT NULL
     OR NEW."last_reconciliation_error_at" IS NOT NULL THEN
    RAISE EXCEPTION 'Experience publication must be inserted as a pre-authority pending lifecycle'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION "story_experience_publication_update_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."build_id" IS DISTINCT FROM OLD."build_id"
     OR NEW."story_project_id" IS DISTINCT FROM OLD."story_project_id"
     OR NEW."game_id" IS DISTINCT FROM OLD."game_id"
     OR NEW."content_version" IS DISTINCT FROM OLD."content_version"
     OR NEW."requested_set_current" IS DISTINCT FROM OLD."requested_set_current"
     OR NEW."requested_by_user_id" IS DISTINCT FROM OLD."requested_by_user_id"
     OR NEW."media_authorized_at" IS DISTINCT FROM OLD."media_authorized_at"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Experience publication identity and media authorization are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."manifest_url" IS NOT NULL
     AND NEW."manifest_url" IS DISTINCT FROM OLD."manifest_url" THEN
    RAISE EXCEPTION 'Confirmed Experience publication Manifest URL is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."published_at" IS NOT NULL
     AND NEW."published_at" IS DISTINCT FROM OLD."published_at" THEN
    RAISE EXCEPTION 'Experience publication confirmation time is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."rejected_at" IS NOT NULL
     AND NEW."rejected_at" IS DISTINCT FROM OLD."rejected_at" THEN
    RAISE EXCEPTION 'Experience publication rejection time is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."media_authorization_revoked_at" IS NOT NULL
     AND NEW."media_authorization_revoked_at" IS DISTINCT FROM OLD."media_authorization_revoked_at" THEN
    RAISE EXCEPTION 'Experience publication media authorization revocation is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."media_authorization_revoked_at" IS NULL
     AND NEW."media_authorization_revoked_at" IS NOT NULL
     AND NEW."status" <> 'rejected' THEN
    RAISE EXCEPTION 'Only a definitively rejected publication may revoke media authorization'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."first_attempt_at" IS NOT NULL
     AND NEW."first_attempt_at" IS DISTINCT FROM OLD."first_attempt_at" THEN
    RAISE EXCEPTION 'Experience publication first attempt time is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."attempt_count" < OLD."attempt_count"
     OR (
       OLD."last_attempt_at" IS NOT NULL AND
       (NEW."last_attempt_at" IS NULL OR NEW."last_attempt_at" < OLD."last_attempt_at")
     ) THEN
    RAISE EXCEPTION 'Experience publication attempt history cannot move backwards'
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
    RAISE EXCEPTION 'Terminal Experience publication attempt history is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."reconciliation_attempt_count" < OLD."reconciliation_attempt_count"
     OR (
       OLD."last_reconciliation_attempt_at" IS NOT NULL AND
       (
         NEW."last_reconciliation_attempt_at" IS NULL OR
         NEW."last_reconciliation_attempt_at" < OLD."last_reconciliation_attempt_at"
       )
     ) THEN
    RAISE EXCEPTION 'Experience publication reconciliation history cannot move backwards'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."authority_checked_at" IS NOT NULL
     AND (
       NEW."authority_checked_at" IS NULL OR
       NEW."authority_checked_at" < OLD."authority_checked_at"
     ) THEN
    RAISE EXCEPTION 'Experience publication authority observation cannot move backwards'
      USING ERRCODE = '55000';
  END IF;
  IF ROW(
       NEW."authority_is_current",
       NEW."authority_game_exists",
       NEW."authority_current_version",
       NEW."authority_manifest_url"
     ) IS DISTINCT FROM ROW(
       OLD."authority_is_current",
       OLD."authority_game_exists",
       OLD."authority_current_version",
       OLD."authority_manifest_url"
     ) AND (
       NEW."authority_checked_at" IS NULL OR
       (
         OLD."authority_checked_at" IS NOT NULL AND
         NEW."authority_checked_at" <= OLD."authority_checked_at"
       )
     ) THEN
    RAISE EXCEPTION 'A changed authority observation requires a newer checked_at time'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    NEW."status" = OLD."status" OR
    (OLD."status" = 'pending' AND NEW."status" IN ('confirmed', 'uncertain', 'rejected')) OR
    (OLD."status" = 'uncertain' AND NEW."status" = 'confirmed')
  ) THEN
    RAISE EXCEPTION 'Invalid Experience publication lifecycle transition: % -> %',
      OLD."status", NEW."status"
      USING ERRCODE = '23514';
  END IF;

  NEW."updated_at" := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_experience_publications_insert_guard_trg"
BEFORE INSERT ON "story_experience_publications"
FOR EACH ROW EXECUTE FUNCTION "story_experience_publication_insert_guard"();

CREATE TRIGGER "story_experience_publications_update_guard_trg"
BEFORE UPDATE ON "story_experience_publications"
FOR EACH ROW EXECUTE FUNCTION "story_experience_publication_update_guard"();

CREATE TRIGGER "story_experience_publications_no_delete_trg"
BEFORE DELETE ON "story_experience_publications"
FOR EACH ROW EXECUTE FUNCTION "story_prevent_mutation"();

COMMENT ON COLUMN "story_experience_publications"."media_authorized_at" IS
  'Immutable anonymous media grant created before the first Java publish request.';
COMMENT ON COLUMN "story_experience_publications"."media_authorization_revoked_at" IS
  'Append-only revocation allowed only after an explicit Java rejection.';
COMMENT ON COLUMN "story_experience_publications"."authority_is_current" IS
  'Latest reconciled Java current-version observation; NULL means not yet known.';
COMMENT ON COLUMN "story_experience_publications"."authority_game_exists" IS
  'Whether Java reported that this game exists; FALSE is an authoritative unpublished observation.';

COMMIT;
