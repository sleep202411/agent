-- `authoring_failed` is a retryable drafting state and therefore participates
-- in the one-active-request-per-conversation unique index. Older Agent OS runs
-- also used it as a terminal state by setting the attempt counter to five.
-- Once their terminal receipt was delivered those rows could neither be
-- superseded nor leave the unique index, permanently rejecting the next
-- `story.author` request. Normalize terminal drafting failures to the existing
-- immutable `failed` state and make that the durable lifecycle contract.

ALTER TABLE "story_agent_runs"
  DROP CONSTRAINT "story_agent_runs_v2_phase_status_check";

-- Historical delivered failures are protected by this trigger. The migration
-- is the one controlled transition that corrects their status; the trigger is
-- restored before the transaction commits.
DROP TRIGGER "story_agent_runs_decision_v2_immutability_trg"
  ON "story_agent_runs";

UPDATE "story_agent_runs"
SET
  "status" = 'failed'::"StoryAgentRunStatus",
  "completed_at" = COALESCE("completed_at", transaction_timestamp()),
  "lease_owner" = NULL,
  "lease_acquired_at" = NULL,
  "lease_expires_at" = NULL,
  "fencing_token" = NULL,
  "updated_at" = transaction_timestamp()
WHERE "status" = 'authoring_failed'::"StoryAgentRunStatus"
  AND (
    "decision_contract_version" = 2
    OR "authoring_attempts" >= 5
  );

CREATE TRIGGER "story_agent_runs_decision_v2_immutability_trg"
BEFORE UPDATE ON "story_agent_runs"
FOR EACH ROW
EXECUTE FUNCTION "story_agent_runs_decision_v2_immutability_guard"();

-- A v2 run may now terminate as `failed` either before a proposal exists
-- (authoring failure) or after an approved proposal (apply failure). Only the
-- former two branches differ from the preceding constraint definition.
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
  );
