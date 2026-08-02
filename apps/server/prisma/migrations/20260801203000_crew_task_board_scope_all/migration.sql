UPDATE "crew_task_views"
SET "scope" = 'all'
WHERE "is_system" = true
  AND "name" = 'board';
