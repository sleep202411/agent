-- Speeds up Agent OS transcript restore by conversation within a project.
CREATE INDEX IF NOT EXISTS "agent_os_runs_project_conversation_idx"
  ON "agent_os_runs" ("project_id", "conversation_id", "created_at");
