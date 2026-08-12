-- Project Skills: catalog + immutable versions + project install/default state.
-- PostgreSQL is the single authority; runtime snapshots reference pinned rows.

-- The former Agent OS default list was PlatformProject-only and stored
-- unversioned process-registry ids. Immutable project installations and scoped
-- activations replace it for both Platform and Story projects.
ALTER TABLE "agent_os_project_states"
  DROP COLUMN IF EXISTS "default_skill_ids";

CREATE TYPE "SkillKind" AS ENUM ('general', 'image', 'video');
CREATE TYPE "SkillCatalogVisibility" AS ENUM ('public', 'unlisted', 'private');
CREATE TYPE "SkillCatalogStatus" AS ENUM ('draft', 'published', 'retired');
CREATE TYPE "SkillVersionStatus" AS ENUM ('draft', 'published', 'deprecated');
CREATE TYPE "ProjectSkillInstallationStatus" AS ENUM ('active', 'disabled');
CREATE TYPE "ProjectSkillScope" AS ENUM (
  'agent_prompt',
  'prompt_authoring',
  'image_generation',
  'video_generation',
  'preflight',
  'qa'
);
CREATE TYPE "ProjectSkillAuditAction" AS ENUM (
  'install',
  'update',
  'uninstall',
  'defaults_update',
  'turn_override'
);

CREATE TABLE "skill_catalog_items" (
  "id" UUID NOT NULL,
  "slug" VARCHAR(128) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" TEXT NOT NULL,
  "localized_metadata" JSONB NOT NULL DEFAULT '{}',
  "publisher_name" VARCHAR(160) NOT NULL,
  "category" VARCHAR(64) NOT NULL,
  "kind" "SkillKind" NOT NULL,
  "visibility" "SkillCatalogVisibility" NOT NULL DEFAULT 'public',
  "status" "SkillCatalogStatus" NOT NULL DEFAULT 'draft',
  "preview_url" VARCHAR(1024),
  "latest_published_version_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "skill_catalog_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "skill_catalog_items_slug_key" UNIQUE ("slug"),
  CONSTRAINT "skill_catalog_items_latest_published_version_id_key" UNIQUE ("latest_published_version_id"),
  CONSTRAINT "skill_catalog_localized_metadata_object_chk" CHECK (jsonb_typeof("localized_metadata") = 'object')
);

CREATE TABLE "skill_versions" (
  "id" UUID NOT NULL,
  "skill_id" UUID NOT NULL,
  "version" VARCHAR(32) NOT NULL,
  "status" "SkillVersionStatus" NOT NULL DEFAULT 'draft',
  "manifest_schema_version" VARCHAR(32) NOT NULL,
  "instructions" TEXT NOT NULL,
  "generation_policy" JSONB NOT NULL DEFAULT '{}',
  "config_schema" JSONB NOT NULL DEFAULT '{}',
  "capabilities" JSONB NOT NULL DEFAULT '[]',
  "project_kinds" JSONB NOT NULL DEFAULT '[]',
  "workbench_modes" JSONB NOT NULL DEFAULT '[]',
  "tool_ids" JSONB NOT NULL DEFAULT '[]',
  "risk_policy" JSONB NOT NULL DEFAULT '{}',
  "eval_suite" VARCHAR(240),
  "checksum" VARCHAR(64) NOT NULL,
  "published_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "skill_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "skill_versions_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "skill_versions_skill_version_unique" UNIQUE ("skill_id", "version"),
  CONSTRAINT "skill_versions_id_skill_unique" UNIQUE ("id", "skill_id"),
  CONSTRAINT "skill_versions_manifest_shape_chk" CHECK (
    jsonb_typeof("generation_policy") = 'object'
    AND jsonb_typeof("config_schema") = 'object'
    AND jsonb_typeof("capabilities") = 'array'
    AND jsonb_typeof("project_kinds") = 'array'
    AND jsonb_typeof("workbench_modes") = 'array'
    AND jsonb_typeof("tool_ids") = 'array'
    AND jsonb_typeof("risk_policy") = 'object'
  ),
  CONSTRAINT "skill_versions_checksum_chk" CHECK ("checksum" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "skill_versions_publish_state_chk" CHECK (
    ("status" = 'draft' AND "published_at" IS NULL)
    OR ("status" <> 'draft' AND "published_at" IS NOT NULL)
  )
);

ALTER TABLE "skill_catalog_items"
  ADD CONSTRAINT "skill_catalog_items_latest_version_fkey"
  FOREIGN KEY ("latest_published_version_id") REFERENCES "skill_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "project_skill_states" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "platform_project_id" UUID,
  "story_project_id" UUID,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_skill_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_skill_states_owner_chk" CHECK (num_nonnulls("platform_project_id", "story_project_id") = 1),
  CONSTRAINT "project_skill_states_revision_chk" CHECK ("revision" >= 0),
  CONSTRAINT "project_skill_states_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_skill_states_platform_fkey" FOREIGN KEY ("platform_project_id", "workspace_id") REFERENCES "platform_projects"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_skill_states_story_fkey" FOREIGN KEY ("story_project_id", "workspace_id") REFERENCES "story_projects"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_skill_states_platform_project_id_key" UNIQUE ("platform_project_id"),
  CONSTRAINT "project_skill_states_story_project_id_key" UNIQUE ("story_project_id"),
  CONSTRAINT "project_skill_states_platform_workspace_unique" UNIQUE ("platform_project_id", "workspace_id"),
  CONSTRAINT "project_skill_states_story_workspace_unique" UNIQUE ("story_project_id", "workspace_id")
);

CREATE TABLE "project_skill_installations" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "platform_project_id" UUID,
  "story_project_id" UUID,
  "skill_id" UUID NOT NULL,
  "pinned_version_id" UUID NOT NULL,
  "config" JSONB NOT NULL DEFAULT '{}',
  "status" "ProjectSkillInstallationStatus" NOT NULL DEFAULT 'active',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "installed_by_user_id" VARCHAR(64) NOT NULL,
  "updated_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_skill_installations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_skill_installations_owner_chk" CHECK (num_nonnulls("platform_project_id", "story_project_id") = 1),
  CONSTRAINT "project_skill_installations_config_chk" CHECK (jsonb_typeof("config") = 'object'),
  CONSTRAINT "project_skill_installations_revision_chk" CHECK ("revision" >= 0),
  CONSTRAINT "project_skill_installations_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_skill_installations_platform_fkey" FOREIGN KEY ("platform_project_id", "workspace_id") REFERENCES "platform_projects"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_skill_installations_story_fkey" FOREIGN KEY ("story_project_id", "workspace_id") REFERENCES "story_projects"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_skill_installations_skill_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_skill_installations_version_fkey" FOREIGN KEY ("pinned_version_id", "skill_id") REFERENCES "skill_versions"("id", "skill_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "project_skill_installations_platform_skill_unique"
  ON "project_skill_installations"("platform_project_id", "skill_id")
  WHERE "platform_project_id" IS NOT NULL;
CREATE UNIQUE INDEX "project_skill_installations_story_skill_unique"
  ON "project_skill_installations"("story_project_id", "skill_id")
  WHERE "story_project_id" IS NOT NULL;

CREATE TABLE "project_skill_activations" (
  "id" UUID NOT NULL,
  "installation_id" UUID NOT NULL,
  "scope" "ProjectSkillScope" NOT NULL,
  "workbench_mode" VARCHAR(64) NOT NULL DEFAULT '',
  "source_surface" VARCHAR(64) NOT NULL DEFAULT '',
  "default_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_skill_activations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_skill_activations_installation_fkey" FOREIGN KEY ("installation_id") REFERENCES "project_skill_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_skill_activations_scope_unique" UNIQUE ("installation_id", "scope", "workbench_mode", "source_surface")
);

CREATE TABLE "project_skill_audits" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "platform_project_id" UUID,
  "story_project_id" UUID,
  "installation_id" UUID,
  "skill_id" UUID NOT NULL,
  "version_id" UUID,
  "action" "ProjectSkillAuditAction" NOT NULL,
  "actor_user_id" VARCHAR(64) NOT NULL,
  "request_id" VARCHAR(128),
  "before" JSONB,
  "after" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_skill_audits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_skill_audits_owner_chk" CHECK (num_nonnulls("platform_project_id", "story_project_id") = 1),
  CONSTRAINT "project_skill_audits_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_skill_audits_platform_fkey" FOREIGN KEY ("platform_project_id", "workspace_id") REFERENCES "platform_projects"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_skill_audits_story_fkey" FOREIGN KEY ("story_project_id", "workspace_id") REFERENCES "story_projects"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_skill_audits_installation_fkey" FOREIGN KEY ("installation_id") REFERENCES "project_skill_installations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "project_skill_audits_skill_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_skill_audits_version_fkey" FOREIGN KEY ("version_id") REFERENCES "skill_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "project_skill_mutations" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(240) NOT NULL,
  "operation" VARCHAR(64) NOT NULL,
  "request_hash" VARCHAR(64) NOT NULL,
  "actor_user_id" VARCHAR(64) NOT NULL,
  "response" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_skill_mutations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_skill_mutations_response_chk" CHECK (jsonb_typeof("response") = 'object'),
  CONSTRAINT "project_skill_mutations_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_skill_mutations_workspace_key_unique" UNIQUE ("workspace_id", "idempotency_key")
);

CREATE INDEX "skill_catalog_discovery_idx" ON "skill_catalog_items"("status", "visibility", "category", "updated_at" DESC);
CREATE INDEX "skill_catalog_kind_idx" ON "skill_catalog_items"("kind", "status", "updated_at" DESC);
CREATE INDEX "skill_versions_published_idx" ON "skill_versions"("skill_id", "status", "published_at" DESC);
CREATE INDEX "project_skill_states_workspace_recent_idx" ON "project_skill_states"("workspace_id", "updated_at" DESC);
CREATE INDEX "project_skill_installations_platform_recent_idx" ON "project_skill_installations"("platform_project_id", "status", "updated_at" DESC);
CREATE INDEX "project_skill_installations_story_recent_idx" ON "project_skill_installations"("story_project_id", "status", "updated_at" DESC);
CREATE INDEX "project_skill_installations_version_idx" ON "project_skill_installations"("skill_id", "pinned_version_id");
CREATE INDEX "project_skill_activations_resolve_idx" ON "project_skill_activations"("scope", "workbench_mode", "source_surface", "default_enabled");
CREATE INDEX "project_skill_audits_platform_recent_idx" ON "project_skill_audits"("platform_project_id", "created_at" DESC);
CREATE INDEX "project_skill_audits_story_recent_idx" ON "project_skill_audits"("story_project_id", "created_at" DESC);
CREATE INDEX "project_skill_audits_actor_recent_idx" ON "project_skill_audits"("actor_user_id", "created_at" DESC);
CREATE INDEX "project_skill_mutations_created_idx" ON "project_skill_mutations"("created_at");

CREATE OR REPLACE FUNCTION "protect_published_skill_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" = 'published' THEN
    RAISE EXCEPTION 'Published Skill versions are immutable (skill %, version %)', OLD."skill_id", OLD."version"
      USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "skill_versions_immutable_trigger"
BEFORE UPDATE OR DELETE ON "skill_versions"
FOR EACH ROW EXECUTE FUNCTION "protect_published_skill_version"();

ALTER TABLE "agent_os_runs"
  ADD COLUMN "project_kind" VARCHAR(32),
  ADD COLUMN "workbench_mode" VARCHAR(64),
  ADD COLUMN "workbench_context" JSONB,
  ADD COLUMN "skill_snapshot" JSONB;

ALTER TABLE "ai_jobs"
  ADD COLUMN "skill_snapshot" JSONB;

ALTER TABLE "agent_os_runs"
  ADD CONSTRAINT "agent_os_runs_skill_snapshot_object_chk"
  CHECK ("skill_snapshot" IS NULL OR jsonb_typeof("skill_snapshot") = 'object');
ALTER TABLE "ai_jobs"
  ADD CONSTRAINT "ai_jobs_skill_snapshot_object_chk"
  CHECK ("skill_snapshot" IS NULL OR jsonb_typeof("skill_snapshot") = 'object');
