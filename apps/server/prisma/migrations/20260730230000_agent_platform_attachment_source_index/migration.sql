-- Store the deterministic structural source index with the attachment so every
-- Agent Platform replica sees the same retrieval truth and source queries do
-- not rebuild an O(n) index on every model tool call.

ALTER TABLE "agent_platform_attachments"
  ADD COLUMN "document_index" JSONB,
  ADD COLUMN "document_index_version" VARCHAR(64);

-- Existing ready document projections predate the persistent index contract.
-- Invalidate them explicitly instead of silently rebuilding different indexes
-- on individual replicas. A normal attachment re-registration reprocesses the
-- original upload under the new contract.
UPDATE "agent_platform_attachments"
SET
  "status" = 'failed',
  "document_text" = NULL,
  "document_char_count" = NULL,
  "document_page_count" = NULL,
  "content_hash" = NULL,
  "document_index" = NULL,
  "document_index_version" = NULL,
  "ready_at" = NULL,
  "revoked_at" = NULL,
  "error" = jsonb_build_object(
    'code', 'AGENT_ATTACHMENT_SOURCE_INDEX_MIGRATION_REQUIRED',
    'message', 'Re-register this source attachment to build its durable document index.',
    'retryable', true
  ),
  "processing_lease_token" = NULL,
  "processing_lease_until" = NULL,
  "updated_at" = CURRENT_TIMESTAMP
WHERE
  "kind" = 'document_text'
  AND "document_text" IS NOT NULL;

ALTER TABLE "agent_platform_attachments"
  ADD CONSTRAINT "agent_platform_attachments_document_index_check"
  CHECK (
    (
      "document_text" IS NULL
      AND "document_index" IS NULL
      AND "document_index_version" IS NULL
    )
    OR
    (
      "kind" = 'document_text'
      AND "document_text" IS NOT NULL
      AND "document_index" IS NOT NULL
      AND "document_index_version" = 'story-source-material-index/v1'
      AND jsonb_typeof("document_index") = 'object'
      AND "document_index"->>'schemaVersion' = "document_index_version"
      AND "document_index"->>'contentHash' = "content_hash"
    )
  );
