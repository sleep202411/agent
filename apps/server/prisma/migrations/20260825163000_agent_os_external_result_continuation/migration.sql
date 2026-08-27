ALTER TABLE "agent_os_runs"
ADD COLUMN "permission_mode" VARCHAR(16) NOT NULL DEFAULT 'smart';

ALTER TABLE "agent_os_runs"
ADD CONSTRAINT "agent_os_runs_permission_mode_check"
CHECK ("permission_mode" IN ('ask', 'smart', 'full'));
