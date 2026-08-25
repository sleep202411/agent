ALTER TABLE "story_drafts"
  ADD COLUMN "source_script_document_id" UUID,
  ADD COLUMN "source_script_version_id" UUID,
  ADD COLUMN "source_script_sequence" INTEGER,
  ADD COLUMN "source_script_hash" VARCHAR(64);

ALTER TABLE "story_drafts"
  ADD CONSTRAINT "story_drafts_script_lineage_all_or_none_check"
  CHECK (
    ("source_script_document_id" IS NULL
      AND "source_script_version_id" IS NULL
      AND "source_script_sequence" IS NULL
      AND "source_script_hash" IS NULL)
    OR
    ("source_script_document_id" IS NOT NULL
      AND "source_script_version_id" IS NOT NULL
      AND "source_script_sequence" IS NOT NULL
      AND "source_script_sequence" >= 0
      AND "source_script_hash" ~ '^[0-9a-f]{64}$')
  );

ALTER TABLE "story_drafts"
  ADD CONSTRAINT "story_drafts_source_script_document_fkey"
  FOREIGN KEY ("source_script_document_id")
  REFERENCES "studio_documents"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "story_drafts"
  ADD CONSTRAINT "story_drafts_source_script_version_fkey"
  FOREIGN KEY ("source_script_version_id")
  REFERENCES "studio_document_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "story_drafts_source_script_document_idx"
  ON "story_drafts"("source_script_document_id", "source_script_sequence");
