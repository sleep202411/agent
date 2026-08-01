-- Stable, product-owned attachment registry for Agent Platform conversations.
-- Long-lived messages store only fizzdragon-media://<attachment UUID>; no
-- expiring storage credential is ever persisted in Ably, Temporal, or memory.

CREATE TYPE "AgentPlatformAttachmentKind" AS ENUM (
  'model_file',
  'document_text'
);

CREATE TYPE "AgentPlatformAttachmentStatus" AS ENUM (
  'processing',
  'ready',
  'failed',
  'revoked'
);

ALTER TABLE "agent_platform_conversations"
  ADD CONSTRAINT "agent_platform_conversations_id_owner_unique"
  UNIQUE ("id", "owner_actor_id");

CREATE TABLE "agent_platform_attachments" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "media_asset_id" UUID NOT NULL,
  "owner_actor_id" VARCHAR(128) NOT NULL,
  "kind" "AgentPlatformAttachmentKind" NOT NULL,
  "status" "AgentPlatformAttachmentStatus" NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "media_type" VARCHAR(128) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "document_text" TEXT,
  "document_char_count" INTEGER,
  "document_page_count" INTEGER,
  "content_hash" VARCHAR(64),
  "error" JSONB,
  "processing_attempt_count" INTEGER NOT NULL DEFAULT 0,
  "processing_lease_token" UUID,
  "processing_lease_until" TIMESTAMPTZ(6),
  "ready_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_platform_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_platform_attachments_conversation_owner_fkey"
    FOREIGN KEY ("conversation_id", "owner_actor_id")
    REFERENCES "agent_platform_conversations" ("id", "owner_actor_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "agent_platform_attachments_media_asset_fkey"
    FOREIGN KEY ("media_asset_id")
    REFERENCES "media_assets" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "agent_platform_attachments_owner_check"
    CHECK (
      char_length(btrim("owner_actor_id")) BETWEEN 1 AND 128
      AND "owner_actor_id" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    ),
  CONSTRAINT "agent_platform_attachments_file_name_check"
    CHECK (
      char_length(btrim("file_name")) BETWEEN 1 AND 255
      AND "file_name" !~ '[[:cntrl:]]'
    ),
  CONSTRAINT "agent_platform_attachments_size_check"
    CHECK (
      "size_bytes" > 0
      AND (
        ("kind" = 'model_file' AND "size_bytes" <= 31457280)
        OR
        ("kind" = 'document_text' AND "size_bytes" <= 10485760)
      )
    ),
  CONSTRAINT "agent_platform_attachments_media_type_check"
    CHECK (
      (
        "kind" = 'model_file'
        AND "media_type" IN (
          'image/jpeg',
          'image/png',
          'image/webp',
          'application/pdf'
        )
      )
      OR
      (
        "kind" = 'document_text'
        AND "media_type" IN (
          'text/plain',
          'text/markdown',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
      )
    ),
  CONSTRAINT "agent_platform_attachments_content_hash_check"
    CHECK (
      "content_hash" IS NULL
      OR "content_hash" ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT "agent_platform_attachments_projection_check"
    CHECK (
      (
        "kind" = 'model_file'
        AND "document_text" IS NULL
        AND "document_char_count" IS NULL
        AND "document_page_count" IS NULL
      )
      OR
      (
        "kind" = 'document_text'
        AND (
          (
            "status" IN ('processing', 'failed')
            AND "document_text" IS NULL
            AND "document_char_count" IS NULL
            AND "document_page_count" IS NULL
          )
          OR
          (
            "status" IN ('ready', 'revoked')
            AND "document_text" IS NOT NULL
            AND "document_char_count" = char_length("document_text")
            AND "document_char_count" BETWEEN 1 AND 200000
          )
          OR
          (
            "status" = 'revoked'
            AND (
              (
                "document_text" IS NULL
                AND "document_char_count" IS NULL
                AND "document_page_count" IS NULL
              )
              OR
              (
                "document_text" IS NOT NULL
                AND "document_char_count" = char_length("document_text")
                AND "document_char_count" BETWEEN 1 AND 200000
              )
            )
          )
        )
      )
    ),
  CONSTRAINT "agent_platform_attachments_lifecycle_check"
    CHECK (
      "processing_attempt_count" >= 0
      AND (
        (
          "status" = 'processing'
          AND (
            "kind" = 'document_text'
            OR (
              "kind" = 'model_file'
              AND "media_type" = 'application/pdf'
            )
          )
          AND "processing_attempt_count" > 0
          AND "processing_lease_token" IS NOT NULL
          AND "processing_lease_until" IS NOT NULL
          AND "ready_at" IS NULL
          AND "revoked_at" IS NULL
          AND "error" IS NULL
        )
        OR
        (
          "status" = 'ready'
          AND "processing_lease_token" IS NULL
          AND "processing_lease_until" IS NULL
          AND "ready_at" IS NOT NULL
          AND "revoked_at" IS NULL
          AND "error" IS NULL
          AND "content_hash" IS NOT NULL
        )
        OR
        (
          "status" = 'failed'
          AND (
            "kind" = 'document_text'
            OR (
              "kind" = 'model_file'
              AND "media_type" = 'application/pdf'
            )
          )
          AND "processing_attempt_count" > 0
          AND "processing_lease_token" IS NULL
          AND "processing_lease_until" IS NULL
          AND "ready_at" IS NULL
          AND "revoked_at" IS NULL
          AND jsonb_typeof("error") = 'object'
          AND jsonb_typeof("error"->'code') = 'string'
          AND char_length("error"->>'code') BETWEEN 1 AND 128
          AND jsonb_typeof("error"->'message') = 'string'
          AND char_length("error"->>'message') BETWEEN 1 AND 2000
          AND jsonb_typeof("error"->'retryable') = 'boolean'
        )
        OR
        (
          "status" = 'revoked'
          AND "processing_lease_token" IS NULL
          AND "processing_lease_until" IS NULL
          AND "revoked_at" IS NOT NULL
        )
      )
    ),
  CONSTRAINT "agent_platform_attachments_ready_time_check"
    CHECK ("ready_at" IS NULL OR "ready_at" >= "created_at"),
  CONSTRAINT "agent_platform_attachments_revoked_time_check"
    CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at")
);

CREATE UNIQUE INDEX "agent_platform_attachments_conversation_media_unique"
  ON "agent_platform_attachments" ("conversation_id", "media_asset_id");

CREATE INDEX "agent_platform_attachments_conversation_status_idx"
  ON "agent_platform_attachments" (
    "conversation_id",
    "status",
    "created_at",
    "id"
  );

CREATE INDEX "agent_platform_attachments_owner_recent_idx"
  ON "agent_platform_attachments" (
    "owner_actor_id",
    "created_at" DESC,
    "id" DESC
  );

CREATE INDEX "agent_platform_attachments_processing_idx"
  ON "agent_platform_attachments" (
    "status",
    "processing_lease_until",
    "updated_at",
    "id"
  );
