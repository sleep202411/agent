-- AlterTable
ALTER TABLE "crew_tasks" ADD COLUMN "metadata" JSONB;

-- CreateTable
CREATE TABLE "project_task_templates" (
    "id" UUID NOT NULL,
    "project_type" "CrewProductionKind" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "definition" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "project_task_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_task_templates_project_type_active_idx" ON "project_task_templates"("project_type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "project_task_templates_project_type_version_key" ON "project_task_templates"("project_type", "version");
