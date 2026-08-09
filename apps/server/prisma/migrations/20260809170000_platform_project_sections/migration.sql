-- Introduce a first-class project section boundary. Every active canvas is
-- assigned to exactly one section, and every non-deleted project leaves this
-- migration with at least one section + canvas document.

BEGIN;

CREATE TABLE "platform_project_sections" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "rank" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" VARCHAR(64) NOT NULL,
  "updated_by_id" VARCHAR(64),
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "platform_project_sections_project_workspace_fk"
    FOREIGN KEY ("project_id", "workspace_id")
    REFERENCES "platform_projects"("id", "workspace_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "platform_project_sections_rank_nonnegative_chk"
    CHECK ("rank" >= 0),
  CONSTRAINT "platform_project_sections_title_nonempty_chk"
    CHECK (length(btrim("title")) > 0)
);

ALTER TABLE "platform_project_sections"
  ADD CONSTRAINT "platform_project_sections_id_project_unique"
  UNIQUE ("id", "project_id");

CREATE INDEX "platform_project_sections_project_rank_idx"
  ON "platform_project_sections" ("project_id", "archived_at", "rank");

CREATE INDEX "platform_project_sections_workspace_recent_idx"
  ON "platform_project_sections" ("workspace_id", "updated_at" DESC);

ALTER TABLE "platform_documents"
  ADD COLUMN "section_id" UUID;

CREATE TEMP TABLE "_platform_section_canvas_map" (
  "section_id" UUID PRIMARY KEY,
  "document_id" UUID NOT NULL UNIQUE,
  "project_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "rank" INTEGER NOT NULL,
  "created_by_id" VARCHAR(64) NOT NULL,
  "create_document" BOOLEAN NOT NULL
) ON COMMIT DROP;

-- Preserve every active canvas. If historical code created more than one,
-- each becomes an ordered section instead of being discarded.
INSERT INTO "_platform_section_canvas_map" (
  "section_id", "document_id", "project_id", "workspace_id", "title",
  "rank", "created_by_id", "create_document"
)
SELECT
  gen_random_uuid(),
  document."id",
  project."id",
  project."workspace_id",
  COALESCE(NULLIF(btrim(document."title"), ''), project."name"),
  (row_number() OVER (
    PARTITION BY project."id"
    ORDER BY document."created_at", document."id"
  ) - 1)::INTEGER,
  project."created_by_id",
  FALSE
FROM "platform_projects" project
JOIN "platform_documents" document
  ON document."project_id" = project."id"
 AND document."type" = 'canvas'::"PlatformDocumentType"
 AND document."status" = 'active'::"PlatformDocumentStatus"
 AND document."deleted_at" IS NULL
WHERE project."deleted_at" IS NULL;

-- Projects that never opened the canvas still receive a complete first
-- section now. Runtime code may therefore treat the invariant as mandatory.
INSERT INTO "_platform_section_canvas_map" (
  "section_id", "document_id", "project_id", "workspace_id", "title",
  "rank", "created_by_id", "create_document"
)
SELECT
  gen_random_uuid(),
  gen_random_uuid(),
  project."id",
  project."workspace_id",
  project."name",
  0,
  project."created_by_id",
  TRUE
FROM "platform_projects" project
WHERE project."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "_platform_section_canvas_map" mapped
    WHERE mapped."project_id" = project."id"
  );

INSERT INTO "platform_project_sections" (
  "id", "workspace_id", "project_id", "title", "rank", "created_by_id"
)
SELECT
  "section_id", "workspace_id", "project_id", "title", "rank", "created_by_id"
FROM "_platform_section_canvas_map";

UPDATE "platform_documents" document
SET "section_id" = mapped."section_id"
FROM "_platform_section_canvas_map" mapped
WHERE document."id" = mapped."document_id"
  AND mapped."create_document" = FALSE;

INSERT INTO "platform_documents" (
  "id", "workspace_id", "project_id", "section_id", "type", "title",
  "created_by_id"
)
SELECT
  "document_id", "workspace_id", "project_id", "section_id",
  'canvas'::"PlatformDocumentType", "title", "created_by_id"
FROM "_platform_section_canvas_map"
WHERE "create_document" = TRUE;

CREATE TEMP TABLE "_platform_section_initial_versions" (
  "version_id" UUID PRIMARY KEY,
  "document_id" UUID NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO "_platform_section_initial_versions" ("version_id", "document_id")
SELECT gen_random_uuid(), "document_id"
FROM "_platform_section_canvas_map"
WHERE "create_document" = TRUE;

INSERT INTO "platform_document_versions" (
  "id", "document_id", "version_number", "schema_version", "sequence",
  "title", "source", "snapshot", "metadata", "created_by_id"
)
SELECT
  initial."version_id",
  mapped."document_id",
  1,
  '2026-05-27',
  0,
  mapped."title",
  'system'::"PlatformDocumentVersionSource",
  '{}'::jsonb,
  '{"reason":"initial_section_canvas"}'::jsonb,
  mapped."created_by_id"
FROM "_platform_section_canvas_map" mapped
JOIN "_platform_section_initial_versions" initial
  ON initial."document_id" = mapped."document_id";

UPDATE "platform_documents" document
SET "current_version_id" = initial."version_id"
FROM "_platform_section_initial_versions" initial
WHERE document."id" = initial."document_id";

ALTER TABLE "platform_documents"
  ADD CONSTRAINT "platform_documents_section_project_fk"
  FOREIGN KEY ("section_id", "project_id")
  REFERENCES "platform_project_sections"("id", "project_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "platform_documents_section_type_recent_idx"
  ON "platform_documents" ("section_id", "type", "updated_at" DESC);

CREATE UNIQUE INDEX "platform_documents_section_type_active_unique"
  ON "platform_documents" ("section_id", "type")
  WHERE "section_id" IS NOT NULL
    AND "status" = 'active'::"PlatformDocumentStatus"
    AND "deleted_at" IS NULL;

COMMIT;
