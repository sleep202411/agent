BEGIN;

-- CreateEnum
CREATE TYPE "CopilotConversationStatus" AS ENUM (
  'ready',
  'streaming',
  'failed',
  'aborted',
  'limit_exceeded'
);

-- CreateEnum
CREATE TYPE "CopilotMessageRole" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "CopilotConversationMode" AS ENUM ('canvas', 'story-canvas');

-- CreateTable
CREATE TABLE "copilot_conversations" (
  "id" UUID NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "conversation_id" VARCHAR(180) NOT NULL,
  "project_id" UUID NOT NULL,
  "mode" "CopilotConversationMode" NOT NULL,
  "selected_skill_keys" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "session_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "status" "CopilotConversationStatus" NOT NULL DEFAULT 'ready',
  "message_count" INTEGER NOT NULL DEFAULT 0,
  "message_bytes" INTEGER NOT NULL DEFAULT 0,
  "active_turn_id" UUID,
  "active_claim_token" UUID,
  "active_revision" INTEGER,
  "active_user_message_id" VARCHAR(128),
  "active_admission_token" UUID,
  "active_admission_revision" INTEGER,
  "active_started_at" TIMESTAMPTZ(6),
  "active_expires_at" TIMESTAMPTZ(6),
  "turn_proposal_user_message_id" VARCHAR(128),
  "turn_proposal" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "copilot_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "copilot_conversations_identity_nonblank" CHECK (
    btrim("user_id") <> '' AND
    btrim("conversation_id") <> '' AND
    "conversation_id" = "mode"::text || ':' || "project_id"::text
  ),
  CONSTRAINT "copilot_conversations_revision_nonnegative" CHECK ("revision" >= 0),
  CONSTRAINT "copilot_conversations_message_count_bound" CHECK (
    "message_count" >= 0 AND "message_count" <= 64
  ),
  CONSTRAINT "copilot_conversations_message_bytes_bound" CHECK (
    "message_bytes" >= 0 AND "message_bytes" <= 4194304
  ),
  CONSTRAINT "copilot_conversations_selected_skills_catalog" CHECK (
    jsonb_typeof("selected_skill_keys") = 'array' AND
    jsonb_array_length("selected_skill_keys") <= 1 AND
    "selected_skill_keys" <@ '[
      "story.directing.symmetrical-storybook.v1",
      "story.directing.intimate-realism.v1",
      "story.directing.eastern-dreamscape.v1",
      "story.directing.psychological-mystery.v1",
      "story.directing.retro-future-noir.v1",
      "story.directing.handcrafted-fable.v1"
    ]'::jsonb AND
    ("mode" <> 'canvas' OR "selected_skill_keys" = '[]'::jsonb)
  ),
  CONSTRAINT "copilot_conversations_active_claim_complete" CHECK (
    (
      "status" = 'streaming' AND
      "active_turn_id" IS NOT NULL AND
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
      "active_claim_token" IS NULL AND
      "active_revision" IS NULL AND
      "active_user_message_id" IS NULL AND
      "active_admission_token" IS NULL AND
      "active_admission_revision" IS NULL AND
      "active_started_at" IS NULL AND
      "active_expires_at" IS NULL
    )
  ),
  CONSTRAINT "copilot_conversations_proposal_complete" CHECK (
    ("turn_proposal_user_message_id" IS NULL) = ("turn_proposal" IS NULL)
  ),
  CONSTRAINT "copilot_conversations_proposal_object" CHECK (
    "turn_proposal" IS NULL OR jsonb_typeof("turn_proposal") = 'object'
  )
);

-- CreateTable
CREATE TABLE "copilot_messages" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "message_id" VARCHAR(128) NOT NULL,
  "role" "CopilotMessageRole" NOT NULL,
  "payload" JSONB NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "copilot_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "copilot_messages_identity_nonblank" CHECK (
    btrim("message_id") <> ''
  ),
  CONSTRAINT "copilot_messages_ordinal_role" CHECK (
    "ordinal" BETWEEN 0 AND 63 AND
    (("role" = 'user' AND "ordinal" % 2 = 0) OR
     ("role" = 'assistant' AND "ordinal" % 2 = 1))
  ),
  CONSTRAINT "copilot_messages_payload_object" CHECK (
    jsonb_typeof("payload") = 'object' AND
    jsonb_typeof("payload"->'parts') = 'array' AND
    jsonb_array_length("payload"->'parts') > 0
  ),
  CONSTRAINT "copilot_messages_payload_identity" CHECK (
    "payload"->>'id' = "message_id" AND
    "payload"->>'role' = "role"::text
  ),
  CONSTRAINT "copilot_messages_byte_size_bound" CHECK (
    "byte_size" > 0 AND
    (
      ("role" = 'user' AND "byte_size" <= 524288) OR
      ("role" = 'assistant' AND "byte_size" <= 2097152)
    ) AND
    octet_length(convert_to("payload"::text, 'UTF8')) <=
      CASE "role" WHEN 'user' THEN 524288 ELSE 2097152 END
  )
);

-- CreateTable
CREATE TABLE "copilot_user_stream_states" (
  "user_id" VARCHAR(64) NOT NULL,
  "claim_token" UUID,
  "conversation_id" VARCHAR(180),
  "lease_expires_at" TIMESTAMPTZ(6),
  "fencing_revision" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "copilot_user_stream_states_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "copilot_user_stream_states_user_nonblank" CHECK (
    btrim("user_id") <> ''
  ),
  CONSTRAINT "copilot_user_stream_states_fencing_nonnegative" CHECK (
    "fencing_revision" >= 0
  ),
  CONSTRAINT "copilot_user_stream_states_lease_complete" CHECK (
    ("claim_token" IS NULL AND "conversation_id" IS NULL AND "lease_expires_at" IS NULL) OR
    ("claim_token" IS NOT NULL AND btrim("conversation_id") <> '' AND "lease_expires_at" IS NOT NULL)
  )
);

-- CreateIndex
CREATE UNIQUE INDEX "copilot_conversations_user_conversation_unique"
  ON "copilot_conversations"("user_id", "conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "copilot_conversations_session_unique"
  ON "copilot_conversations"("session_id");

-- CreateIndex
CREATE INDEX "copilot_conversations_user_updated_idx"
  ON "copilot_conversations"("user_id", "updated_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "copilot_messages_conversation_ordinal_unique"
  ON "copilot_messages"("conversation_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "copilot_messages_conversation_message_unique"
  ON "copilot_messages"("conversation_id", "message_id");

-- AddForeignKey
ALTER TABLE "copilot_messages"
  ADD CONSTRAINT "copilot_messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "copilot_conversations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Counters are denormalized for bounded admission checks. This deferred
-- constraint trigger proves at commit that they still equal the append-only
-- child rows, so an exception cannot leave a half-applied turn.
CREATE FUNCTION "copilot_validate_message_counters"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_id UUID;
  expected_count INTEGER;
  expected_bytes INTEGER;
  expected_status "CopilotConversationStatus";
  expected_active_user_message_id VARCHAR(128);
  expected_proposal_user_message_id VARCHAR(128);
  actual_count INTEGER;
  actual_bytes INTEGER;
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
    "active_user_message_id",
    "turn_proposal_user_message_id"
    INTO
      expected_count,
      expected_bytes,
      expected_status,
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
    MIN("ordinal"),
    MAX("ordinal")
    INTO actual_count, actual_bytes, minimum_ordinal, maximum_ordinal
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
  ELSIF expected_status IN ('streaming', 'failed', 'aborted', 'limit_exceeded')
    AND tail_role <> 'user' THEN
    RAISE EXCEPTION 'Non-ready Copilot conversation % must end with a user message', target_id
      USING ERRCODE = '23514';
  END IF;

  IF expected_status = 'streaming'
    AND expected_active_user_message_id IS DISTINCT FROM tail_message_id THEN
    RAISE EXCEPTION 'Active Copilot user message is not the tail for conversation %', target_id
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

CREATE CONSTRAINT TRIGGER "copilot_messages_counters_consistent"
AFTER INSERT OR UPDATE OR DELETE ON "copilot_messages"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "copilot_validate_message_counters"();

CREATE CONSTRAINT TRIGGER "copilot_conversation_counters_consistent"
AFTER INSERT OR UPDATE ON "copilot_conversations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "copilot_validate_message_counters"();

COMMIT;
