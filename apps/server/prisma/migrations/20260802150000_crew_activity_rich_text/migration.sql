ALTER TABLE "crew_production_activity"
  DROP CONSTRAINT "crew_production_activity_shape";

ALTER TABLE "crew_production_activity"
  RENAME COLUMN "body" TO "plain_text";

ALTER TABLE "crew_production_activity"
  ADD COLUMN "content" JSONB;

UPDATE "crew_production_activity"
SET "content" = jsonb_build_object(
  'type', 'doc',
  'content', jsonb_build_array(
    jsonb_build_object(
      'type', 'paragraph',
      'content', jsonb_build_array(
        jsonb_build_object('type', 'text', 'text', "plain_text")
      )
    )
  )
)
WHERE "kind" IN ('comment', 'update');

ALTER TABLE "crew_production_activity"
  ADD CONSTRAINT "crew_production_activity_content_document"
    CHECK (
      "content" IS NULL OR (
        jsonb_typeof("content") = 'object' AND
        "content" ->> 'type' = 'doc' AND
        jsonb_typeof("content" -> 'content') = 'array'
      )
    ),
  ADD CONSTRAINT "crew_production_activity_shape"
    CHECK (
      (
        "kind" = 'update' AND
        "health" IS NOT NULL AND
        "content" IS NOT NULL AND
        btrim("plain_text") <> ''
      ) OR
      (
        "kind" = 'comment' AND
        "health" IS NULL AND
        "progress" IS NULL AND
        "content" IS NOT NULL AND
        btrim("plain_text") <> ''
      ) OR
      (
        "kind" NOT IN ('update', 'comment') AND
        "health" IS NULL AND
        "progress" IS NULL AND
        "content" IS NULL AND
        "plain_text" = ''
      )
    );
