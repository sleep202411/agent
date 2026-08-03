ALTER TABLE "crews"
ADD COLUMN "studio_project_id" UUID;

CREATE UNIQUE INDEX "crews_studio_project_unique"
ON "crews"("studio_project_id");

ALTER TABLE "crews"
ADD CONSTRAINT "crews_studio_project_id_fkey"
FOREIGN KEY ("studio_project_id")
REFERENCES "platform_projects"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
