-- Agent User control plane: synthetic platform users with persona, schedule,
-- policy, and durable run/action audit. Additive; Java identity binding remains
-- optional through platform_user_id.

CREATE TYPE "AgentUserStatus" AS ENUM ('active', 'paused', 'disabled');
CREATE TYPE "AgentUserIdentityStatus" AS ENUM ('shadow', 'bound');
CREATE TYPE "AgentRunStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');
CREATE TYPE "AgentActionStatus" AS ENUM ('planned', 'running', 'succeeded', 'failed', 'skipped');
CREATE TYPE "AgentMemoryType" AS ENUM ('preference', 'content_affinity', 'negative_signal', 'relationship', 'summary', 'fact');
CREATE TYPE "AgentMemoryStatus" AS ENUM ('active', 'archived');

CREATE TABLE "agent_users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "handle" VARCHAR(80) NOT NULL,
  "display_name" VARCHAR(120) NOT NULL,
  "avatar_url" VARCHAR(512),
  "status" "AgentUserStatus" NOT NULL DEFAULT 'active',
  "identity_status" "AgentUserIdentityStatus" NOT NULL DEFAULT 'shadow',
  "platform_user_id" VARCHAR(64),
  "simulated_email" VARCHAR(320),
  "locale" VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
  "region" VARCHAR(16),
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  "persona" JSONB NOT NULL DEFAULT '{}',
  "schedule" JSONB NOT NULL DEFAULT '{}',
  "policy" JSONB NOT NULL DEFAULT '{}',
  "notes" TEXT,
  "created_by_admin_id" UUID,
  "updated_by_admin_id" UUID,
  "last_run_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabled_at" TIMESTAMPTZ(6),

  CONSTRAINT "agent_users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_users_identity_binding_check"
    CHECK (
      ("identity_status" = 'bound' AND "platform_user_id" IS NOT NULL)
      OR ("identity_status" = 'shadow' AND "platform_user_id" IS NULL)
    ),
  CONSTRAINT "agent_users_disabled_status_check"
    CHECK ("status" <> 'disabled' OR "disabled_at" IS NOT NULL)
);

CREATE TABLE "agent_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agent_user_id" UUID NOT NULL,
  "status" "AgentRunStatus" NOT NULL DEFAULT 'queued',
  "trigger" VARCHAR(64) NOT NULL DEFAULT 'scheduler',
  "objective" VARCHAR(500),
  "summary" TEXT,
  "error_code" VARCHAR(80),
  "error_message" TEXT,
  "metrics" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "queued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_runs_agent_user_id_fkey"
    FOREIGN KEY ("agent_user_id") REFERENCES "agent_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "agent_actions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agent_user_id" UUID NOT NULL,
  "run_id" UUID,
  "action_type" VARCHAR(80) NOT NULL,
  "target_type" VARCHAR(80),
  "target_id" VARCHAR(128),
  "status" "AgentActionStatus" NOT NULL DEFAULT 'planned',
  "idempotency_key" VARCHAR(180),
  "decision" JSONB NOT NULL DEFAULT '{}',
  "input" JSONB NOT NULL DEFAULT '{}',
  "result" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "error_code" VARCHAR(80),
  "error_message" TEXT,
  "planned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_actions_agent_user_id_fkey"
    FOREIGN KEY ("agent_user_id") REFERENCES "agent_users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "agent_actions_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "agent_memories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agent_user_id" UUID NOT NULL,
  "memory_key" VARCHAR(180),
  "type" "AgentMemoryType" NOT NULL,
  "status" "AgentMemoryStatus" NOT NULL DEFAULT 'active',
  "scope_type" VARCHAR(64),
  "scope_id" VARCHAR(128),
  "summary" VARCHAR(500) NOT NULL,
  "content" JSONB NOT NULL DEFAULT '{}',
  "confidence" INTEGER NOT NULL DEFAULT 50,
  "weight" INTEGER NOT NULL DEFAULT 100,
  "source_action_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "last_reinforced_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),

  CONSTRAINT "agent_memories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_memories_agent_user_id_fkey"
    FOREIGN KEY ("agent_user_id") REFERENCES "agent_users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "agent_memories_confidence_check"
    CHECK ("confidence" >= 0 AND "confidence" <= 100),
  CONSTRAINT "agent_memories_weight_check"
    CHECK ("weight" >= 0 AND "weight" <= 10000),
  CONSTRAINT "agent_memories_archived_status_check"
    CHECK ("status" <> 'archived' OR "archived_at" IS NOT NULL)
);

CREATE UNIQUE INDEX "agent_users_handle_key" ON "agent_users"("handle");
CREATE UNIQUE INDEX "agent_users_platform_user_id_key" ON "agent_users"("platform_user_id");
CREATE UNIQUE INDEX "agent_users_simulated_email_key" ON "agent_users"("simulated_email");
CREATE INDEX "agent_users_status_recent_idx" ON "agent_users"("status", "updated_at" DESC);
CREATE INDEX "agent_users_identity_status_idx" ON "agent_users"("identity_status", "status");
CREATE INDEX "agent_users_locale_region_idx" ON "agent_users"("locale", "region");
CREATE INDEX "agent_users_last_run_idx" ON "agent_users"("last_run_at" DESC);

CREATE INDEX "agent_runs_agent_recent_idx" ON "agent_runs"("agent_user_id", "created_at" DESC);
CREATE INDEX "agent_runs_status_queue_idx" ON "agent_runs"("status", "queued_at");

CREATE UNIQUE INDEX "agent_actions_idempotency_key_key" ON "agent_actions"("idempotency_key");
CREATE INDEX "agent_actions_agent_recent_idx" ON "agent_actions"("agent_user_id", "created_at" DESC);
CREATE INDEX "agent_actions_run_order_idx" ON "agent_actions"("run_id", "created_at" ASC);
CREATE INDEX "agent_actions_type_status_idx" ON "agent_actions"("action_type", "status", "created_at" DESC);
CREATE INDEX "agent_actions_target_recent_idx" ON "agent_actions"("target_type", "target_id", "created_at" DESC);

CREATE UNIQUE INDEX "agent_memories_agent_key_unique" ON "agent_memories"("agent_user_id", "memory_key");
CREATE INDEX "agent_memories_agent_status_type_idx" ON "agent_memories"("agent_user_id", "status", "type", "updated_at" DESC);
CREATE INDEX "agent_memories_agent_scope_idx" ON "agent_memories"("agent_user_id", "scope_type", "scope_id");
CREATE INDEX "agent_memories_type_status_recent_idx" ON "agent_memories"("type", "status", "updated_at" DESC);
