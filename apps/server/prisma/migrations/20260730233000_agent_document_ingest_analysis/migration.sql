-- Move document ingestion out of request handlers and persist every queue,
-- lease, retry, dead-letter and exhaustive-analysis checkpoint in PostgreSQL.
-- Agent attachments are intentionally disposable product projections, so the
-- pre-cutover rows are removed instead of carrying two conflicting lifecycle
-- authorities through the migration.

DELETE FROM "agent_platform_attachments";

CREATE TYPE "AgentPlatformAttachmentIngestJobStatus" AS ENUM (
  'queued',
  'leased',
  'retry_wait',
  'succeeded',
  'dead_lettered',
  'cancelled'
);

CREATE TYPE "AgentDocumentAnalysisJobStatus" AS ENUM (
  'queued',
  'dispatching',
  'running',
  'reducing',
  'succeeded',
  'failed',
  'dead_lettered',
  'cancelled'
);

CREATE TYPE "AgentDocumentAnalysisArtifactKind" AS ENUM (
  'section',
  'reduce',
  'final'
);

DROP INDEX "agent_platform_attachments_processing_idx";

ALTER TABLE "agent_platform_attachments"
  DROP CONSTRAINT "agent_platform_attachments_lifecycle_check",
  DROP CONSTRAINT "agent_platform_attachments_projection_check",
  DROP CONSTRAINT "agent_platform_attachments_media_type_check",
  DROP CONSTRAINT "agent_platform_attachments_size_check",
  DROP COLUMN "processing_attempt_count",
  DROP COLUMN "processing_lease_token",
  DROP COLUMN "processing_lease_until",
  ADD COLUMN "locale" VARCHAR(35) NOT NULL;

ALTER TABLE "agent_platform_attachments"
  ADD CONSTRAINT "agent_platform_attachments_locale_check"
    CHECK (
      char_length("locale") BETWEEN 2 AND 35
      AND "locale" ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
    ),
  ADD CONSTRAINT "agent_platform_attachments_size_check"
    CHECK (
      "size_bytes" > 0
      AND (
        (
          "kind" = 'model_file'
          AND "media_type" IN ('image/jpeg', 'image/png', 'image/webp')
          AND "size_bytes" <= 31457280
        )
        OR
        (
          "kind" = 'document_text'
          AND "size_bytes" <= 10485760
        )
      )
    ),
  ADD CONSTRAINT "agent_platform_attachments_media_type_check"
    CHECK (
      (
        "kind" = 'model_file'
        AND "media_type" IN ('image/jpeg', 'image/png', 'image/webp')
      )
      OR
      (
        "kind" = 'document_text'
        AND "media_type" IN (
          'text/plain',
          'text/markdown',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/pdf'
        )
      )
    ),
  ADD CONSTRAINT "agent_platform_attachments_projection_check"
    CHECK (
      (
        "kind" = 'model_file'
        AND "document_text" IS NULL
        AND "document_char_count" IS NULL
        AND "document_page_count" IS NULL
        AND "document_index" IS NULL
        AND "document_index_version" IS NULL
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
            AND "document_index" IS NULL
            AND "document_index_version" IS NULL
          )
          OR
          (
            "status" IN ('ready', 'revoked')
            AND "document_text" IS NOT NULL
            AND "document_char_count" = char_length("document_text")
            AND "document_char_count" BETWEEN 1 AND 200000
            AND "document_index" IS NOT NULL
            AND "document_index_version" = 'story-source-material-index/v1'
          )
          OR
          (
            "status" = 'revoked'
            AND "document_text" IS NULL
            AND "document_char_count" IS NULL
            AND "document_page_count" IS NULL
            AND "document_index" IS NULL
            AND "document_index_version" IS NULL
          )
        )
      )
    ),
  ADD CONSTRAINT "agent_platform_attachments_lifecycle_check"
    CHECK (
      (
        "status" = 'processing'
        AND "kind" = 'document_text'
        AND "ready_at" IS NULL
        AND "revoked_at" IS NULL
        AND "content_hash" IS NULL
        AND "error" IS NULL
      )
      OR
      (
        "status" = 'ready'
        AND "ready_at" IS NOT NULL
        AND "revoked_at" IS NULL
        AND "error" IS NULL
        AND "content_hash" IS NOT NULL
      )
      OR
      (
        "status" = 'failed'
        AND "kind" = 'document_text'
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
        AND "revoked_at" IS NOT NULL
      )
    );

CREATE TABLE "agent_platform_attachment_ingest_jobs" (
  "id" UUID NOT NULL,
  "attachment_id" UUID NOT NULL,
  "status" "AgentPlatformAttachmentIngestJobStatus" NOT NULL DEFAULT 'queued',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL,
  "stage" VARCHAR(64) NOT NULL DEFAULT 'queued',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_token" UUID,
  "lease_until" TIMESTAMPTZ(6),
  "last_heartbeat_at" TIMESTAMPTZ(6),
  "error" JSONB,
  "completed_at" TIMESTAMPTZ(6),
  "dead_lettered_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_platform_attachment_ingest_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_platform_attachment_ingest_jobs_attachment_fkey"
    FOREIGN KEY ("attachment_id")
    REFERENCES "agent_platform_attachments" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "agent_attachment_ingest_jobs_attempt_check"
    CHECK (
      "attempt_count" BETWEEN 0 AND "max_attempts"
      AND "max_attempts" BETWEEN 1 AND 10
    ),
  CONSTRAINT "agent_attachment_ingest_jobs_progress_check"
    CHECK ("progress" BETWEEN 0 AND 100),
  CONSTRAINT "agent_attachment_ingest_jobs_lifecycle_check"
    CHECK (
      (
        "status" IN ('queued', 'retry_wait')
        AND "lease_token" IS NULL
        AND "lease_until" IS NULL
        AND "completed_at" IS NULL
        AND "dead_lettered_at" IS NULL
      )
      OR
      (
        "status" = 'leased'
        AND "attempt_count" > 0
        AND "lease_token" IS NOT NULL
        AND "lease_until" IS NOT NULL
        AND "last_heartbeat_at" IS NOT NULL
        AND "completed_at" IS NULL
        AND "dead_lettered_at" IS NULL
      )
      OR
      (
        "status" = 'succeeded'
        AND "progress" = 100
        AND "lease_token" IS NULL
        AND "lease_until" IS NULL
        AND "completed_at" IS NOT NULL
        AND "dead_lettered_at" IS NULL
        AND "error" IS NULL
      )
      OR
      (
        "status" = 'dead_lettered'
        AND "lease_token" IS NULL
        AND "lease_until" IS NULL
        AND "completed_at" IS NOT NULL
        AND "dead_lettered_at" IS NOT NULL
        AND jsonb_typeof("error") = 'object'
      )
      OR
      (
        "status" = 'cancelled'
        AND "lease_token" IS NULL
        AND "lease_until" IS NULL
        AND "completed_at" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "agent_attachment_ingest_jobs_attachment_unique"
  ON "agent_platform_attachment_ingest_jobs" ("attachment_id");

CREATE INDEX "agent_attachment_ingest_jobs_claim_idx"
  ON "agent_platform_attachment_ingest_jobs" (
    "status",
    "available_at",
    "lease_until",
    "created_at",
    "id"
  );

CREATE TABLE "agent_document_analysis_jobs" (
  "id" UUID NOT NULL,
  "attachment_id" UUID NOT NULL,
  "analysis_version" VARCHAR(64) NOT NULL,
  "source_content_hash" VARCHAR(64) NOT NULL,
  "status" "AgentDocumentAnalysisJobStatus" NOT NULL DEFAULT 'queued',
  "temporal_workflow_id" VARCHAR(256),
  "dispatch_attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_dispatch_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatch_lease_token" UUID,
  "dispatch_lease_until" TIMESTAMPTZ(6),
  "stage" VARCHAR(64) NOT NULL DEFAULT 'queued',
  "completed_units" INTEGER NOT NULL DEFAULT 0,
  "total_units" INTEGER NOT NULL,
  "error" JSONB,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "dead_lettered_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_document_analysis_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_document_analysis_jobs_attachment_fkey"
    FOREIGN KEY ("attachment_id")
    REFERENCES "agent_platform_attachments" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "agent_document_analysis_jobs_source_hash_check"
    CHECK ("source_content_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "agent_document_analysis_jobs_version_check"
    CHECK (char_length(btrim("analysis_version")) BETWEEN 1 AND 64),
  CONSTRAINT "agent_document_analysis_jobs_progress_check"
    CHECK (
      "total_units" > 0
      AND "completed_units" BETWEEN 0 AND "total_units"
      AND "dispatch_attempt_count" BETWEEN 0 AND 20
    ),
  CONSTRAINT "agent_document_analysis_jobs_lifecycle_check"
    CHECK (
      (
        "status" = 'queued'
        AND "completed_at" IS NULL
        AND "dead_lettered_at" IS NULL
      )
      OR
      (
        "status" = 'dispatching'
        AND "dispatch_lease_token" IS NOT NULL
        AND "dispatch_lease_until" IS NOT NULL
        AND "completed_at" IS NULL
        AND "dead_lettered_at" IS NULL
      )
      OR
      (
        "status" IN ('running', 'reducing')
        AND "temporal_workflow_id" IS NOT NULL
        AND "started_at" IS NOT NULL
        AND "completed_at" IS NULL
        AND "dead_lettered_at" IS NULL
      )
      OR
      (
        "status" = 'succeeded'
        AND "temporal_workflow_id" IS NOT NULL
        AND "completed_units" = "total_units"
        AND "completed_at" IS NOT NULL
        AND "dead_lettered_at" IS NULL
        AND "error" IS NULL
      )
      OR
      (
        "status" = 'failed'
        AND "completed_at" IS NOT NULL
        AND "dead_lettered_at" IS NULL
        AND jsonb_typeof("error") = 'object'
      )
      OR
      (
        "status" = 'dead_lettered'
        AND "completed_at" IS NOT NULL
        AND "dead_lettered_at" IS NOT NULL
        AND jsonb_typeof("error") = 'object'
      )
      OR
      (
        "status" = 'cancelled'
        AND "completed_at" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "agent_document_analysis_jobs_source_unique"
  ON "agent_document_analysis_jobs" (
    "attachment_id",
    "analysis_version",
    "source_content_hash"
  );

CREATE INDEX "agent_document_analysis_jobs_dispatch_idx"
  ON "agent_document_analysis_jobs" (
    "status",
    "next_dispatch_at",
    "dispatch_lease_until",
    "created_at",
    "id"
  );

CREATE TABLE "agent_document_analysis_artifacts" (
  "id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "kind" "AgentDocumentAnalysisArtifactKind" NOT NULL,
  "level" INTEGER NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "source_chunk_ids" TEXT[] NOT NULL,
  "input_artifact_ids" UUID[] NOT NULL,
  "content" JSONB NOT NULL,
  "content_hash" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_document_analysis_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_document_analysis_artifacts_job_fkey"
    FOREIGN KEY ("job_id")
    REFERENCES "agent_document_analysis_jobs" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "agent_document_analysis_artifacts_coordinate_check"
    CHECK ("level" >= 0 AND "ordinal" >= 0),
  CONSTRAINT "agent_document_analysis_artifacts_content_check"
    CHECK (
      jsonb_typeof("content") = 'object'
      AND "content_hash" ~ '^[a-f0-9]{64}$'
      AND cardinality("source_chunk_ids") BETWEEN 1 AND 256
      AND array_position("source_chunk_ids", NULL) IS NULL
      AND cardinality("input_artifact_ids") <= 8
      AND array_position("input_artifact_ids", NULL) IS NULL
      AND (
        (
          "kind" = 'section'
          AND "level" = 0
          AND cardinality("input_artifact_ids") = 0
        )
        OR
        (
          "kind" IN ('reduce', 'final')
          AND "level" > 0
          AND cardinality("input_artifact_ids") BETWEEN 1 AND 8
        )
      )
    )
);

CREATE UNIQUE INDEX "agent_document_analysis_artifacts_coordinate_unique"
  ON "agent_document_analysis_artifacts" ("job_id", "kind", "level", "ordinal");

CREATE INDEX "agent_document_analysis_artifacts_job_idx"
  ON "agent_document_analysis_artifacts" ("job_id", "kind", "level", "ordinal");
