-- The staged screenplay approval re-arms the SAME run back into `authoring`
-- for downstream reconciliation after the creator confirmed it, and the
-- downstream self-approval path later requires that recorded confirmation to
-- enter `applying`. The v2 decision-lifecycle check predates the two-phase
-- apply and forbade any confirmed run from re-entering `authoring`. Allow a
-- confirmed run in `authoring`/`authoring_failed` exactly when the
-- server-selected authoring route is a post-approval continuation
-- (`downstream_reconcile`, or `noop` when production converged concurrently).
-- A confirmed run in `authoring` without such a mode stays illegal: a
-- confirmed run must never re-author the reviewable screenplay.
ALTER TABLE "story_agent_runs"
  DROP CONSTRAINT "story_agent_runs_decision_lifecycle_chk";

ALTER TABLE "story_agent_runs"
  ADD CONSTRAINT "story_agent_runs_decision_lifecycle_chk" CHECK (
    (
      "status" IN ('authoring'::"StoryAgentRunStatus", 'authoring_failed'::"StoryAgentRunStatus")
      AND "cancelled_by_user_id" IS NULL
      AND (
        "confirmed_by_user_id" IS NULL
        OR "authoring_mode" IN (
          'downstream_reconcile'::"StoryAgentAuthoringMode",
          'noop'::"StoryAgentAuthoringMode"
        )
      )
    )
    OR (
      "status" = 'proposed'::"StoryAgentRunStatus"
      AND "confirmed_by_user_id" IS NULL
      AND "cancelled_by_user_id" IS NULL
    )
    OR (
      "status" = 'applying'::"StoryAgentRunStatus"
      AND "confirmed_by_user_id" IS NOT NULL
      AND "cancelled_by_user_id" IS NULL
    )
    OR (
      "status" = 'succeeded'::"StoryAgentRunStatus"
      AND "confirmed_by_user_id" IS NOT NULL
      AND "cancelled_by_user_id" IS NULL
    )
    OR (
      "status" IN ('failed'::"StoryAgentRunStatus", 'stale'::"StoryAgentRunStatus")
      AND "cancelled_by_user_id" IS NULL
    )
    OR (
      "status" = 'cancelled'::"StoryAgentRunStatus"
      AND "confirmed_by_user_id" IS NULL
      AND "cancelled_by_user_id" IS NOT NULL
    )
  );
