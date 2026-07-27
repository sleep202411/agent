BEGIN;

-- The preceding Copilot schema has not shipped. Its local-only rows have no
-- trustworthy durable evidence of whether the old Redis debit committed, so
-- guessing a billing state would be worse than discarding the draft chat.
-- Product policy explicitly allows these pre-release conversations to be
-- lost; clearing all three canonical/admission tables makes the cutover
-- deterministic and leaves both creator clients safe on an empty history.
TRUNCATE TABLE
  "copilot_messages",
  "copilot_conversations",
  "copilot_user_stream_states";

CREATE TYPE "CopilotTurnKind" AS ENUM ('user', 'tool_continuation');

CREATE TYPE "CopilotQuotaChargeStatus" AS ENUM (
  'consume_pending',
  'charged',
  'refund_pending',
  'refunded',
  'settle_pending',
  'settled'
);

CREATE TABLE "copilot_quota_charge_attempts" (
  "id" UUID NOT NULL,
  "billing_operation_id" UUID NOT NULL,
  "generation" INTEGER NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "conversation_id" VARCHAR(180) NOT NULL,
  "session_id" UUID NOT NULL,
  "owner_turn_id" UUID NOT NULL,
  "tier" VARCHAR(16),
  "status" "CopilotQuotaChargeStatus" NOT NULL DEFAULT 'consume_pending',
  "refund_reason" VARCHAR(16),
  "client_tool_expires_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "copilot_quota_charge_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "copilot_quota_charge_attempts_generation_positive" CHECK ("generation" > 0),
  CONSTRAINT "copilot_quota_charge_attempts_identity_nonblank" CHECK (
    btrim("user_id") <> '' AND btrim("conversation_id") <> ''
  ),
  CONSTRAINT "copilot_quota_charge_attempts_tier" CHECK (
    ("tier" IS NULL OR "tier" IN ('Free', 'VIP1', 'VIP2', 'VIP3')) AND
    ("status" NOT IN ('charged', 'settle_pending', 'settled') OR "tier" IS NOT NULL)
  ),
  CONSTRAINT "copilot_quota_charge_attempts_refund_reason" CHECK (
    ("status" IN ('refund_pending', 'refunded') AND "refund_reason" IN ('failed', 'aborted')) OR
    ("status" NOT IN ('refund_pending', 'refunded') AND "refund_reason" IS NULL)
  ),
  CONSTRAINT "copilot_quota_charge_attempts_client_tool_expiry" CHECK (
    ("status" = 'charged' AND (
      "client_tool_expires_at" IS NULL OR
      "client_tool_expires_at" > "created_at"
    )) OR
    ("status" <> 'charged' AND "client_tool_expires_at" IS NULL)
  )
);

ALTER TABLE "copilot_conversations"
  ADD COLUMN "billing_operation_id" UUID,
  ADD COLUMN "billing_charge_attempt_id" UUID,
  ADD COLUMN "active_turn_kind" "CopilotTurnKind";

ALTER TABLE "copilot_conversations"
  ALTER COLUMN "billing_operation_id" SET NOT NULL,
  ALTER COLUMN "billing_charge_attempt_id" SET NOT NULL;

ALTER TABLE "copilot_conversations"
  DROP CONSTRAINT "copilot_conversations_active_claim_complete",
  ADD CONSTRAINT "copilot_conversations_active_claim_complete" CHECK (
    (
      "status" = 'streaming' AND
      "active_turn_id" IS NOT NULL AND
      "active_turn_kind" IS NOT NULL AND
      "active_claim_token" IS NOT NULL AND
      "active_revision" IS NOT NULL AND
      "active_revision" > 0 AND
      "active_user_message_id" IS NOT NULL AND
      "active_admission_token" IS NOT NULL AND
      "active_admission_revision" IS NOT NULL AND
      "active_admission_revision" > 0 AND
      "active_started_at" IS NOT NULL AND
      "active_expires_at" IS NOT NULL AND
      "active_revision" = "revision" AND
      "active_expires_at" > "active_started_at"
    ) OR (
      "status" <> 'streaming' AND
      "active_turn_id" IS NULL AND
      "active_turn_kind" IS NULL AND
      "active_claim_token" IS NULL AND
      "active_revision" IS NULL AND
      "active_user_message_id" IS NULL AND
      "active_admission_token" IS NULL AND
      "active_admission_revision" IS NULL AND
      "active_started_at" IS NULL AND
      "active_expires_at" IS NULL
    )
  );

CREATE OR REPLACE FUNCTION "copilot_validate_message_counters"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_id UUID;
  expected_count INTEGER;
  expected_bytes INTEGER;
  expected_status "CopilotConversationStatus";
  expected_active_turn_kind "CopilotTurnKind";
  expected_active_user_message_id VARCHAR(128);
  expected_proposal_user_message_id VARCHAR(128);
  actual_count INTEGER;
  actual_bytes INTEGER;
  actual_payload_bytes BIGINT;
  minimum_ordinal INTEGER;
  maximum_ordinal INTEGER;
  tail_role "CopilotMessageRole";
  tail_message_id VARCHAR(128);
BEGIN
  IF TG_TABLE_NAME = 'copilot_messages' THEN
    target_id := COALESCE(NEW."conversation_id", OLD."conversation_id");
  ELSE
    target_id := COALESCE(NEW."id", OLD."id");
  END IF;

  SELECT
    "message_count",
    "message_bytes",
    "status",
    "active_turn_kind",
    "active_user_message_id",
    "turn_proposal_user_message_id"
    INTO
      expected_count,
      expected_bytes,
      expected_status,
      expected_active_turn_kind,
      expected_active_user_message_id,
      expected_proposal_user_message_id
  FROM "copilot_conversations"
  WHERE "id" = target_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    COUNT(*)::INTEGER,
    COALESCE(SUM("byte_size"), 0)::INTEGER,
    COALESCE(SUM(octet_length(convert_to("payload"::text, 'UTF8'))), 0),
    MIN("ordinal"),
    MAX("ordinal")
    INTO
      actual_count,
      actual_bytes,
      actual_payload_bytes,
      minimum_ordinal,
      maximum_ordinal
  FROM "copilot_messages"
  WHERE "conversation_id" = target_id;

  IF actual_count < 1 THEN
    RAISE EXCEPTION 'Copilot conversation % must contain at least one persisted message', target_id
      USING ERRCODE = '23514';
  END IF;
  IF expected_count <> actual_count OR expected_bytes <> actual_bytes THEN
    RAISE EXCEPTION 'Copilot message counters are inconsistent for conversation %', target_id
      USING ERRCODE = '23514';
  END IF;
  IF actual_payload_bytes > 4194304 THEN
    RAISE EXCEPTION 'Copilot persisted payload bytes exceed the history limit for conversation %', target_id
      USING ERRCODE = '23514';
  END IF;
  IF minimum_ordinal <> 0 OR maximum_ordinal <> actual_count - 1 THEN
    RAISE EXCEPTION 'Copilot message ordinals are not contiguous for conversation %', target_id
      USING ERRCODE = '23514';
  END IF;

  SELECT "role", "message_id"
    INTO tail_role, tail_message_id
  FROM "copilot_messages"
  WHERE "conversation_id" = target_id
  ORDER BY "ordinal" DESC
  LIMIT 1;

  IF expected_status = 'ready' AND tail_role <> 'assistant' THEN
    RAISE EXCEPTION 'Ready Copilot conversation % must end with an assistant message', target_id
      USING ERRCODE = '23514';
  ELSIF expected_status = 'streaming'
    AND ((expected_active_turn_kind = 'user' AND tail_role <> 'user') OR
         (expected_active_turn_kind = 'tool_continuation' AND tail_role <> 'assistant')) THEN
    RAISE EXCEPTION 'Streaming Copilot conversation % has an invalid turn tail', target_id
      USING ERRCODE = '23514';
  END IF;

  IF expected_status = 'streaming'
    AND expected_active_turn_kind = 'user'
    AND expected_active_user_message_id IS DISTINCT FROM tail_message_id THEN
    RAISE EXCEPTION 'Active Copilot user message is not the tail for conversation %', target_id
      USING ERRCODE = '23514';
  END IF;
  IF expected_status = 'streaming'
    AND expected_active_turn_kind = 'tool_continuation'
    AND NOT EXISTS (
      SELECT 1
      FROM "copilot_messages"
      WHERE "conversation_id" = target_id
        AND "role" = 'user'
        AND "message_id" = expected_active_user_message_id
        AND "ordinal" = maximum_ordinal - 1
    ) THEN
    RAISE EXCEPTION 'Active Copilot continuation origin is not immediately before the assistant tail for conversation %', target_id
      USING ERRCODE = '23514';
  END IF;
  IF expected_proposal_user_message_id IS NOT NULL
    AND expected_proposal_user_message_id IS DISTINCT FROM tail_message_id THEN
    RAISE EXCEPTION 'Copilot proposal is not attached to the tail user message for conversation %', target_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE UNIQUE INDEX "copilot_conversations_charge_attempt_scope_unique"
  ON "copilot_conversations"(
    "billing_charge_attempt_id",
    "billing_operation_id",
    "user_id",
    "conversation_id",
    "session_id"
  );

CREATE UNIQUE INDEX "copilot_quota_charge_attempts_operation_generation_unique"
  ON "copilot_quota_charge_attempts"("billing_operation_id", "generation");

CREATE UNIQUE INDEX "copilot_quota_charge_attempts_canonical_identity_unique"
  ON "copilot_quota_charge_attempts"(
    "id",
    "billing_operation_id",
    "user_id",
    "conversation_id",
    "session_id"
  );

CREATE INDEX "copilot_quota_charge_attempts_reconcile_idx"
  ON "copilot_quota_charge_attempts"("status", "updated_at", "id");

CREATE INDEX "copilot_quota_charge_attempts_client_tool_expiry_idx"
  ON "copilot_quota_charge_attempts"("status", "client_tool_expires_at", "id");

ALTER TABLE "copilot_conversations"
  ADD CONSTRAINT "copilot_conversations_billing_charge_attempt_id_fkey"
  FOREIGN KEY (
    "billing_charge_attempt_id",
    "billing_operation_id",
    "user_id",
    "conversation_id",
    "session_id"
  ) REFERENCES "copilot_quota_charge_attempts"(
    "id",
    "billing_operation_id",
    "user_id",
    "conversation_id",
    "session_id"
  )
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
