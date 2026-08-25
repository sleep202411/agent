-- Companion to 20260821023700: the staged screenplay approval re-arms an
-- APPROVED Agent-OS-managed (v2) run back into `authoring` for downstream
-- reconciliation. The v2 phase-status check predated the two-phase apply and
-- only allowed applying/succeeded/failed/cancelled/stale after an approve
-- decision, so the re-arm UPDATE failed at COMMIT and the run wedged in
-- `applying` on an infinite worker retry. Allow `authoring`/`authoring_failed`
-- after approval exactly when the server-selected route is a post-approval
-- continuation (downstream_reconcile, or noop when production converged
-- concurrently). Terminal-delivery shapes are unchanged: a delivered terminal
-- with an approve decision still requires succeeded/failed/cancelled/stale.
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
          AND "status" = ANY (ARRAY['authoring','authoring_failed','proposed','cancelled','stale']::"StoryAgentRunStatus"[])
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
            OR ("status" = 'authoring_failed'::"StoryAgentRunStatus" AND "authoring_attempts" >= 5)
          )
        )
        OR (
          "source_proposal_ready_delivered_at" IS NOT NULL
          AND (
            ("source_approval_id" IS NULL AND "status" = ANY (ARRAY['cancelled','stale']::"StoryAgentRunStatus"[]))
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
