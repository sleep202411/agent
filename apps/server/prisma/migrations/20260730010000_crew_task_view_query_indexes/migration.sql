-- Persisted task views execute search, quick filters, counts, and pagination
-- in PostgreSQL. These indexes keep that contract responsive as a crew's
-- issue history grows; trigram indexes cover partial title/description/label
-- searches without introducing a separately synchronized search document.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "crew_tasks_crew_priority_rank_idx"
  ON "crew_tasks" ("crew_id", "priority", "rank", "id");

CREATE INDEX "crew_tasks_crew_updated_idx"
  ON "crew_tasks" ("crew_id", "updated_at" DESC, "id" DESC);

CREATE INDEX "crew_tasks_title_trgm_idx"
  ON "crew_tasks" USING GIN ("title" gin_trgm_ops);

CREATE INDEX "crew_tasks_description_trgm_idx"
  ON "crew_tasks" USING GIN ("description" gin_trgm_ops);

CREATE INDEX "crew_task_labels_name_trgm_idx"
  ON "crew_task_labels" USING GIN ("name" gin_trgm_ops);
