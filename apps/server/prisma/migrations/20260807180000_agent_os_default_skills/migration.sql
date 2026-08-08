-- Project-level default Agent OS skill ids (admin).
ALTER TABLE "agent_os_project_states"
  ADD COLUMN IF NOT EXISTS "default_skill_ids" JSONB NOT NULL DEFAULT '[]';
