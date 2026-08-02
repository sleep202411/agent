UPDATE "crew_production_activity"
SET "content" = jsonb_set(
  "content",
  '{content,0,attrs}',
  jsonb_build_object('id', gen_random_uuid()::text),
  true
)
WHERE "kind" IN ('comment', 'update')
  AND "content" IS NOT NULL
  AND "content" #> '{content,0,attrs}' IS NULL;
