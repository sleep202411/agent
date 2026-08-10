-- Finish the neutral StudioDocument rename at the physical database layer and
-- make AI generation project ownership as unambiguous as document ownership.

ALTER TABLE "studio_documents"
  RENAME CONSTRAINT "platform_documents_pkey" TO "studio_documents_pkey";
ALTER TABLE "studio_document_versions"
  RENAME CONSTRAINT "platform_document_versions_pkey" TO "studio_document_versions_pkey";
ALTER TABLE "studio_document_operations"
  RENAME CONSTRAINT "platform_document_operations_pkey" TO "studio_document_operations_pkey";
ALTER TABLE "studio_document_presence"
  RENAME CONSTRAINT "platform_document_presence_pkey" TO "studio_document_presence_pkey";
ALTER TABLE "studio_document_comment_threads"
  RENAME CONSTRAINT "platform_document_comment_threads_pkey" TO "studio_document_comment_threads_pkey";
ALTER TABLE "studio_document_comments"
  RENAME CONSTRAINT "platform_document_comments_pkey" TO "studio_document_comments_pkey";

ALTER TABLE "ai_jobs"
  ADD CONSTRAINT "ai_jobs_at_most_one_project_owner_chk"
  CHECK (num_nonnulls("project_id", "story_project_id") <= 1);
