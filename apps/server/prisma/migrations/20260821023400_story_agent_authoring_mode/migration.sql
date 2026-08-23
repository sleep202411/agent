CREATE TYPE "StoryAgentAuthoringMode" AS ENUM (
  'screenplay_required',
  'downstream_reconcile',
  'noop'
);

ALTER TABLE "story_agent_runs"
  ADD COLUMN "authoring_mode" "StoryAgentAuthoringMode";

COMMENT ON COLUMN "story_agent_runs"."authoring_mode" IS
  'Canonical server-selected authoring route; never accepted from model or browser input.';
