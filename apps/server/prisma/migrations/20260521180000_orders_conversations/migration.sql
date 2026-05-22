-- Service orders + conversations + messages.
--
-- See model comments in schema.prisma for shape rationale. The hot
-- design points repeated here for migration reviewers:
--
--   * Conversation.lookup_key is the dedup boundary. Service
--     inquiry: `service:<serviceId>:<buyerId>:<creatorId>`. Order:
--     `order:<orderId>`. Same triple resumes the same thread; on
--     proposal accept the key rewrites cleanly (UPDATE in the same
--     transaction that creates the order).
--
--   * ServiceOrder.package_snapshot + questionnaire are jsonb
--     frozen at submit time. The creator can keep editing the
--     source service without rewriting order history.
--
--   * Bindings (ip_id / episode_id / crew_id / crew_position_id)
--     are plain strings — they reference Java-owned tables outside
--     this Nest schema, so no FK. Existence is validated at the
--     service layer at write time.
--
--   * Messages are NOT outbox'd. WS delivery is best-effort; client
--     reconnect rehydrates via cursor pagination on the messages
--     table. Outbox would be over-engineering for the chat use case
--     (vs Notification which gets stored-forever inbox rows).

-- ─── Enums ──────────────────────────────────────────────────

CREATE TYPE "service_order_status" AS ENUM (
  'pending_creator',
  'in_progress',
  'delivered',
  'revision_requested',
  'completed',
  'cancelled'
);

CREATE TYPE "conversation_context_type" AS ENUM (
  'service',
  'order'
);

CREATE TYPE "conversation_participant_role" AS ENUM (
  'buyer',
  'creator'
);

CREATE TYPE "message_type" AS ENUM (
  'text',
  'image',
  'file',
  'proposal',
  'system'
);

-- ─── service_requirement_questions ──────────────────────────

CREATE TABLE "service_requirement_questions" (
  "id"            TEXT NOT NULL,
  "service_id"    TEXT NOT NULL,

  "prompt"        VARCHAR(240) NOT NULL,
  "help_text"     VARCHAR(240),
  "required"      BOOLEAN NOT NULL DEFAULT false,
  "display_order" INTEGER NOT NULL DEFAULT 0,

  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "service_requirement_questions_pkey" PRIMARY KEY ("id"),

  CONSTRAINT "service_requirement_questions_service_id_fkey"
    FOREIGN KEY ("service_id")
    REFERENCES "creator_services"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  CONSTRAINT "chk_service_req_questions_prompt_nonblank"
    CHECK (length(btrim("prompt")) > 0),
  CONSTRAINT "chk_service_req_questions_display_order_nonneg"
    CHECK ("display_order" >= 0)
);

CREATE INDEX "service_req_questions_by_service_idx"
  ON "service_requirement_questions" ("service_id", "display_order");

-- ─── conversations ──────────────────────────────────────────
--
-- Created BEFORE service_orders because service_orders.conversation_id
-- references it.

CREATE TABLE "conversations" (
  "id"              TEXT NOT NULL,
  "context_type"    "conversation_context_type" NOT NULL,
  "context_id"      TEXT NOT NULL,
  "lookup_key"      TEXT NOT NULL,
  "last_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id"),

  CONSTRAINT "chk_conversations_context_id_nonblank"
    CHECK (length(btrim("context_id")) > 0),
  CONSTRAINT "chk_conversations_lookup_key_nonblank"
    CHECK (length(btrim("lookup_key")) > 0)
);

CREATE UNIQUE INDEX "conversations_lookup_key_unique"
  ON "conversations" ("lookup_key");

CREATE INDEX "conversations_recent_idx"
  ON "conversations" ("last_message_at" DESC);

CREATE INDEX "conversations_context_idx"
  ON "conversations" ("context_type", "context_id");

-- ─── conversation_participants ──────────────────────────────

CREATE TABLE "conversation_participants" (
  "conversation_id"      TEXT NOT NULL,
  "user_id"              TEXT NOT NULL,
  "role"                 "conversation_participant_role" NOT NULL,
  "last_read_message_id" TEXT,
  "last_read_at"         TIMESTAMPTZ(6),
  "muted_until"          TIMESTAMPTZ(6),
  "joined_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "left_at"              TIMESTAMPTZ(6),

  CONSTRAINT "conversation_participants_pkey"
    PRIMARY KEY ("conversation_id", "user_id"),

  CONSTRAINT "conversation_participants_conversation_id_fkey"
    FOREIGN KEY ("conversation_id")
    REFERENCES "conversations"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX "conversation_participants_by_user_idx"
  ON "conversation_participants" ("user_id", "left_at");

-- ─── messages ───────────────────────────────────────────────

CREATE TABLE "messages" (
  "id"              TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "author_id"       TEXT,
  "type"            "message_type" NOT NULL,
  "body"            TEXT NOT NULL DEFAULT '',
  "payload"         JSONB,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"      TIMESTAMPTZ(6),

  CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),

  CONSTRAINT "messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id")
    REFERENCES "conversations"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,

  -- System messages have no author; everything else must.
  CONSTRAINT "chk_messages_author_for_non_system"
    CHECK (
      "type" = 'system'
      OR ("author_id" IS NOT NULL AND length(btrim("author_id")) > 0)
    ),
  -- Text body must be non-empty for type=text; proposal note + system
  -- both allow blank body (payload carries the structured content).
  CONSTRAINT "chk_messages_body_for_text"
    CHECK ("type" <> 'text' OR length(btrim("body")) > 0)
);

CREATE INDEX "messages_by_conversation_idx"
  ON "messages" ("conversation_id", "created_at" DESC);

-- ─── service_orders ─────────────────────────────────────────

CREATE TABLE "service_orders" (
  "id"               TEXT NOT NULL,
  "buyer_id"         TEXT NOT NULL,
  "creator_id"       TEXT NOT NULL,
  "service_id"       TEXT NOT NULL,
  "package_snapshot" JSONB NOT NULL,

  "status" "service_order_status" NOT NULL DEFAULT 'pending_creator',

  "questionnaire" JSONB NOT NULL DEFAULT '[]'::jsonb,

  "conversation_id" TEXT NOT NULL,

  -- FizzDragon entity bindings — all nullable, validated at the
  -- service layer.
  "ip_id"            TEXT,
  "episode_id"       TEXT,
  "crew_id"          TEXT,
  "crew_position_id" TEXT,

  "version" INTEGER NOT NULL DEFAULT 0,

  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accepted_at"  TIMESTAMPTZ(6),
  "delivered_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "cancel_info"  JSONB,

  CONSTRAINT "service_orders_pkey" PRIMARY KEY ("id"),

  CONSTRAINT "service_orders_service_id_fkey"
    FOREIGN KEY ("service_id")
    REFERENCES "creator_services"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT "service_orders_conversation_id_fkey"
    FOREIGN KEY ("conversation_id")
    REFERENCES "conversations"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,

  CONSTRAINT "chk_service_orders_buyer_creator_distinct"
    CHECK ("buyer_id" <> "creator_id"),
  CONSTRAINT "chk_service_orders_version_nonneg"
    CHECK ("version" >= 0),
  -- cancellation invariants: cancel_info IFF status=cancelled
  CONSTRAINT "chk_service_orders_cancel_info_consistency"
    CHECK (
      ("status" = 'cancelled' AND "cancelled_at" IS NOT NULL AND "cancel_info" IS NOT NULL)
      OR
      ("status" <> 'cancelled' AND "cancelled_at" IS NULL AND "cancel_info" IS NULL)
    )
);

-- 1:1 with conversation.
CREATE UNIQUE INDEX "service_orders_conversation_id_unique"
  ON "service_orders" ("conversation_id");

CREATE INDEX "service_orders_by_buyer_idx"
  ON "service_orders" ("buyer_id", "created_at" DESC);

CREATE INDEX "service_orders_by_creator_idx"
  ON "service_orders" ("creator_id", "created_at" DESC);

CREATE INDEX "service_orders_by_creator_status_idx"
  ON "service_orders" ("creator_id", "status", "created_at" DESC);

CREATE INDEX "service_orders_by_buyer_status_idx"
  ON "service_orders" ("buyer_id", "status", "created_at" DESC);

CREATE INDEX "service_orders_by_service_idx"
  ON "service_orders" ("service_id", "created_at" DESC);

CREATE INDEX "service_orders_by_ip_idx"
  ON "service_orders" ("ip_id");

CREATE INDEX "service_orders_by_episode_idx"
  ON "service_orders" ("episode_id");

CREATE INDEX "service_orders_by_crew_idx"
  ON "service_orders" ("crew_id");
