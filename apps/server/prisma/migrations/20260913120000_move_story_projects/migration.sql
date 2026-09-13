-- A move changes the live workspace scope, never historical billing context.
ALTER TABLE "ai_jobs" DROP CONSTRAINT "ai_jobs_document_workspace_fk";
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_document_workspace_fk"
  FOREIGN KEY ("document_id") REFERENCES "studio_documents"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "story_agent_runs" DROP CONSTRAINT "story_agent_runs_project_scope_fkey";
ALTER TABLE "story_agent_runs" ADD CONSTRAINT "story_agent_runs_project_scope_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "story_generation_batches" DROP CONSTRAINT "story_generation_batches_project_fkey";
ALTER TABLE "story_generation_batches" ADD CONSTRAINT "story_generation_batches_project_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "project_skill_audits" DROP CONSTRAINT "project_skill_audits_story_fkey";
ALTER TABLE "project_skill_audits" ADD CONSTRAINT "project_skill_audits_story_fkey"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Existing references travel with the project; shared library assets stay put.
-- Derive this relationship from canonical records, without a second grant ledger.
CREATE VIEW story_project_media_references AS
SELECT id AS story_project_id, cover_asset_id AS asset_id FROM story_projects WHERE cover_asset_id IS NOT NULL
UNION SELECT story_project_id, media_asset_id FROM story_candidate_assets
UNION SELECT story_project_id, media_asset_id FROM story_asset_media_versions
UNION SELECT story_project_id, media_asset_id FROM story_storyboard_clip_media_versions
UNION SELECT story_project_id, asset_id FROM story_reference_versions
UNION SELECT story_project_id, asset_id FROM story_build_assets
UNION SELECT j.story_project_id, o.asset_id FROM ai_outputs o JOIN ai_jobs j ON j.id = o.job_id
  WHERE j.story_project_id IS NOT NULL AND o.asset_id IS NOT NULL;

CREATE FUNCTION story_project_references_media(project_id UUID, media_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM story_project_media_references
    WHERE story_project_id = project_id AND asset_id = media_id);
$$;

CREATE OR REPLACE FUNCTION public.story_project_identity_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN

  IF NEW."frame_profile" IS DISTINCT FROM OLD."frame_profile"
     AND (
       EXISTS (
         SELECT 1
         FROM "story_builds"
         WHERE "story_project_id" = OLD."id"
       )
       OR EXISTS (
         SELECT 1
         FROM "story_storyboard_clips"
         WHERE "story_project_id" = OLD."id"
           AND "selected_media_version_id" IS NOT NULL
       )
     )
  THEN
    RAISE EXCEPTION 'StoryProject.frameProfile is locked after production begins'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION "story_project_cover_workspace_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  asset_workspace UUID;
BEGIN
  IF NEW."cover_asset_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "workspace_id" INTO asset_workspace
  FROM "media_assets" WHERE "id" = NEW."cover_asset_id";
  IF asset_workspace IS DISTINCT FROM NEW."workspace_id"
     AND NOT story_project_references_media(NEW."id", NEW."cover_asset_id") THEN
    RAISE EXCEPTION 'StoryProject cover asset must belong to the same Workspace'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "story_project_member_workspace_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  project_workspace UUID;
BEGIN
  IF NEW."status" <> 'active' THEN
    RETURN NEW;
  END IF;
  SELECT "workspace_id" INTO project_workspace
  FROM "story_projects" WHERE "id" = NEW."story_project_id" FOR SHARE;
  IF NOT EXISTS (
    SELECT 1 FROM "workspace_members"
    WHERE "workspace_id" = project_workspace
      AND "user_id" = NEW."user_id"
      AND "status" = 'active'
      AND "removed_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'Active StoryProject member must be an active Workspace member'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "story_manifest_asset_workspace_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  expected_workspace UUID;
  asset_workspace UUID;
  variant_asset UUID;
BEGIN
  SELECT "workspace_id" INTO expected_workspace
  FROM "story_projects" WHERE "id" = NEW."story_project_id";
  SELECT "workspace_id" INTO asset_workspace
  FROM "media_assets" WHERE "id" = NEW."asset_id";
  SELECT "asset_id" INTO variant_asset
  FROM "media_asset_variants" WHERE "id" = NEW."variant_id";
  IF asset_workspace IS DISTINCT FROM expected_workspace
     AND NOT story_project_references_media(NEW."story_project_id", NEW."asset_id") THEN
    RAISE EXCEPTION '% MediaAsset must belong to the project Workspace', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  IF variant_asset IS NULL OR variant_asset <> NEW."asset_id" THEN
    RAISE EXCEPTION '% Variant must belong to its MediaAsset', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "story_reference_version_integrity_guard"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  expected_workspace UUID;
  asset_workspace UUID;
  asset_kind TEXT;
  asset_status TEXT;
  asset_moderation TEXT;
  asset_deleted_at TIMESTAMPTZ;
  variant_asset UUID;
  variant_status TEXT;
  variant_checksum TEXT;
  variant_deleted_at TIMESTAMPTZ;
  job_workspace UUID;
  job_type TEXT;
  job_deleted_at TIMESTAMPTZ;
  output_job UUID;
  output_asset UUID;
  output_type TEXT;
  output_deleted_at TIMESTAMPTZ;
BEGIN
  SELECT project."workspace_id" INTO expected_workspace
  FROM "story_projects" AS project
  JOIN "story_reference_slots" AS slot
    ON slot."story_project_id" = project."id"
  WHERE project."id" = NEW."story_project_id"
    AND slot."id" = NEW."reference_slot_id";

  IF expected_workspace IS NULL THEN
    RAISE EXCEPTION 'STORY_REFERENCE_VERSION_SCOPE: slot must belong to the exact Story project'
      USING ERRCODE = '23514';
  END IF;

  SELECT "workspace_id", "kind"::text, "status"::text,
         "moderation_status"::text, "deleted_at"
    INTO asset_workspace, asset_kind, asset_status,
         asset_moderation, asset_deleted_at
  FROM "media_assets"
  WHERE "id" = NEW."asset_id";

  SELECT "asset_id", "status"::text, "checksum_sha256", "deleted_at"
    INTO variant_asset, variant_status, variant_checksum, variant_deleted_at
  FROM "media_asset_variants"
  WHERE "id" = NEW."variant_id";

  IF (asset_workspace IS DISTINCT FROM expected_workspace
      AND NOT story_project_references_media(NEW."story_project_id", NEW."asset_id"))
     OR asset_kind IS DISTINCT FROM 'image'
     OR variant_asset IS DISTINCT FROM NEW."asset_id"
     OR variant_checksum IS DISTINCT FROM NEW."checksum_sha256" THEN
    RAISE EXCEPTION 'STORY_REFERENCE_VERSION_MEDIA_IDENTITY: reference must freeze one exact workspace image asset and variant checksum'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."source" = 'ai_job' THEN
    SELECT "workspace_id", "type"::text, "deleted_at"
      INTO job_workspace, job_type, job_deleted_at
    FROM "ai_jobs"
    WHERE "id" = NEW."ai_job_id";
    SELECT "job_id", "asset_id", "type"::text, "deleted_at"
      INTO output_job, output_asset, output_type, output_deleted_at
    FROM "ai_outputs"
    WHERE "id" = NEW."ai_job_output_id";

    IF (job_workspace IS DISTINCT FROM expected_workspace
        AND NOT EXISTS (SELECT 1 FROM ai_jobs WHERE id = NEW."ai_job_id" AND story_project_id = NEW."story_project_id"))
       OR job_type IS DISTINCT FROM 'image'
       OR job_deleted_at IS NOT NULL
       OR output_job IS DISTINCT FROM NEW."ai_job_id"
       OR output_asset IS DISTINCT FROM NEW."asset_id"
       OR output_type IS DISTINCT FROM 'image'
       OR output_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'STORY_REFERENCE_VERSION_AI_PROVENANCE: AiJob output must be the active exact source image in this workspace'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."status" = 'ready' AND (
    asset_status IS DISTINCT FROM 'ready'
    OR asset_moderation = 'blocked'
    OR asset_deleted_at IS NOT NULL
    OR variant_status IS DISTINCT FROM 'ready'
    OR variant_deleted_at IS NOT NULL
    OR NOT EXISTS (
      SELECT 1
      FROM "media_object_placements" AS placement
      WHERE placement."asset_id" = NEW."asset_id"
        AND placement."variant_id" = NEW."variant_id"
        AND placement."status" = 'active'
        AND placement."deleted_at" IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'STORY_REFERENCE_VERSION_NOT_READY: ready reference media must be active, non-blocked, placed, and byte-exact'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION story_work_admission_workspace_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  project_id UUID;
  current_workspace UUID;
  admitted_workspace UUID;
  row_data JSONB := to_jsonb(NEW);
BEGIN
  project_id := NULLIF(row_data->>'story_project_id', '')::uuid;
  IF project_id IS NULL THEN RETURN NEW; END IF;
  SELECT workspace_id INTO current_workspace FROM story_projects WHERE id = project_id FOR SHARE;
  admitted_workspace := NULLIF(row_data->>'workspace_id', '')::uuid;
  IF admitted_workspace IS NOT NULL AND admitted_workspace IS DISTINCT FROM current_workspace THEN
    RAISE EXCEPTION 'STORY_PROJECT_MOVED: refresh the project before starting work' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ai_jobs_story_admission_guard_trg" BEFORE INSERT ON "ai_jobs"
FOR EACH ROW EXECUTE FUNCTION story_work_admission_workspace_guard();
CREATE TRIGGER "story_agent_runs_story_admission_guard_trg" BEFORE INSERT ON "story_agent_runs"
FOR EACH ROW EXECUTE FUNCTION story_work_admission_workspace_guard();
CREATE TRIGGER "story_generation_batches_story_admission_guard_trg" BEFORE INSERT ON "story_generation_batches"
FOR EACH ROW EXECUTE FUNCTION story_work_admission_workspace_guard();
CREATE TRIGGER "story_builds_story_admission_guard_trg" BEFORE INSERT ON "story_builds"
FOR EACH ROW EXECUTE FUNCTION story_work_admission_workspace_guard();
CREATE TRIGGER "world_model_worlds_story_admission_guard_trg" BEFORE INSERT ON "world_model_worlds"
FOR EACH ROW EXECUTE FUNCTION story_work_admission_workspace_guard();
CREATE TRIGGER "world_model_sessions_story_admission_guard_trg" BEFORE INSERT ON "world_model_sessions"
FOR EACH ROW EXECUTE FUNCTION story_work_admission_workspace_guard();
CREATE TRIGGER "world_model_travels_story_admission_guard_trg" BEFORE INSERT ON "world_model_travels"
FOR EACH ROW EXECUTE FUNCTION story_work_admission_workspace_guard();
CREATE TRIGGER "agent_os_attachments_story_admission_guard_trg" BEFORE INSERT ON "agent_os_attachments"
FOR EACH ROW EXECUTE FUNCTION story_work_admission_workspace_guard();

-- Retrying old work may not revive a frozen payer after its project has moved.
CREATE TRIGGER ai_jobs_story_resume_guard_trg BEFORE UPDATE OF status ON ai_jobs
FOR EACH ROW WHEN (NEW.status IN ('created', 'in_queue', 'in_progress') AND NEW.status IS DISTINCT FROM OLD.status)
EXECUTE FUNCTION story_work_admission_workspace_guard();
CREATE TRIGGER story_agent_runs_resume_guard_trg BEFORE UPDATE OF status ON story_agent_runs
FOR EACH ROW WHEN (NEW.status IN ('authoring', 'proposed', 'applying') AND NEW.status IS DISTINCT FROM OLD.status)
EXECUTE FUNCTION story_work_admission_workspace_guard();
CREATE TRIGGER story_generation_batches_resume_guard_trg BEFORE UPDATE OF status ON story_generation_batches
FOR EACH ROW WHEN (NEW.status IN ('queued', 'running', 'awaiting_confirmation') AND NEW.status IS DISTINCT FROM OLD.status)
EXECUTE FUNCTION story_work_admission_workspace_guard();

CREATE FUNCTION agent_os_story_admission_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE current_workspace UUID;
BEGIN
  SELECT workspace_id INTO current_workspace FROM story_projects WHERE id = NEW.project_id FOR SHARE;
  IF current_workspace IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM story_project_members WHERE story_project_id = NEW.project_id
       AND user_id = NEW.actor_id AND status = 'active' AND removed_at IS NULL AND role IN ('owner','producer','editor'))
     AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = current_workspace
       AND user_id = NEW.actor_id AND status = 'active' AND removed_at IS NULL
       AND access_scope = 'workspace' AND role IN ('owner','admin','editor')) THEN
    RAISE EXCEPTION 'STORY_PROJECT_MOVED: refresh project access before starting an Agent run' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agent_os_runs_story_admission_guard_trg BEFORE INSERT ON agent_os_runs
FOR EACH ROW EXECUTE FUNCTION agent_os_story_admission_guard();
