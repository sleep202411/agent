ALTER TABLE "story_agent_runs"
  ADD COLUMN "source_auto_applied_at" TIMESTAMPTZ(6);

ALTER TABLE "story_agent_runs"
  ADD CONSTRAINT "story_agent_runs_auto_apply_contract_check" CHECK (
    "source_auto_applied_at" IS NULL
    OR (
      "decision_contract_version" = 2
      AND "source_agent_run_id" IS NOT NULL
      AND "source_proposal_ready_delivered_at" IS NULL
      AND "source_approval_id" IS NULL
      AND "source_approval_decision" IS NULL
      AND "confirmed_by_user_id" IS NOT NULL
      AND "confirmed_at" IS NOT NULL
      AND "applying_at" IS NOT NULL
    )
  );

CREATE FUNCTION "story_agent_runs_auto_apply_immutability_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."source_auto_applied_at" IS NOT NULL
     AND NEW."source_auto_applied_at" IS DISTINCT FROM OLD."source_auto_applied_at" THEN
    RAISE EXCEPTION 'A Story Agent auto-apply authorization is immutable once recorded.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_agent_runs_auto_apply_immutability_trg"
BEFORE UPDATE ON "story_agent_runs"
FOR EACH ROW
EXECUTE FUNCTION "story_agent_runs_auto_apply_immutability_guard"();

ALTER TABLE "story_agent_runs"
  DROP CONSTRAINT "story_agent_runs_v2_phase_status_check";

ALTER TABLE "story_agent_runs"
  ADD CONSTRAINT "story_agent_runs_v2_phase_status_check" CHECK (
    "decision_contract_version" <> 2
    OR "source_agent_run_id" IS NULL
    OR (
      (
        "source_auto_applied_at" IS NOT NULL
        AND "source_proposal_ready_delivered_at" IS NULL
        AND "source_approval_id" IS NULL
        AND "status" = ANY (ARRAY['applying','succeeded','failed','cancelled','stale']::"StoryAgentRunStatus"[])
        AND (
          "source_terminal_delivered_at" IS NULL
          OR "status" = ANY (ARRAY['succeeded','failed','cancelled','stale']::"StoryAgentRunStatus"[])
        )
      )
      OR (
        "source_auto_applied_at" IS NULL
        AND (
          (
            (
              "source_proposal_ready_delivered_at" IS NULL
              AND "source_approval_id" IS NULL
              AND (
                "status" = ANY (ARRAY['authoring','authoring_failed','proposed','failed','cancelled','stale']::"StoryAgentRunStatus"[])
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
                "status" = ANY (ARRAY['failed','cancelled','stale']::"StoryAgentRunStatus"[])
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
      )
    )
  );
