-- Legacy Java project / episode workspace mapping.
--
-- This table is the boundary between the old Java-owned IP data and the
-- new Nest + Postgres workspace model. It does not mirror Java rows. It
-- records which workspace owns a legacy entity now, and optionally points
-- to the new PlatformProject when that entity is migrated.

CREATE TYPE "LegacyProjectSourceSystem" AS ENUM (
  'java_content',
  'java_studio'
);

CREATE TYPE "LegacyProjectEntityType" AS ENUM (
  'project',
  'episode'
);

CREATE TYPE "LegacyProjectMigrationStatus" AS ENUM (
  'mapped',
  'importing',
  'migrated',
  'failed',
  'ignored'
);

CREATE TABLE "legacy_project_workspace_maps" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "platform_project_id" UUID,
  "source_system" "LegacyProjectSourceSystem" NOT NULL,
  "entity_type" "LegacyProjectEntityType" NOT NULL,
  "legacy_entity_id" VARCHAR(64) NOT NULL,
  "legacy_parent_entity_id" VARCHAR(64),
  "owner_user_id" VARCHAR(64) NOT NULL,
  "display_name" VARCHAR(160),
  "cover_url" VARCHAR(1024),
  "migration_status" "LegacyProjectMigrationStatus" NOT NULL DEFAULT 'mapped',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "last_synced_at" TIMESTAMPTZ(6),
  "migrated_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "legacy_project_workspace_maps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "legacy_project_workspace_maps_legacy_id_nonempty"
    CHECK (btrim("legacy_entity_id") <> ''),
  CONSTRAINT "legacy_project_workspace_maps_parent_id_nonempty"
    CHECK ("legacy_parent_entity_id" IS NULL OR btrim("legacy_parent_entity_id") <> ''),
  CONSTRAINT "legacy_project_workspace_maps_display_name_nonempty"
    CHECK ("display_name" IS NULL OR btrim("display_name") <> '')
);

ALTER TABLE "legacy_project_workspace_maps"
  ADD CONSTRAINT "legacy_project_workspace_maps_workspace_id_fkey"
  FOREIGN KEY ("workspace_id")
  REFERENCES "workspaces"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "legacy_project_workspace_maps"
  ADD CONSTRAINT "legacy_project_workspace_maps_platform_project_id_fkey"
  FOREIGN KEY ("platform_project_id")
  REFERENCES "platform_projects"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE UNIQUE INDEX "legacy_project_maps_active_source_unique"
  ON "legacy_project_workspace_maps" ("source_system", "entity_type", "legacy_entity_id")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "legacy_project_maps_active_platform_project_unique"
  ON "legacy_project_workspace_maps" ("platform_project_id")
  WHERE "platform_project_id" IS NOT NULL AND "deleted_at" IS NULL;

CREATE INDEX "legacy_project_maps_workspace_recent_idx"
  ON "legacy_project_workspace_maps" ("workspace_id", "entity_type", "updated_at" DESC);

CREATE INDEX "legacy_project_maps_owner_recent_idx"
  ON "legacy_project_workspace_maps" ("owner_user_id", "entity_type", "updated_at" DESC);

CREATE INDEX "legacy_project_maps_platform_project_idx"
  ON "legacy_project_workspace_maps" ("platform_project_id");

CREATE INDEX "legacy_project_maps_migration_status_idx"
  ON "legacy_project_workspace_maps" ("migration_status", "updated_at" DESC);
