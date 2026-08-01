UPDATE "agent_memory"."mastra_messages"
SET "createdAtZ" = "createdAt" AT TIME ZONE 'UTC'
WHERE "createdAtZ" IS NULL;

ALTER TABLE "agent_memory"."mastra_messages"
  ALTER COLUMN "createdAtZ" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "agent_memory_mastra_messages_thread_owner_history_idx"
  ON "agent_memory"."mastra_messages" (
    "thread_id",
    "resourceId",
    "createdAtZ" DESC,
    "id" DESC
  )
  WHERE "role" IN ('user', 'assistant');
