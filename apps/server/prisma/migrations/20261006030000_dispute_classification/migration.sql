ALTER TABLE "crew_task_disputes"
  ADD COLUMN "category" varchar(24),
  ADD COLUMN "desired_resolution" varchar(32),
  ADD CONSTRAINT "crew_task_disputes_category_check"
    CHECK ("category" IN ('copyright', 'payment', 'violation', 'harassment', 'other')),
  ADD CONSTRAINT "crew_task_disputes_resolution_check"
    CHECK ("desired_resolution" IN ('payment_allocation', 'warning', 'takedown'));
