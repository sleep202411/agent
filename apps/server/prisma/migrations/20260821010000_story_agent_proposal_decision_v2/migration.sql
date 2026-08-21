-- Story proposal decisions are a durable continuation of the originating
-- Agent OS turn. Existing handoffs stay on v1 and are never reopened; every
-- registration/run created after this migration defaults to v2.
CREATE TYPE "StoryAgentProposalDecision" AS ENUM ('approve', 'reject');

ALTER TABLE "story_agent_runs"
  ADD COLUMN "decision_contract_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "source_proposal_ready_delivered_at" TIMESTAMPTZ(6),
  ADD COLUMN "source_terminal_delivered_at" TIMESTAMPTZ(6),
  ADD COLUMN "source_approval_id" UUID,
  ADD COLUMN "source_approval_response_id" UUID,
  ADD COLUMN "source_approval_response_text" VARCHAR(300),
  ADD COLUMN "source_approval_locale" VARCHAR(16),
  ADD COLUMN "source_approval_decision_turn_id" UUID,
  ADD COLUMN "source_approval_decision" "StoryAgentProposalDecision",
  ADD COLUMN "source_approval_decided_at" TIMESTAMPTZ(6),
  ADD COLUMN "source_approval_decided_by_user_id" VARCHAR(64);

ALTER TABLE "agent_os_external_handoff_registrations"
  ADD COLUMN "decision_contract_version" INTEGER NOT NULL DEFAULT 1;

-- Backfill is the DEFAULT 1 above. Switch only future inserts to v2 after all
-- historical rows and registrations have been permanently classified as v1.
ALTER TABLE "story_agent_runs"
  ALTER COLUMN "decision_contract_version" SET DEFAULT 2;
ALTER TABLE "agent_os_external_handoff_registrations"
  ALTER COLUMN "decision_contract_version" SET DEFAULT 2;

-- The contract version and phase receipts classify durable history. Shape
-- CHECKs cannot stop a later UPDATE from erasing a valid phase or converting a
-- historical v1 row into v2. Keep those fields append-only at the database
-- boundary while still allowing delivery lease/retry bookkeeping to change.
CREATE FUNCTION "story_agent_runs_decision_v2_immutability_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."decision_contract_version" IS DISTINCT FROM OLD."decision_contract_version" THEN
    RAISE EXCEPTION 'Story Agent decision contract version is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" IN ('succeeded', 'failed', 'cancelled', 'stale')
     AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'Terminal Story Agent run status is immutable'
      USING ERRCODE = '23514';
  END IF;

  -- v1 used the legacy result receipt for a budget-exhausted authoring
  -- failure. Once that terminal continuation was delivered, neither lowering
  -- the attempt counter nor clearing the receipt may make it retryable again.
  IF OLD."decision_contract_version" = 1
     AND OLD."status" = 'authoring_failed'
     AND OLD."authoring_attempts" >= 5
     AND OLD."source_result_delivered_at" IS NOT NULL
     AND (
       NEW."status" IS DISTINCT FROM OLD."status"
       OR NEW."authoring_attempts" < OLD."authoring_attempts"
       OR NEW."source_result_delivered_at"
         IS DISTINCT FROM OLD."source_result_delivered_at"
     ) THEN
    RAISE EXCEPTION 'Delivered v1 terminal authoring failure cannot be reopened'
      USING ERRCODE = '23514';
  END IF;

  -- Hitting the durable authoring retry budget is terminal for generation.
  -- It may still be classified as cancelled/stale, but lowering the counter or
  -- returning to a productive state would reopen an already exhausted job.
  IF OLD."status" = 'authoring_failed'
     AND OLD."authoring_attempts" >= 5
     AND (
       NEW."authoring_attempts" < OLD."authoring_attempts"
       OR NEW."status" NOT IN ('authoring_failed', 'cancelled', 'stale')
     ) THEN
    RAISE EXCEPTION 'Retry-budget-exhausted Story authoring cannot be reopened'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."source_proposal_ready_delivered_at" IS NOT NULL
     AND NEW."source_proposal_ready_delivered_at"
       IS DISTINCT FROM OLD."source_proposal_ready_delivered_at" THEN
    RAISE EXCEPTION 'Story Agent proposal-ready receipt is immutable once written'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."source_approval_id" IS NOT NULL
     AND ROW(
       NEW."source_approval_id",
       NEW."source_approval_response_id",
       NEW."source_approval_response_text",
       NEW."source_approval_locale",
       NEW."source_approval_decision_turn_id",
       NEW."source_approval_decision",
       NEW."source_approval_decided_at",
       NEW."source_approval_decided_by_user_id"
     ) IS DISTINCT FROM ROW(
       OLD."source_approval_id",
       OLD."source_approval_response_id",
       OLD."source_approval_response_text",
       OLD."source_approval_locale",
       OLD."source_approval_decision_turn_id",
       OLD."source_approval_decision",
       OLD."source_approval_decided_at",
       OLD."source_approval_decided_by_user_id"
     ) THEN
    RAISE EXCEPTION 'Story Agent approval receipt is immutable once written'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."source_terminal_delivered_at" IS NOT NULL
     AND NEW."source_terminal_delivered_at"
       IS DISTINCT FROM OLD."source_terminal_delivered_at" THEN
    RAISE EXCEPTION 'Story Agent terminal receipt is immutable once written'
      USING ERRCODE = '23514';
  END IF;

  -- A terminal Story state can legitimately receive its terminal delivery
  -- marker later. It cannot acquire a proposal or approval after the fact,
  -- even during that pre-receipt delivery window.
  IF (
       OLD."status" IN ('succeeded', 'failed', 'cancelled', 'stale')
       OR (
         OLD."status" = 'authoring_failed'
         AND OLD."authoring_attempts" >= 5
       )
     )
     AND (
       NEW."source_proposal_ready_delivered_at"
         IS DISTINCT FROM OLD."source_proposal_ready_delivered_at"
       OR ROW(
         NEW."source_approval_id",
         NEW."source_approval_response_id",
         NEW."source_approval_response_text",
         NEW."source_approval_locale",
         NEW."source_approval_decision_turn_id",
         NEW."source_approval_decision",
         NEW."source_approval_decided_at",
         NEW."source_approval_decided_by_user_id"
       ) IS DISTINCT FROM ROW(
         OLD."source_approval_id",
         OLD."source_approval_response_id",
         OLD."source_approval_response_text",
         OLD."source_approval_locale",
         OLD."source_approval_decision_turn_id",
         OLD."source_approval_decision",
         OLD."source_approval_decided_at",
         OLD."source_approval_decided_by_user_id"
       )
     ) THEN
    RAISE EXCEPTION 'A terminal Story Agent run cannot gain an earlier phase'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."source_terminal_delivered_at" IS NOT NULL
     AND (
       NEW."status" IS DISTINCT FROM OLD."status"
       OR NEW."source_proposal_ready_delivered_at"
         IS DISTINCT FROM OLD."source_proposal_ready_delivered_at"
       OR ROW(
         NEW."source_approval_id",
         NEW."source_approval_response_id",
         NEW."source_approval_response_text",
         NEW."source_approval_locale",
         NEW."source_approval_decision_turn_id",
         NEW."source_approval_decision",
         NEW."source_approval_decided_at",
         NEW."source_approval_decided_by_user_id"
       ) IS DISTINCT FROM ROW(
         OLD."source_approval_id",
         OLD."source_approval_response_id",
         OLD."source_approval_response_text",
         OLD."source_approval_locale",
         OLD."source_approval_decision_turn_id",
         OLD."source_approval_decision",
         OLD."source_approval_decided_at",
         OLD."source_approval_decided_by_user_id"
       )
     ) THEN
    RAISE EXCEPTION 'A terminal Story Agent receipt cannot gain or rewrite an earlier phase'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "story_agent_runs_decision_v2_immutability_trg"
BEFORE UPDATE ON "story_agent_runs"
FOR EACH ROW
EXECUTE FUNCTION "story_agent_runs_decision_v2_immutability_guard"();

CREATE FUNCTION "agent_os_external_handoffs_contract_immutability_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."decision_contract_version" IS DISTINCT FROM OLD."decision_contract_version" THEN
    RAISE EXCEPTION 'Agent OS external handoff decision contract version is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "agent_os_external_handoffs_contract_immutability_trg"
BEFORE UPDATE OF "decision_contract_version"
ON "agent_os_external_handoff_registrations"
FOR EACH ROW
EXECUTE FUNCTION "agent_os_external_handoffs_contract_immutability_guard"();

ALTER TABLE "story_agent_runs"
  ADD CONSTRAINT "story_agent_runs_decision_contract_version_check"
    CHECK ("decision_contract_version" IN (1, 2)),
  ADD CONSTRAINT "story_agent_runs_source_approval_tuple_check"
    CHECK (
      (
        "source_approval_id" IS NULL
        AND "source_approval_response_id" IS NULL
        AND "source_approval_response_text" IS NULL
        AND "source_approval_locale" IS NULL
        AND "source_approval_decision_turn_id" IS NULL
        AND "source_approval_decision" IS NULL
        AND "source_approval_decided_at" IS NULL
        AND "source_approval_decided_by_user_id" IS NULL
      )
      OR
      (
        "source_approval_id" IS NOT NULL
        AND "source_approval_response_id" IS NOT NULL
        AND "source_approval_response_text" IS NOT NULL
        AND "source_approval_locale" IS NOT NULL
        AND "source_approval_decision_turn_id" IS NOT NULL
        AND "source_approval_decision" IS NOT NULL
        AND "source_approval_decided_at" IS NOT NULL
        AND "source_approval_decided_by_user_id" IS NOT NULL
      )
    ),
  ADD CONSTRAINT "story_agent_runs_source_approval_copy_check"
    CHECK (
      "source_approval_response_text" IS NULL
      OR (
        length(btrim("source_approval_response_text")) > 0
        AND "source_approval_locale" IN ('en-US', 'zh-CN', 'zh-HK')
      )
    ),
  ADD CONSTRAINT "story_agent_runs_v2_delivery_origin_check"
    CHECK (
      (
        "source_proposal_ready_delivered_at" IS NULL
        AND "source_terminal_delivered_at" IS NULL
        AND "source_approval_id" IS NULL
      )
      OR
      (
        "decision_contract_version" = 2
        AND "source_agent_run_id" IS NOT NULL
      )
    ),
  ADD CONSTRAINT "story_agent_runs_v2_decision_after_proposal_check"
    CHECK (
      "source_approval_id" IS NULL
      OR "source_proposal_ready_delivered_at" IS NOT NULL
    ),
  ADD CONSTRAINT "story_agent_runs_v2_phase_status_check"
    CHECK (
      "decision_contract_version" <> 2
      OR "source_agent_run_id" IS NULL
      OR (
        (
          "source_proposal_ready_delivered_at" IS NULL
          AND "source_approval_id" IS NULL
          AND "status" IN (
            'authoring', 'authoring_failed', 'proposed', 'cancelled', 'stale'
          )
        )
        OR (
          "source_proposal_ready_delivered_at" IS NOT NULL
          AND "source_approval_id" IS NULL
          AND "status" IN ('proposed', 'cancelled', 'stale')
        )
        OR (
          "source_proposal_ready_delivered_at" IS NOT NULL
          AND "source_approval_id" IS NOT NULL
          AND "source_approval_decision" = 'approve'
          AND "status" IN (
            'applying', 'succeeded', 'failed', 'cancelled', 'stale'
          )
        )
        OR (
          "source_proposal_ready_delivered_at" IS NOT NULL
          AND "source_approval_id" IS NOT NULL
          AND "source_approval_decision" = 'reject'
          AND "status" = 'cancelled'
          AND "source_terminal_delivered_at" IS NOT NULL
        )
      )
      AND (
        "source_terminal_delivered_at" IS NULL
        OR (
          "source_proposal_ready_delivered_at" IS NULL
          AND "source_approval_id" IS NULL
          AND (
            "status" IN ('cancelled', 'stale')
            OR (
              "status" = 'authoring_failed'
              AND "authoring_attempts" >= 5
            )
          )
        )
        OR (
          "source_proposal_ready_delivered_at" IS NOT NULL
          AND (
            (
              "source_approval_id" IS NULL
              AND "status" IN ('cancelled', 'stale')
            )
            OR (
              "source_approval_id" IS NOT NULL
              AND "source_approval_decision" = 'approve'
              AND "status" IN (
                'succeeded', 'failed', 'cancelled', 'stale'
              )
            )
            OR (
              "source_approval_id" IS NOT NULL
              AND "source_approval_decision" = 'reject'
              AND "status" = 'cancelled'
            )
          )
        )
      )
    ),
  ADD CONSTRAINT "story_agent_runs_v1_delivery_exclusive_check"
    CHECK (
      "decision_contract_version" <> 2
      OR "source_result_delivered_at" IS NULL
    );

ALTER TABLE "agent_os_external_handoff_registrations"
  ADD CONSTRAINT "agent_os_external_handoffs_decision_contract_version_check"
    CHECK ("decision_contract_version" IN (1, 2));

CREATE UNIQUE INDEX "story_agent_runs_source_approval_response_unique"
  ON "story_agent_runs" ("source_approval_response_id");
CREATE UNIQUE INDEX "story_agent_runs_source_approval_unique"
  ON "story_agent_runs" ("source_agent_run_id", "source_approval_id");

ALTER TABLE "story_agent_runs"
  DROP CONSTRAINT "story_agent_runs_source_delivery_terminal_check",
  ADD CONSTRAINT "story_agent_runs_source_delivery_terminal_check"
    CHECK (
      (
        "source_result_delivered_at" IS NULL
        AND "source_terminal_delivered_at" IS NULL
      )
      OR (
        "source_result_delivery_next_attempt_at" IS NULL
        AND "source_result_delivery_lease_owner" IS NULL
        AND "source_result_delivery_lease_expires_at" IS NULL
        AND "source_result_delivery_last_error" IS NULL
      )
    );

DROP INDEX "story_agent_runs_agent_os_delivery_pending_idx";
CREATE INDEX "story_agent_runs_agent_os_delivery_pending_idx"
  ON "story_agent_runs" (
    "source_result_delivery_next_attempt_at",
    "source_result_delivery_lease_expires_at",
    "id"
  )
  WHERE "source_agent_run_id" IS NOT NULL
    AND (
      (
        "decision_contract_version" = 1
        AND "source_result_delivered_at" IS NULL
        AND "status" IN (
          'proposed', 'applying', 'succeeded', 'failed',
          'authoring_failed', 'cancelled', 'stale'
        )
      )
      OR
      (
        "decision_contract_version" = 2
        AND "source_terminal_delivered_at" IS NULL
        AND (
          (
            "source_proposal_ready_delivered_at" IS NULL
            AND "status" IN ('proposed', 'authoring_failed', 'cancelled', 'stale')
          )
          OR
          (
            "source_proposal_ready_delivered_at" IS NOT NULL
            AND "status" IN ('succeeded', 'failed', 'cancelled', 'stale')
          )
        )
      )
    );
