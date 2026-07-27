-- Composer attachment cleanup is its own durable lifecycle. Production status
-- (pending/ready/failed) describes whether an artifact can be consumed; these
-- states describe storage reclamation after an unbound upload is abandoned.
CREATE TYPE "StudioAgentArtifactCleanupStatus" AS ENUM (
  'active',
  'scheduled',
  'leased',
  'cleaned',
  'dead_letter'
);

CREATE TYPE "StudioAgentArtifactCleanupReason" AS ENUM (
  'user_abandoned',
  'expired'
);

ALTER TABLE "studio_agent_artifacts"
  ADD COLUMN "cleanup_status" "StudioAgentArtifactCleanupStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "cleanup_reason" "StudioAgentArtifactCleanupReason",
  ADD COLUMN "cleanup_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "cleanup_requested_at" TIMESTAMPTZ(6),
  ADD COLUMN "cleanup_next_attempt_at" TIMESTAMPTZ(6),
  ADD COLUMN "cleanup_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cleanup_lease_token" UUID,
  ADD COLUMN "cleanup_lease_owner" VARCHAR(240),
  ADD COLUMN "cleanup_lease_acquired_at" TIMESTAMPTZ(6),
  ADD COLUMN "cleanup_lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "cleanup_completed_at" TIMESTAMPTZ(6),
  ADD COLUMN "cleanup_last_error_code" VARCHAR(96),
  ADD COLUMN "cleanup_last_error_detail" TEXT;

-- Existing unbound composer images become reclaimable. Generated artifacts
-- and anything already bound to a message/run/action remain active without an
-- automatic expiry.
UPDATE "studio_agent_artifacts" AS artifact
SET "cleanup_expires_at" = artifact."created_at" + INTERVAL '24 hours'
FROM "media_assets" AS asset
WHERE artifact."media_asset_id" = asset."id"
  AND artifact."message_id" IS NULL
  AND artifact."run_id" IS NULL
  AND artifact."action_id" IS NULL
  AND asset."metadata"->>'uploadKind' = 'studio_agent_image';

ALTER TABLE "studio_agent_artifacts"
  ADD CONSTRAINT "studio_agent_artifacts_cleanup_attempt_nonnegative"
    CHECK ("cleanup_attempt_count" >= 0),
  ADD CONSTRAINT "studio_agent_artifacts_cleanup_state_consistent"
    CHECK (
      (
        "cleanup_status" = 'active'
        AND "cleanup_reason" IS NULL
        AND "cleanup_requested_at" IS NULL
        AND "cleanup_next_attempt_at" IS NULL
        AND "cleanup_lease_token" IS NULL
        AND "cleanup_lease_owner" IS NULL
        AND "cleanup_lease_acquired_at" IS NULL
        AND "cleanup_lease_expires_at" IS NULL
        AND "cleanup_completed_at" IS NULL
      )
      OR
      (
        "cleanup_status" = 'scheduled'
        AND "cleanup_reason" IS NOT NULL
        AND "cleanup_requested_at" IS NOT NULL
        AND "cleanup_next_attempt_at" IS NOT NULL
        AND "cleanup_lease_token" IS NULL
        AND "cleanup_lease_owner" IS NULL
        AND "cleanup_lease_acquired_at" IS NULL
        AND "cleanup_lease_expires_at" IS NULL
        AND "cleanup_completed_at" IS NULL
      )
      OR
      (
        "cleanup_status" = 'leased'
        AND "cleanup_reason" IS NOT NULL
        AND "cleanup_requested_at" IS NOT NULL
        AND "cleanup_next_attempt_at" IS NOT NULL
        AND "cleanup_lease_token" IS NOT NULL
        AND "cleanup_lease_owner" IS NOT NULL
        AND "cleanup_lease_acquired_at" IS NOT NULL
        AND "cleanup_lease_expires_at" IS NOT NULL
        AND "cleanup_completed_at" IS NULL
      )
      OR
      (
        "cleanup_status" = 'cleaned'
        AND "cleanup_reason" IS NOT NULL
        AND "cleanup_requested_at" IS NOT NULL
        AND "cleanup_lease_token" IS NULL
        AND "cleanup_lease_owner" IS NULL
        AND "cleanup_lease_acquired_at" IS NULL
        AND "cleanup_lease_expires_at" IS NULL
        AND "cleanup_completed_at" IS NOT NULL
      )
      OR
      (
        "cleanup_status" = 'dead_letter'
        AND "cleanup_reason" IS NOT NULL
        AND "cleanup_requested_at" IS NOT NULL
        AND "cleanup_lease_token" IS NULL
        AND "cleanup_lease_owner" IS NULL
        AND "cleanup_lease_acquired_at" IS NULL
        AND "cleanup_lease_expires_at" IS NULL
        AND "cleanup_completed_at" IS NULL
        AND "cleanup_last_error_code" IS NOT NULL
      )
    ),
  ADD CONSTRAINT "studio_agent_artifacts_bound_cleanup_active"
    CHECK (
      (
        "message_id" IS NULL
        AND "run_id" IS NULL
        AND "action_id" IS NULL
      )
      OR "cleanup_status" = 'active'
    );

CREATE INDEX "studio_agent_artifacts_cleanup_due_idx"
ON "studio_agent_artifacts" (
  "cleanup_status",
  "cleanup_next_attempt_at",
  "cleanup_expires_at",
  "created_at",
  "id"
);

CREATE INDEX "studio_agent_artifacts_cleanup_stale_lease_idx"
ON "studio_agent_artifacts" ("cleanup_lease_expires_at");

CREATE TABLE "studio_agent_orphan_media_cleanup_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "media_asset_id" UUID NOT NULL,
  "status" "StudioAgentArtifactCleanupStatus" NOT NULL DEFAULT 'scheduled',
  "not_before" TIMESTAMPTZ(6) NOT NULL,
  "next_attempt_at" TIMESTAMPTZ(6),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "lease_token" UUID,
  "lease_owner" VARCHAR(240),
  "lease_acquired_at" TIMESTAMPTZ(6),
  "lease_expires_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(96),
  "last_error_detail" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "studio_agent_orphan_media_cleanup_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "studio_agent_orphan_media_cleanup_attempt_nonnegative"
    CHECK ("attempt_count" >= 0),
  CONSTRAINT "studio_agent_orphan_media_cleanup_state_consistent"
    CHECK (
      (
        "status" = 'scheduled'
        AND "next_attempt_at" IS NOT NULL
        AND "lease_token" IS NULL
        AND "lease_owner" IS NULL
        AND "lease_acquired_at" IS NULL
        AND "lease_expires_at" IS NULL
        AND "completed_at" IS NULL
      )
      OR
      (
        "status" = 'leased'
        AND "next_attempt_at" IS NOT NULL
        AND "lease_token" IS NOT NULL
        AND "lease_owner" IS NOT NULL
        AND "lease_acquired_at" IS NOT NULL
        AND "lease_expires_at" IS NOT NULL
        AND "completed_at" IS NULL
      )
      OR
      (
        "status" = 'cleaned'
        AND "next_attempt_at" IS NULL
        AND "lease_token" IS NULL
        AND "lease_owner" IS NULL
        AND "lease_acquired_at" IS NULL
        AND "lease_expires_at" IS NULL
        AND "completed_at" IS NOT NULL
      )
      OR
      (
        "status" = 'dead_letter'
        AND "next_attempt_at" IS NULL
        AND "lease_token" IS NULL
        AND "lease_owner" IS NULL
        AND "lease_acquired_at" IS NULL
        AND "lease_expires_at" IS NULL
        AND "completed_at" IS NULL
        AND "last_error_code" IS NOT NULL
      )
    ),
  CONSTRAINT "studio_agent_orphan_media_cleanup_asset_fkey"
    FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "studio_agent_orphan_media_cleanup_asset_unique"
ON "studio_agent_orphan_media_cleanup_jobs" ("media_asset_id");

CREATE INDEX "studio_agent_orphan_media_cleanup_due_idx"
ON "studio_agent_orphan_media_cleanup_jobs" (
  "status",
  "next_attempt_at",
  "created_at",
  "id"
);

CREATE INDEX "studio_agent_orphan_media_cleanup_stale_lease_idx"
ON "studio_agent_orphan_media_cleanup_jobs" ("lease_expires_at");

-- This function intentionally discovers every direct foreign-key reference
-- to media_assets instead of freezing a list that silently becomes unsafe
-- when another product adds a new media binding. Tables with a deleted_at
-- column count only live rows. The leased artifact itself is excluded.
CREATE OR REPLACE FUNCTION "studio_agent_media_asset_has_live_reference"(
  target_asset_id UUID,
  excluded_artifact_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  reference_fk RECORD;
  has_reference BOOLEAN;
BEGIN
  FOR reference_fk IN
    SELECT
      constraint_row.conrelid::regclass AS reference_table,
      attribute_row.attname AS reference_column,
      EXISTS (
        SELECT 1
        FROM pg_attribute AS deleted_attribute
        WHERE deleted_attribute.attrelid = constraint_row.conrelid
          AND deleted_attribute.attname = 'deleted_at'
          AND NOT deleted_attribute.attisdropped
      ) AS has_deleted_at
    FROM pg_constraint AS constraint_row
    JOIN pg_attribute AS attribute_row
      ON attribute_row.attrelid = constraint_row.conrelid
     AND attribute_row.attnum = constraint_row.conkey[1]
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'media_assets'::regclass
      AND cardinality(constraint_row.conkey) = 1
      AND cardinality(constraint_row.confkey) = 1
  LOOP
    -- Asset-owned storage/variant ledgers and cleanup bookkeeping are not
    -- product references and must never keep their own parent alive. Every
    -- other current or future FK remains conservative-by-default.
    IF reference_fk.reference_table IN (
       'media_asset_variants'::regclass,
       'media_object_placements'::regclass,
       'ai_provider_media_asset_mirrors'::regclass,
       'studio_agent_orphan_media_cleanup_jobs'::regclass
    ) THEN
      CONTINUE;
    ELSIF reference_fk.reference_table = 'studio_agent_artifacts'::regclass THEN
      EXECUTE format(
        'SELECT EXISTS (
          SELECT 1 FROM %s
          WHERE %I = $1
            AND ($2 IS NULL OR "id" <> $2)
            AND "cleanup_status" <> ''cleaned''
        )',
        reference_fk.reference_table,
        reference_fk.reference_column
      )
      INTO has_reference
      USING target_asset_id, excluded_artifact_id;
    ELSIF reference_fk.has_deleted_at THEN
      EXECUTE format(
        'SELECT EXISTS (
          SELECT 1 FROM %s
          WHERE %I = $1
            AND "deleted_at" IS NULL
        )',
        reference_fk.reference_table,
        reference_fk.reference_column
      )
      INTO has_reference
      USING target_asset_id;
    ELSE
      EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)',
        reference_fk.reference_table,
        reference_fk.reference_column
      )
      INTO has_reference
      USING target_asset_id;
    END IF;

    IF has_reference THEN
      RETURN TRUE;
    END IF;
  END LOOP;

  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION "studio_agent_media_asset_has_live_reference"(UUID, UUID)
IS 'Conservatively detects every live direct reference before Studio Agent attachment storage reclamation.';
