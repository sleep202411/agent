-- A ready `document` artifact carries BOTH its source file and the text
-- projection extracted from it. The lifecycle check predates that.
--
-- `studio_agent_artifacts_lifecycle_chk` was written in
-- 20260724130000_studio_agent_runtime_foundation, when a document was only ever
-- a pointer at a MediaAsset, so its ready branch grouped 'media' and 'document'
-- together and required `value IS NULL AND content_hash IS NULL`. Six hours
-- later 20260724193000_studio_agent_document_ingest_worker added nine ingest_*
-- columns to this same table to drive text extraction — and never touched the
-- constraint. Since then EVERY document upload has failed at
-- StudioAgentArtifactService.finalizeDocumentReady, which writes the projection
-- into `value` on a row that already holds `media_asset_id`: Postgres 23514.
--
-- 'media' keeps the pointer-only shape. 'document' gets its own branch that
-- requires BOTH halves, deliberately:
--   - the MediaAsset is the durable original the user uploaded;
--   - the projection is what the agent actually reads;
-- a ready document missing either one is not usable, and extraction failure
-- already has its own path (finalizeDocumentFailure → status 'failed'), so
-- "ready with no projection" would be a state nothing produces and nothing
-- knows how to consume.
--
-- The 2 MiB ceiling carries over to the document branch: the projection is JSON
-- like every other inline value, and the reason for bounding it — keeping a row
-- readable in one shot — does not change with the kind that produced it.

ALTER TABLE "studio_agent_artifacts"
  DROP CONSTRAINT "studio_agent_artifacts_lifecycle_chk";

ALTER TABLE "studio_agent_artifacts"
  ADD CONSTRAINT "studio_agent_artifacts_lifecycle_chk" CHECK (
    CASE "status"
      WHEN 'pending' THEN "ready_at" IS NULL AND "error" IS NULL
      WHEN 'failed' THEN "ready_at" IS NULL AND "studio_agent_is_error"("error")
      WHEN 'ready' THEN
        "ready_at" IS NOT NULL
        AND "error" IS NULL
        AND (
          (
            "kind" = 'media'
            AND "media_asset_id" IS NOT NULL
            AND "value" IS NULL
            AND "content_hash" IS NULL
          )
          OR
          (
            "kind" = 'document'
            AND "media_asset_id" IS NOT NULL
            AND "value" IS NOT NULL
            AND "content_hash" IS NOT NULL
            AND octet_length(convert_to("value"::text, 'UTF8')) <= 2097152
          )
          OR
          (
            "kind" IN ('text', 'structured_data', 'bundle')
            AND "media_asset_id" IS NULL
            AND "value" IS NOT NULL
            AND "content_hash" IS NOT NULL
            AND octet_length(convert_to("value"::text, 'UTF8')) <= 2097152
          )
        )
      ELSE false
    END
  );
