CREATE UNIQUE INDEX "studio_document_versions_id_document_unique"
  ON "studio_document_versions"("id", "document_id");

ALTER TABLE "story_drafts"
  DROP CONSTRAINT "story_drafts_source_script_version_fkey",
  ADD CONSTRAINT "story_drafts_source_script_version_document_fkey"
    FOREIGN KEY ("source_script_version_id", "source_script_document_id")
    REFERENCES "studio_document_versions"("id", "document_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
