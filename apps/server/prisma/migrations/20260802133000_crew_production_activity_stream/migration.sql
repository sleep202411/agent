CREATE TYPE "CrewProductionActivityKind" AS ENUM (
  'comment',
  'update',
  'project_created',
  'properties_changed',
  'labels_changed',
  'resource_added',
  'resource_removed'
);

ALTER TABLE "crew_production_updates" RENAME TO "crew_production_activity";
ALTER INDEX "crew_production_updates_pkey" RENAME TO "crew_production_activity_pkey";
ALTER INDEX "crew_production_updates_recent_idx" RENAME TO "crew_production_activity_recent_idx";

ALTER TABLE "crew_production_activity"
  RENAME CONSTRAINT "crew_production_updates_crew_id_fkey"
  TO "crew_production_activity_crew_id_fkey";

ALTER TABLE "crew_production_activity"
  DROP CONSTRAINT "crew_production_updates_body_nonempty",
  DROP CONSTRAINT "crew_production_updates_progress_range",
  ADD COLUMN "kind" "CrewProductionActivityKind" NOT NULL DEFAULT 'update',
  ADD COLUMN "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ALTER COLUMN "health" DROP NOT NULL,
  ALTER COLUMN "health" DROP DEFAULT,
  ADD CONSTRAINT "crew_production_activity_payload_object"
    CHECK (jsonb_typeof("payload") = 'object'),
  ADD CONSTRAINT "crew_production_activity_progress_range"
    CHECK ("progress" IS NULL OR ("progress" >= 0 AND "progress" <= 100)),
  ADD CONSTRAINT "crew_production_activity_shape"
    CHECK (
      ("kind" = 'update' AND "health" IS NOT NULL AND btrim("body") <> '') OR
      ("kind" = 'comment' AND "health" IS NULL AND "progress" IS NULL AND btrim("body") <> '') OR
      ("kind" NOT IN ('update', 'comment') AND "health" IS NULL AND "progress" IS NULL AND "body" = '')
    );

INSERT INTO "crew_production_activity" (
  "id", "crew_id", "kind", "health", "body", "progress", "payload",
  "created_by_user_id", "created_at"
)
SELECT
  gen_random_uuid(), crew."id", 'project_created', NULL, '', NULL, '{}'::jsonb,
  crew."created_by_user_id", crew."created_at"
FROM "crews" crew
WHERE crew."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "crew_production_activity" activity
    WHERE activity."crew_id" = crew."id"
      AND activity."kind" = 'project_created'
  );

INSERT INTO "crew_production_activity" (
  "id", "crew_id", "kind", "health", "body", "progress", "payload",
  "created_by_user_id", "created_at"
)
SELECT
  gen_random_uuid(), page."crew_id", 'properties_changed', NULL, '', NULL,
  jsonb_build_object(
    'changes', jsonb_build_array(
      jsonb_build_object(
        'field', 'start_date',
        'from', NULL,
        'to', to_char(page."start_date", 'YYYY-MM-DD')
      )
    )
  ),
  page."updated_by_user_id", page."updated_at"
FROM "crew_production_pages" page
WHERE page."start_date" IS NOT NULL;

INSERT INTO "crew_production_activity" (
  "id", "crew_id", "kind", "health", "body", "progress", "payload",
  "created_by_user_id", "created_at"
)
SELECT
  gen_random_uuid(), assignment."crew_id", 'labels_changed', NULL, '', NULL,
  jsonb_build_object(
    'added', jsonb_build_array(
      jsonb_build_object('id', label."id", 'name', label."name", 'color', label."color")
    ),
    'removed', '[]'::jsonb
  ),
  label."created_by_user_id", assignment."created_at"
FROM "crew_production_label_assignments" assignment
JOIN "crew_task_labels" label ON label."id" = assignment."label_id";

INSERT INTO "crew_production_activity" (
  "id", "crew_id", "kind", "health", "body", "progress", "payload",
  "created_by_user_id", "created_at"
)
SELECT
  gen_random_uuid(), resource."crew_id", 'resource_added', NULL, '', NULL,
  jsonb_build_object(
    'resource', jsonb_build_object(
      'id', resource."id",
      'title', resource."title",
      'kind', resource."kind"
    )
  ),
  resource."created_by_user_id", resource."created_at"
FROM "crew_production_resources" resource;
