CREATE TABLE crew_task_delivery_templates (
  task_id UUID PRIMARY KEY REFERENCES crew_tasks(id) ON DELETE CASCADE,
  category_id UUID NOT NULL,
  category_version INTEGER NOT NULL,
  FOREIGN KEY(category_id,category_version) REFERENCES crew_delivery_catalog_revisions(category_id,version)
);
ALTER TABLE crew_task_submissions ADD COLUMN professional_delivery JSONB;
