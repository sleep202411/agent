CREATE TYPE "WorldModelWorldStatus" AS ENUM ('generating', 'ready', 'failed');
CREATE TYPE "WorldModelSessionStatus" AS ENUM ('active', 'closed', 'expired');
CREATE TYPE "WorldModelTravelStatus" AS ENUM ('init', 'pending', 'running', 'failed', 'completed');

CREATE TABLE "world_model_worlds" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "provider_key" VARCHAR(128) NOT NULL,
  "provider_world_id" VARCHAR(2048) NOT NULL,
  "mode" VARCHAR(32) NOT NULL,
  "status" "WorldModelWorldStatus" NOT NULL DEFAULT 'generating',
  "name" VARCHAR(160),
  "prompt" TEXT NOT NULL,
  "first_frame_url" VARCHAR(2048),
  "request" JSONB NOT NULL,
  "provider_data" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "error_code" VARCHAR(128),
  "error_message" TEXT,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "world_model_worlds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "world_model_worlds_mode_chk" CHECK ("mode" = 'adventure'),
  CONSTRAINT "world_model_worlds_provider_key_chk" CHECK ("provider_key" ~ '^[a-z0-9-]+:[a-z0-9-]+$'),
  CONSTRAINT "world_model_worlds_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "world_model_worlds_story_project_fkey" FOREIGN KEY ("story_project_id", "workspace_id") REFERENCES "story_projects"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "world_model_worlds_provider_identity_unique" ON "world_model_worlds"("provider_key", "provider_world_id");
CREATE UNIQUE INDEX "world_model_worlds_project_identity_unique" ON "world_model_worlds"("id", "story_project_id", "workspace_id");
CREATE INDEX "world_model_worlds_project_recent_idx" ON "world_model_worlds"("story_project_id", "created_at" DESC);
CREATE INDEX "world_model_worlds_workspace_recent_idx" ON "world_model_worlds"("workspace_id", "created_at" DESC);

CREATE TABLE "world_model_sessions" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "world_id" UUID NOT NULL,
  "provider_session_id" VARCHAR(2048) NOT NULL,
  "status" "WorldModelSessionStatus" NOT NULL DEFAULT 'active',
  "heartbeat_interval_seconds" DOUBLE PRECISION NOT NULL,
  "session_timeout_seconds" DOUBLE PRECISION NOT NULL,
  "last_heartbeat_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "closed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "world_model_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "world_model_sessions_provider_session_id_key" UNIQUE ("provider_session_id"),
  CONSTRAINT "world_model_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "world_model_sessions_story_project_fkey" FOREIGN KEY ("story_project_id", "workspace_id") REFERENCES "story_projects"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "world_model_sessions_world_fkey" FOREIGN KEY ("world_id", "story_project_id", "workspace_id") REFERENCES "world_model_worlds"("id", "story_project_id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "world_model_sessions_project_status_idx" ON "world_model_sessions"("story_project_id", "status", "created_at" DESC);
CREATE INDEX "world_model_sessions_expiry_idx" ON "world_model_sessions"("status", "expires_at");

CREATE TABLE "world_model_travels" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "world_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "provider_travel_id" VARCHAR(2048) NOT NULL,
  "status" "WorldModelTravelStatus" NOT NULL DEFAULT 'init',
  "rtc_status" VARCHAR(64),
  "provider_updated_at" TIMESTAMPTZ(6),
  "provider_data" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "artifact_data" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "started_at" TIMESTAMPTZ(6),
  "ended_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "world_model_travels_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "world_model_travels_session_id_key" UNIQUE ("session_id"),
  CONSTRAINT "world_model_travels_provider_travel_id_key" UNIQUE ("provider_travel_id"),
  CONSTRAINT "world_model_travels_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "world_model_travels_story_project_fkey" FOREIGN KEY ("story_project_id", "workspace_id") REFERENCES "story_projects"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "world_model_travels_world_fkey" FOREIGN KEY ("world_id", "story_project_id", "workspace_id") REFERENCES "world_model_worlds"("id", "story_project_id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "world_model_travels_session_fkey" FOREIGN KEY ("session_id") REFERENCES "world_model_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "world_model_travels_project_status_idx" ON "world_model_travels"("story_project_id", "status", "created_at" DESC);
CREATE INDEX "world_model_travels_world_recent_idx" ON "world_model_travels"("world_id", "created_at" DESC);
