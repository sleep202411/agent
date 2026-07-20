-- story_agent_runs.authoring_stages existed in the Prisma schema and code
-- (StoryAgentRunWorkerService reads it) but no migration ever created it — it
-- was only added to local dev via `db push`, so prod built the table without it
-- and every findMany() failed. Nullable JSONB, matching the model
-- (`authoringStages Json? @map("authoring_stages") @db.JsonB`).
-- IF NOT EXISTS: local dev already got this column via `db push`, so the
-- repair migration must be a no-op there while still adding it on prod / CN.
ALTER TABLE "story_agent_runs" ADD COLUMN IF NOT EXISTS "authoring_stages" JSONB;
