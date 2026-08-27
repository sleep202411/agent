-- Story production now uses one explicit StoryAgentRun per reviewable stage.
-- A canonical no-op therefore has no proposal or human approval to record: it
-- proves that every requested stage is already current and terminates without
-- a project write. Permit only that narrow, server-selected shape to succeed
-- with no decision actor. Historical v2 downstream rows remain valid.

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
      AND "cancelled_by_user_id" IS NULL
      AND (
        "confirmed_by_user_id" IS NOT NULL
        OR (
          "confirmed_by_user_id" IS NULL
          AND "authoring_mode" = 'noop'::"StoryAgentAuthoringMode"
        )
      )
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

ALTER TABLE "story_agent_runs"
  DROP CONSTRAINT "story_agent_runs_v2_phase_status_check";

ALTER TABLE "story_agent_runs"
  ADD CONSTRAINT "story_agent_runs_v2_phase_status_check" CHECK (
    "decision_contract_version" <> 2
    OR "source_agent_run_id" IS NULL
    OR (
      (
        (
          "source_proposal_ready_delivered_at" IS NULL
          AND "source_approval_id" IS NULL
          AND (
            "status" = ANY (ARRAY['authoring','authoring_failed','proposed','cancelled','stale']::"StoryAgentRunStatus"[])
            OR (
              "status" = 'succeeded'::"StoryAgentRunStatus"
              AND "authoring_mode" = 'noop'::"StoryAgentAuthoringMode"
            )
          )
        )
        OR (
          "source_proposal_ready_delivered_at" IS NOT NULL
          AND "source_approval_id" IS NULL
          AND "status" = ANY (ARRAY['proposed','cancelled','stale']::"StoryAgentRunStatus"[])
        )
        OR (
          "source_proposal_ready_delivered_at" IS NOT NULL
          AND "source_approval_id" IS NOT NULL
          AND "source_approval_decision" = 'approve'::"StoryAgentProposalDecision"
          AND (
            "status" = ANY (ARRAY['applying','succeeded','failed','cancelled','stale']::"StoryAgentRunStatus"[])
            OR (
              "status" = ANY (ARRAY['authoring','authoring_failed']::"StoryAgentRunStatus"[])
              AND "authoring_mode" = ANY (ARRAY['downstream_reconcile','noop']::"StoryAgentAuthoringMode"[])
            )
          )
        )
        OR (
          "source_proposal_ready_delivered_at" IS NOT NULL
          AND "source_approval_id" IS NOT NULL
          AND "source_approval_decision" = 'reject'::"StoryAgentProposalDecision"
          AND "status" = 'cancelled'::"StoryAgentRunStatus"
          AND "source_terminal_delivered_at" IS NOT NULL
        )
      )
      AND (
        "source_terminal_delivered_at" IS NULL
        OR (
          "source_proposal_ready_delivered_at" IS NULL
          AND "source_approval_id" IS NULL
          AND (
            "status" = ANY (ARRAY['cancelled','stale']::"StoryAgentRunStatus"[])
            OR (
              "status" = 'authoring_failed'::"StoryAgentRunStatus"
              AND "authoring_attempts" >= 5
            )
            OR (
              "status" = 'succeeded'::"StoryAgentRunStatus"
              AND "authoring_mode" = 'noop'::"StoryAgentAuthoringMode"
            )
          )
        )
        OR (
          "source_proposal_ready_delivered_at" IS NOT NULL
          AND (
            (
              "source_approval_id" IS NULL
              AND "status" = ANY (ARRAY['cancelled','stale']::"StoryAgentRunStatus"[])
            )
            OR (
              "source_approval_id" IS NOT NULL
              AND "source_approval_decision" = 'approve'::"StoryAgentProposalDecision"
              AND "status" = ANY (ARRAY['succeeded','failed','cancelled','stale']::"StoryAgentRunStatus"[])
            )
            OR (
              "source_approval_id" IS NOT NULL
              AND "source_approval_decision" = 'reject'::"StoryAgentProposalDecision"
              AND "status" = 'cancelled'::"StoryAgentRunStatus"
            )
          )
        )
      )
    )
  );
