-- A Story project is a container; every screenplay belongs to one chapter.
-- The project draft remains the merged graph authority, while exact Script
-- lineage moves to the chapter whose graph was compiled from that Script.

ALTER TABLE "studio_documents"
  ADD COLUMN "story_chapter_id" UUID;

ALTER TABLE "story_chapters"
  ADD COLUMN "source_script_document_id" UUID,
  ADD COLUMN "source_script_version_id" UUID,
  ADD COLUMN "source_script_sequence" INTEGER,
  ADD COLUMN "source_script_hash" VARCHAR(64);

-- Existing project-scoped Scripts predate chapter ownership. Preserve them by
-- assigning each one to the project's canonical first chapter. Projects are
-- required to have a chapter; fail closed instead of leaving an ambiguous doc.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "studio_documents" document
    WHERE document."story_project_id" IS NOT NULL
      AND document."type" = 'script'::"StudioDocumentType"
      AND NOT EXISTS (
        SELECT 1
        FROM "story_chapters" chapter
        WHERE chapter."story_project_id" = document."story_project_id"
      )
  ) THEN
    RAISE EXCEPTION 'Cannot scope a Story Script because its project has no chapter';
  END IF;
END $$;

UPDATE "studio_documents" document
SET "story_chapter_id" = (
  SELECT candidate."id"
  FROM "story_chapters" candidate
  WHERE candidate."story_project_id" = document."story_project_id"
  ORDER BY candidate."archived_at" NULLS FIRST, candidate."rank", candidate."id"
  LIMIT 1
)
WHERE document."story_project_id" IS NOT NULL
  AND document."type" = 'script'::"StudioDocumentType";

-- Preserve the lineage written by the immediately preceding screenplay
-- migration, but attach it to the owning chapter instead of the global draft.
UPDATE "story_chapters" chapter
SET "source_script_document_id" = draft."source_script_document_id",
    "source_script_version_id" = draft."source_script_version_id",
    "source_script_sequence" = draft."source_script_sequence",
    "source_script_hash" = draft."source_script_hash"
FROM "story_drafts" draft
JOIN "studio_documents" document
  ON document."id" = draft."source_script_document_id"
WHERE chapter."id" = document."story_chapter_id"
  AND chapter."story_project_id" = draft."story_project_id"
  AND draft."source_script_document_id" IS NOT NULL;

DROP INDEX "studio_documents_story_project_type_active_unique";

CREATE UNIQUE INDEX "studio_documents_story_project_type_active_unique"
  ON "studio_documents" ("story_project_id", "type")
  WHERE "story_project_id" IS NOT NULL
    AND "story_chapter_id" IS NULL
    AND "status" = 'active'::"StudioDocumentStatus"
    AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "studio_documents_story_chapter_type_active_unique"
  ON "studio_documents" ("story_chapter_id", "type")
  WHERE "story_chapter_id" IS NOT NULL
    AND "status" = 'active'::"StudioDocumentStatus"
    AND "deleted_at" IS NULL;

CREATE INDEX "studio_documents_story_chapter_type_recent_idx"
  ON "studio_documents" ("story_chapter_id", "type", "updated_at" DESC);

ALTER TABLE "studio_documents"
  ADD CONSTRAINT "studio_documents_story_chapter_requires_project_check"
    CHECK ("story_chapter_id" IS NULL OR "story_project_id" IS NOT NULL),
  ADD CONSTRAINT "studio_documents_story_script_requires_chapter_check"
    CHECK (
      "story_project_id" IS NULL
      OR "type" <> 'script'::"StudioDocumentType"
      OR "story_chapter_id" IS NOT NULL
    ),
  ADD CONSTRAINT "studio_documents_story_chapter_project_fkey"
    FOREIGN KEY ("story_chapter_id", "story_project_id")
    REFERENCES "story_chapters" ("id", "story_project_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "story_chapters"
  ADD CONSTRAINT "story_chapters_script_lineage_all_or_none_check"
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
  ),
  ADD CONSTRAINT "story_chapters_source_script_document_fkey"
    FOREIGN KEY ("source_script_document_id")
    REFERENCES "studio_documents" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "story_chapters_source_script_version_document_fkey"
    FOREIGN KEY ("source_script_version_id", "source_script_document_id")
    REFERENCES "studio_document_versions" ("id", "document_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "story_chapters_source_script_document_idx"
  ON "story_chapters" ("source_script_document_id", "source_script_sequence");

-- A plain FK proves that a source Script exists; this trigger proves that it
-- is the Script owned by this exact chapter and that the recorded sequence is
-- the approved immutable version's sequence.
CREATE FUNCTION "story_chapter_script_lineage_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_chapter_id UUID;
  source_type "StudioDocumentType";
  version_sequence INTEGER;
BEGIN
  IF NEW."source_script_document_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT document."story_chapter_id", document."type", version."sequence"
    INTO source_chapter_id, source_type, version_sequence
  FROM "studio_documents" document
  JOIN "studio_document_versions" version
    ON version."id" = NEW."source_script_version_id"
   AND version."document_id" = document."id"
  WHERE document."id" = NEW."source_script_document_id";

  IF source_chapter_id IS DISTINCT FROM NEW."id"
     OR source_type <> 'script'::"StudioDocumentType"
     OR version_sequence IS DISTINCT FROM NEW."source_script_sequence" THEN
    RAISE EXCEPTION 'Story chapter Script lineage must reference its own approved Script version';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "story_chapter_script_lineage_guard_trigger"
BEFORE INSERT OR UPDATE OF
  "source_script_document_id",
  "source_script_version_id",
  "source_script_sequence",
  "source_script_hash"
ON "story_chapters"
FOR EACH ROW
EXECUTE FUNCTION "story_chapter_script_lineage_guard"();

ALTER TABLE "story_drafts"
  DROP CONSTRAINT "story_drafts_source_script_version_document_fkey",
  DROP CONSTRAINT "story_drafts_source_script_document_fkey",
  DROP CONSTRAINT "story_drafts_script_lineage_all_or_none_check";

DROP INDEX "story_drafts_source_script_document_idx";

ALTER TABLE "story_drafts"
  DROP COLUMN "source_script_document_id",
  DROP COLUMN "source_script_version_id",
  DROP COLUMN "source_script_sequence",
  DROP COLUMN "source_script_hash";
