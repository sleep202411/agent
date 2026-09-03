-- Planned character specs stay linked to the canonical Script character that
-- produced them. Human-authored specs are independent workbench records and
-- may intentionally have no Script source.
ALTER TABLE "story_asset_specs"
  DROP CONSTRAINT "story_asset_specs_character_source_chk",
  ADD CONSTRAINT "story_asset_specs_character_source_chk" CHECK (
    (
      "kind" = 'character'::"StoryAssetSpecKind"
      AND (
        "source_character_id" IS NOT NULL
        OR "plan_disposition" = 'user_override'::"StoryProductionPlanDisposition"
      )
    )
    OR (
      "kind" <> 'character'::"StoryAssetSpecKind"
      AND "source_character_id" IS NULL
    )
  );

CREATE OR REPLACE FUNCTION "story_asset_spec_source_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_node JSONB;
BEGIN
  FOR source_node IN SELECT value FROM jsonb_array_elements(NEW."source_node_ids")
  LOOP
    IF jsonb_typeof(source_node) <> 'string' OR NOT EXISTS (
      SELECT 1
      FROM "studio_documents" document
      JOIN "studio_document_versions" version
        ON version."id" = document."current_version_id"
       AND version."document_id" = document."id"
       AND version."sequence" = document."current_sequence"
      WHERE document."story_project_id" = NEW."story_project_id"
        AND document."story_chapter_id" = NEW."story_chapter_id"
        AND document."type" = 'script'::"StudioDocumentType"
        AND document."status" = 'active'::"StudioDocumentStatus"
        AND document."deleted_at" IS NULL
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            COALESCE(version."snapshot" #> '{screenplay,scenes}', '[]'::JSONB)
          ) scene
          WHERE scene ->> 'nodeId' = source_node #>> '{}'
        )
    ) THEN
      RAISE EXCEPTION 'Asset Spec source node must be owned by the same Story chapter Script';
    END IF;
  END LOOP;

  IF NEW."kind" = 'character'
     AND NEW."source_character_id" IS NOT NULL
     AND NOT EXISTS (
      SELECT 1
      FROM "studio_documents" document
      JOIN "studio_document_versions" version
        ON version."id" = document."current_version_id"
       AND version."document_id" = document."id"
       AND version."sequence" = document."current_sequence"
      WHERE document."story_project_id" = NEW."story_project_id"
        AND document."story_chapter_id" = NEW."story_chapter_id"
        AND document."type" = 'script'::"StudioDocumentType"
        AND document."status" = 'active'::"StudioDocumentStatus"
        AND document."deleted_at" IS NULL
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            COALESCE(version."snapshot" #> '{screenplay,characters}', '[]'::JSONB)
          ) character
          WHERE character ->> 'id' = NEW."source_character_id"
        )
    ) THEN
    RAISE EXCEPTION 'Character Asset Spec must reference a canonical character in the same Story chapter Script';
  END IF;
  RETURN NEW;
END $$;
