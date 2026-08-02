-- Make the crew's review agreement explicit instead of negotiating revision
-- rounds in chat. NULL is deliberately "unlimited"; zero means the first
-- submission must be approved or the task policy must be changed.

ALTER TABLE "crew_tasks"
  ADD COLUMN "revision_limit" INTEGER,
  ADD COLUMN "revision_rounds_used" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "crew_tasks"
  ADD CONSTRAINT "crew_tasks_revision_limit_check"
    CHECK ("revision_limit" IS NULL OR "revision_limit" BETWEEN 0 AND 100),
  ADD CONSTRAINT "crew_tasks_revision_rounds_used_check"
    CHECK ("revision_rounds_used" BETWEEN 0 AND 100),
  ADD CONSTRAINT "crew_tasks_revision_policy_consistency_check"
    CHECK (
      "revision_limit" IS NULL
      OR "revision_rounds_used" <= "revision_limit"
    );
