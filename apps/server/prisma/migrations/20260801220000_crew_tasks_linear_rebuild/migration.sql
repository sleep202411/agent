-- The task surface now follows a Linear-style issue model. Saved views are
-- only list/board projections; calendar/timeline are no longer separate task
-- products, and completion visibility belongs to the view itself.

DELETE FROM "crew_task_views";

ALTER TABLE "crew_task_views"
  ALTER COLUMN "layout" DROP DEFAULT,
  ALTER COLUMN "layout" TYPE TEXT USING "layout"::TEXT;

DROP TYPE "CrewTaskViewLayout";
CREATE TYPE "CrewTaskViewLayout" AS ENUM ('list', 'board');

ALTER TABLE "crew_task_views"
  ALTER COLUMN "layout" TYPE "CrewTaskViewLayout"
  USING 'list'::"CrewTaskViewLayout",
  ALTER COLUMN "layout" SET DEFAULT 'list';

ALTER TABLE "crew_task_views"
  DROP COLUMN "scope";
DROP TYPE "CrewTaskViewScope";

CREATE TYPE "CrewTaskCompletedMode" AS ENUM ('all', 'recent', 'hidden');

ALTER TABLE "crew_task_views"
  ADD COLUMN "completed_mode" "CrewTaskCompletedMode" NOT NULL DEFAULT 'all',
  ADD COLUMN "show_sub_issues" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "show_empty_groups" BOOLEAN NOT NULL DEFAULT FALSE;

-- An issue is lightweight by default. A dedicated Studio branch is attached
-- only when somebody explicitly starts canvas work from the issue.
ALTER TABLE "crew_tasks"
  ALTER COLUMN "canvas_project_id" DROP NOT NULL,
  ALTER COLUMN "canvas_document_id" DROP NOT NULL;

-- Backlog and Todo are separate workflow states in the default Linear model.
-- Existing Todo keeps the stable `open` automation key; Backlog is inserted
-- lazily by ensureDefaultWorkflowStates after positions are shifted once.
UPDATE "crew_task_workflow_states"
SET "position" = "position" + 1;
