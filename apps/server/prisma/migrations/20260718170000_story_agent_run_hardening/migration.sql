-- Durable confirmation/cancellation attribution and bounded proposal lifecycle.
-- Conversation history remains private; proposal decisions are project-shared.

BEGIN;

ALTER TABLE "story_agent_runs"
  ADD COLUMN "confirmed_by_user_id" VARCHAR(64),
  ADD COLUMN "cancelled_by_user_id" VARCHAR(64),
  ADD COLUMN "expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "confirmed_at" TIMESTAMPTZ(6),
  ADD COLUMN "cancelled_at" TIMESTAMPTZ(6);

UPDATE "story_agent_runs"
SET
  "expires_at" = "proposed_at" + interval '24 hours',
  "confirmed_by_user_id" = CASE
    WHEN "applying_at" IS NOT NULL THEN "initiated_by_user_id"
    ELSE NULL
  END,
  "confirmed_at" = "applying_at",
  "cancelled_by_user_id" = CASE
    WHEN "status" = 'cancelled' THEN "initiated_by_user_id"
    ELSE NULL
  END,
  "cancelled_at" = CASE
    WHEN "status" = 'cancelled' THEN "completed_at"
    ELSE NULL
  END;

ALTER TABLE "story_agent_runs"
  ALTER COLUMN "expires_at" SET NOT NULL;

-- Legacy local rows may predate the one-proposal-per-conversation invariant.
-- Keep only the newest proposal in each scope before installing the index.
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY
        "story_project_id",
        "initiated_by_user_id",
        COALESCE("conversation_id", '')
      ORDER BY "created_at" DESC, "id" DESC
    ) AS scope_rank
  FROM "story_agent_runs"
  WHERE "status" = 'proposed'
)
UPDATE "story_agent_runs" AS run
SET
  "status" = 'stale',
  "completed_at" = transaction_timestamp(),
  "error_code" = 'STORY_AGENT_SUPERSEDED_IN_CONVERSATION',
  "error_detail" = 'A newer proposal from the same conversation superseded this proposal.',
  "updated_at" = transaction_timestamp()
FROM ranked
WHERE run."id" = ranked."id"
  AND ranked.scope_rank > 1;

-- The service serializes proposal creation on story_project_write_states and
-- refuses the 65th active proposal. Normalize any pre-invariant local data.
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "story_project_id"
      ORDER BY "created_at" DESC, "id" DESC
    ) AS project_rank
  FROM "story_agent_runs"
  WHERE "status" = 'proposed'
)
UPDATE "story_agent_runs" AS run
SET
  "status" = 'stale',
  "completed_at" = transaction_timestamp(),
  "error_code" = 'STORY_AGENT_PROJECT_PROPOSAL_LIMIT_NORMALIZED',
  "error_detail" = 'The proposal exceeded the project active-proposal limit during schema hardening.',
  "updated_at" = transaction_timestamp()
FROM ranked
WHERE run."id" = ranked."id"
  AND ranked.project_rank > 64;

-- One live pre-confirmation run (drafting, failed drafting, or proposed) per
-- creator conversation scope: a newer request supersedes the older one.
CREATE UNIQUE INDEX "story_agent_runs_active_conversation_proposal_unique"
  ON "story_agent_runs" (
    "story_project_id",
    "initiated_by_user_id",
    COALESCE("conversation_id", '')
  )
  WHERE "status" IN ('authoring', 'authoring_failed', 'proposed');

CREATE INDEX "story_agent_runs_proposal_expiry_idx"
  ON "story_agent_runs" ("status", "expires_at", "id");

ALTER TABLE "story_agent_runs"
  ADD CONSTRAINT "story_agent_runs_expiry_chk" CHECK (
    "expires_at" > "proposed_at"
  ),
  ADD CONSTRAINT "story_agent_runs_decision_actor_pair_chk" CHECK (
    (("confirmed_by_user_id" IS NULL) = ("confirmed_at" IS NULL)) AND
    (("cancelled_by_user_id" IS NULL) = ("cancelled_at" IS NULL))
  ),
  ADD CONSTRAINT "story_agent_runs_decision_lifecycle_chk" CHECK (
    (
      "status" IN ('authoring', 'authoring_failed') AND
      "confirmed_by_user_id" IS NULL AND
      "cancelled_by_user_id" IS NULL
    ) OR (
      "status" = 'proposed' AND
      "confirmed_by_user_id" IS NULL AND
      "cancelled_by_user_id" IS NULL
    ) OR (
      "status" = 'applying' AND
      "confirmed_by_user_id" IS NOT NULL AND
      "cancelled_by_user_id" IS NULL
    ) OR (
      "status" = 'succeeded' AND
      "confirmed_by_user_id" IS NOT NULL AND
      "cancelled_by_user_id" IS NULL
    ) OR (
      "status" IN ('failed', 'stale') AND
      "cancelled_by_user_id" IS NULL
    ) OR (
      "status" = 'cancelled' AND
      "confirmed_by_user_id" IS NULL AND
      "cancelled_by_user_id" IS NOT NULL
    )
  );

COMMIT;
