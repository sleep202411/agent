BEGIN;

-- Copilot conversation documents: extracted text of a script/outline uploaded
-- into one user's Copilot conversation. Append-only rows.
CREATE TABLE "copilot_documents" (
  "id" UUID NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "conversation_id" VARCHAR(180) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "media_type" VARCHAR(128) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "char_count" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "copilot_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "copilot_documents_user_conversation_idx"
  ON "copilot_documents" ("user_id", "conversation_id", "created_at" DESC, "id" DESC);

COMMIT;
