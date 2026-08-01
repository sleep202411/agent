-- Product-owned conversation registry for the replacement Agent Platform.
-- Temporal owns execution, Ably owns the live ordered transport, and Mastra
-- storage owns model memory. This table intentionally does not reuse any
-- legacy studio_agent_* runtime table.

CREATE TYPE "AgentPlatformPermissionMode" AS ENUM ('ask', 'smart', 'full');

CREATE TABLE "agent_platform_conversations" (
  "id" UUID NOT NULL,
  "owner_actor_id" VARCHAR(128) NOT NULL,
  "surface" VARCHAR(64) NOT NULL,
  "scope_kind" VARCHAR(64) NOT NULL,
  "scope_key" VARCHAR(64) NOT NULL,
  "scope" JSONB NOT NULL,
  "title" VARCHAR(240),
  "permission_mode" "AgentPlatformPermissionMode" NOT NULL DEFAULT 'smart',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),

  CONSTRAINT "agent_platform_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_platform_conversations_owner_check"
    CHECK (
      char_length(btrim("owner_actor_id")) BETWEEN 1 AND 128
      AND "owner_actor_id" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    ),
  CONSTRAINT "agent_platform_conversations_scope_key_check"
    CHECK ("scope_key" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "agent_platform_conversations_title_check"
    CHECK (
      "title" IS NULL
      OR char_length(btrim("title")) BETWEEN 1 AND 240
    ),
  CONSTRAINT "agent_platform_conversations_lifecycle_check"
    CHECK ("archived_at" IS NULL OR "archived_at" >= "created_at"),
  CONSTRAINT "agent_platform_conversations_scope_check"
    CHECK (
      (
        "surface" = 'story-studio'
        AND "scope_kind" = 'story-project'
        AND jsonb_typeof("scope") = 'object'
        AND "scope" ?& ARRAY['kind', 'workspaceId', 'projectId']
        AND ("scope" - ARRAY['kind', 'workspaceId', 'projectId']) = '{}'::jsonb
        AND "scope"->>'kind' = 'story-project'
        AND ("scope"->>'workspaceId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND ("scope"->>'projectId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      OR
      (
        "surface" = 'crew-management'
        AND "scope_kind" = 'crew'
        AND jsonb_typeof("scope") = 'object'
        AND "scope" ?& ARRAY['kind', 'crewId']
        AND ("scope" - ARRAY['kind', 'crewId']) = '{}'::jsonb
        AND "scope"->>'kind' = 'crew'
        AND char_length("scope"->>'crewId') BETWEEN 1 AND 128
        AND ("scope"->>'crewId') ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
      )
    )
);

CREATE UNIQUE INDEX "agent_platform_conversations_one_active_scope_unique"
  ON "agent_platform_conversations" (
    "owner_actor_id",
    "surface",
    "scope_key"
  )
  WHERE "archived_at" IS NULL;

CREATE INDEX "agent_platform_conversations_owner_scope_recent_idx"
  ON "agent_platform_conversations" (
    "owner_actor_id",
    "surface",
    "scope_key",
    "updated_at" DESC
  );

CREATE INDEX "agent_platform_conversations_owner_recent_idx"
  ON "agent_platform_conversations" (
    "owner_actor_id",
    "updated_at" DESC,
    "id" DESC
  );
