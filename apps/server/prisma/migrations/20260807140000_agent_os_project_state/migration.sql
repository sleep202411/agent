-- Agent OS durable state for platform (studio) projects + run event journal.

CREATE TABLE "agent_os_project_states" (
    "project_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "characters" JSONB NOT NULL DEFAULT '[]',
    "script_sections" JSONB NOT NULL DEFAULT '[]',
    "updated_by_user_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_os_project_states_pkey" PRIMARY KEY ("project_id")
);

CREATE INDEX "agent_os_project_states_workspace_recent_idx"
  ON "agent_os_project_states" ("workspace_id", "updated_at" DESC);

ALTER TABLE "agent_os_project_states"
  ADD CONSTRAINT "agent_os_project_states_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "platform_projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "agent_os_runs" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "actor_id" VARCHAR(64) NOT NULL,
    "model_profile_id" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "last_sequence" INTEGER NOT NULL DEFAULT 0,
    "events" JSONB NOT NULL DEFAULT '[]',
    "pending_approval" JSONB,
    "assistant_text" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_os_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_os_runs_project_recent_idx"
  ON "agent_os_runs" ("project_id", "created_at" DESC);

CREATE INDEX "agent_os_runs_actor_recent_idx"
  ON "agent_os_runs" ("actor_id", "created_at" DESC);
