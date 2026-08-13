-- Promote collaborative documents from a PlatformProject-only implementation
-- to the product-neutral StudioDocument aggregate. A document belongs to
-- exactly one Platform project or one Story project; there is no synthetic
-- project bridge and no dual-write period.

BEGIN;

ALTER TYPE "PlatformDocumentType" RENAME TO "StudioDocumentType";
ALTER TYPE "PlatformDocumentStatus" RENAME TO "StudioDocumentStatus";
ALTER TYPE "PlatformDocumentVersionSource" RENAME TO "StudioDocumentVersionSource";
ALTER TYPE "PlatformDocumentOperationType" RENAME TO "StudioDocumentOperationType";
ALTER TYPE "PlatformDocumentCommentStatus" RENAME TO "StudioDocumentCommentStatus";

ALTER TABLE "platform_documents" RENAME TO "studio_documents";
ALTER TABLE "platform_document_versions" RENAME TO "studio_document_versions";
ALTER TABLE "platform_document_operations" RENAME TO "studio_document_operations";
ALTER TABLE "platform_document_presence" RENAME TO "studio_document_presence";
ALTER TABLE "platform_document_comment_threads" RENAME TO "studio_document_comment_threads";
ALTER TABLE "platform_document_comments" RENAME TO "studio_document_comments";

ALTER TABLE "studio_documents" RENAME COLUMN "project_id" TO "platform_project_id";
ALTER TABLE "studio_documents" ADD COLUMN "story_project_id" UUID;
ALTER TABLE "studio_documents" ALTER COLUMN "platform_project_id" DROP NOT NULL;

ALTER TABLE "studio_documents"
  DROP CONSTRAINT "platform_documents_project_workspace_fk",
  DROP CONSTRAINT "platform_documents_section_project_fk";

ALTER TABLE "studio_documents"
  ADD CONSTRAINT "studio_documents_platform_project_workspace_fk"
  FOREIGN KEY ("platform_project_id", "workspace_id")
  REFERENCES "platform_projects"("id", "workspace_id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "studio_documents_story_project_workspace_fk"
  FOREIGN KEY ("story_project_id", "workspace_id")
  REFERENCES "story_projects"("id", "workspace_id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "studio_documents_section_platform_project_fk"
  FOREIGN KEY ("section_id", "platform_project_id")
  REFERENCES "platform_project_sections"("id", "project_id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "studio_documents_exactly_one_owner_chk"
  CHECK (num_nonnulls("platform_project_id", "story_project_id") = 1),
  ADD CONSTRAINT "studio_documents_story_has_no_section_chk"
  CHECK ("story_project_id" IS NULL OR "section_id" IS NULL);

ALTER TABLE "studio_documents" RENAME CONSTRAINT "platform_documents_workspace_fk" TO "studio_documents_workspace_fk";
ALTER TABLE "studio_documents" RENAME CONSTRAINT "platform_documents_slug_format_chk" TO "studio_documents_slug_format_chk";
ALTER TABLE "studio_documents" RENAME CONSTRAINT "platform_documents_sequence_nonnegative_chk" TO "studio_documents_sequence_nonnegative_chk";
ALTER TABLE "studio_documents" RENAME CONSTRAINT "platform_documents_id_workspace_unique" TO "studio_documents_id_workspace_unique";

ALTER TABLE "studio_document_versions" RENAME CONSTRAINT "platform_document_versions_document_fk" TO "studio_document_versions_document_fk";
ALTER TABLE "studio_document_versions" RENAME CONSTRAINT "platform_document_versions_number_positive_chk" TO "studio_document_versions_number_positive_chk";
ALTER TABLE "studio_document_versions" RENAME CONSTRAINT "platform_document_versions_sequence_nonnegative_chk" TO "studio_document_versions_sequence_nonnegative_chk";
ALTER TABLE "studio_document_operations" RENAME CONSTRAINT "platform_document_operations_document_fk" TO "studio_document_operations_document_fk";
ALTER TABLE "studio_document_operations" RENAME CONSTRAINT "platform_document_operations_sequence_positive_chk" TO "studio_document_operations_sequence_positive_chk";
ALTER TABLE "studio_document_operations" RENAME CONSTRAINT "platform_document_operations_base_sequence_chk" TO "studio_document_operations_base_sequence_chk";
ALTER TABLE "studio_document_operations" RENAME CONSTRAINT "platform_document_operations_payload_chk" TO "studio_document_operations_payload_chk";
ALTER TABLE "studio_document_presence" RENAME CONSTRAINT "platform_document_presence_document_fk" TO "studio_document_presence_document_fk";
ALTER TABLE "studio_document_comment_threads" RENAME CONSTRAINT "platform_document_comment_threads_document_fk" TO "studio_document_comment_threads_document_fk";
ALTER TABLE "studio_document_comments" RENAME CONSTRAINT "platform_document_comments_thread_fk" TO "studio_document_comments_thread_fk";

ALTER INDEX "platform_documents_room_unique" RENAME TO "studio_documents_room_unique";
ALTER INDEX "platform_documents_workspace_recent_idx" RENAME TO "studio_documents_workspace_recent_idx";
ALTER INDEX "platform_documents_status_recent_idx" RENAME TO "studio_documents_status_recent_idx";
ALTER INDEX "platform_documents_section_type_recent_idx" RENAME TO "studio_documents_section_type_recent_idx";
ALTER INDEX "platform_documents_section_type_active_unique" RENAME TO "studio_documents_section_type_active_unique";
DROP INDEX "platform_documents_project_type_recent_idx";
DROP INDEX "platform_documents_project_slug_unique";
CREATE INDEX "studio_documents_platform_project_type_recent_idx"
  ON "studio_documents" ("platform_project_id", "type", "updated_at" DESC);
CREATE INDEX "studio_documents_story_project_type_recent_idx"
  ON "studio_documents" ("story_project_id", "type", "updated_at" DESC);
CREATE UNIQUE INDEX "studio_documents_platform_project_slug_unique"
  ON "studio_documents" ("platform_project_id", LOWER("slug"))
  WHERE "platform_project_id" IS NOT NULL AND "slug" IS NOT NULL AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "studio_documents_story_project_slug_unique"
  ON "studio_documents" ("story_project_id", LOWER("slug"))
  WHERE "story_project_id" IS NOT NULL AND "slug" IS NOT NULL AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "studio_documents_story_project_type_active_unique"
  ON "studio_documents" ("story_project_id", "type")
  WHERE "story_project_id" IS NOT NULL
    AND "status" = 'active'::"StudioDocumentStatus"
    AND "deleted_at" IS NULL;

ALTER INDEX "platform_document_versions_doc_number_unique" RENAME TO "studio_document_versions_doc_number_unique";
ALTER INDEX "platform_document_versions_doc_recent_idx" RENAME TO "studio_document_versions_doc_recent_idx";
ALTER INDEX "platform_document_operations_doc_sequence_unique" RENAME TO "studio_document_operations_doc_sequence_unique";
ALTER INDEX "platform_document_operations_idempotency_unique" RENAME TO "studio_document_operations_idempotency_unique";
ALTER INDEX "platform_document_operations_doc_recent_idx" RENAME TO "studio_document_operations_doc_recent_idx";
ALTER INDEX "platform_document_operations_actor_recent_idx" RENAME TO "studio_document_operations_actor_recent_idx";
ALTER INDEX "platform_document_presence_connection_unique" RENAME TO "studio_document_presence_connection_unique";
ALTER INDEX "platform_document_presence_active_idx" RENAME TO "studio_document_presence_active_idx";
ALTER INDEX "platform_document_comment_threads_doc_status_idx" RENAME TO "studio_document_comment_threads_doc_status_idx";
ALTER INDEX "platform_document_comment_threads_block_idx" RENAME TO "studio_document_comment_threads_block_idx";
ALTER INDEX "platform_document_comments_doc_idx" RENAME TO "studio_document_comments_doc_idx";
ALTER INDEX "platform_document_comments_thread_idx" RENAME TO "studio_document_comments_thread_idx";

-- One-time, lossless ownership migration for Story's former JSON canvas. The
-- materialized snapshot is copied here; the server's document-state invariant
-- service encodes it to canonical Yjs state before accepting traffic.
CREATE TEMP TABLE "_story_studio_document_map" (
  "story_project_id" UUID PRIMARY KEY,
  "document_id" UUID NOT NULL UNIQUE,
  "version_id" UUID NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO "_story_studio_document_map" ("story_project_id", "document_id", "version_id")
SELECT canvas."story_project_id", gen_random_uuid(), gen_random_uuid()
FROM "story_production_canvases" canvas;

INSERT INTO "studio_documents" (
  "id", "workspace_id", "platform_project_id", "story_project_id", "type",
  "status", "title", "schema_version", "collaboration_dialect",
  "collaboration_room_id", "content_snapshot", "current_sequence",
  "snapshot_sequence", "current_version_id", "created_by_id", "updated_by_id",
  "created_at", "updated_at"
)
SELECT
  mapped."document_id", project."workspace_id", NULL, project."id",
  'canvas'::"StudioDocumentType", 'active'::"StudioDocumentStatus", project."title",
  '2026-05-27', 'fizzdragon.document.v1', gen_random_uuid(), canvas."content",
  0, 0, mapped."version_id", project."created_by_user_id",
  canvas."updated_by_user_id", canvas."created_at", canvas."updated_at"
FROM "_story_studio_document_map" mapped
JOIN "story_production_canvases" canvas
  ON canvas."story_project_id" = mapped."story_project_id"
JOIN "story_projects" project
  ON project."id" = mapped."story_project_id";

INSERT INTO "studio_document_versions" (
  "id", "document_id", "version_number", "schema_version", "sequence",
  "title", "source", "snapshot", "metadata", "created_by_id", "created_at"
)
SELECT
  mapped."version_id", mapped."document_id", 1, '2026-05-27', 0,
  project."title", 'system'::"StudioDocumentVersionSource", canvas."content",
  '{"reason":"migrated_story_production_canvas"}'::jsonb,
  canvas."updated_by_user_id", canvas."updated_at"
FROM "_story_studio_document_map" mapped
JOIN "story_production_canvases" canvas
  ON canvas."story_project_id" = mapped."story_project_id"
JOIN "story_projects" project
  ON project."id" = mapped."story_project_id";

DROP TABLE "story_production_canvases";

ALTER TABLE "ai_jobs" ADD COLUMN "story_project_id" UUID;
ALTER TABLE "ai_jobs"
  ADD CONSTRAINT "ai_jobs_story_project_fk"
  FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id"),
  ADD CONSTRAINT "ai_jobs_story_project_requires_workspace_chk"
  CHECK ("story_project_id" IS NULL OR "workspace_id" IS NOT NULL);
CREATE INDEX "ai_jobs_story_project_created_idx"
  ON "ai_jobs" ("story_project_id", "created_at" DESC);

COMMIT;
