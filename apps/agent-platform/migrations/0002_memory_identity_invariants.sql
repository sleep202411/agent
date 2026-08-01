DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "agent_memory"."mastra_messages" AS message
    LEFT JOIN "agent_memory"."mastra_threads" AS thread
      ON thread."id" = message."thread_id"
    WHERE message."resourceId" IS NULL
       OR thread."id" IS NULL
       OR thread."resourceId" IS DISTINCT FROM message."resourceId"
  ) THEN
    RAISE EXCEPTION
      USING
        ERRCODE = '23514',
        MESSAGE = 'Cannot enforce agent-memory ownership: orphaned or cross-owner messages exist';
  END IF;
END
$$;

ALTER TABLE "agent_memory"."mastra_messages"
  ALTER COLUMN "resourceId" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "agent_memory_mastra_threads_id_resourceid_uidx"
  ON "agent_memory"."mastra_threads" ("id", "resourceId");

ALTER TABLE "agent_memory"."mastra_messages"
  ADD CONSTRAINT "agent_memory_messages_thread_owner_fk"
  FOREIGN KEY ("thread_id", "resourceId")
  REFERENCES "agent_memory"."mastra_threads" ("id", "resourceId")
  ON UPDATE RESTRICT
  ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION "agent_memory"."reject_thread_owner_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."resourceId" IS DISTINCT FROM OLD."resourceId" THEN
    RAISE EXCEPTION
      USING
        ERRCODE = '23514',
        MESSAGE = format(
          'Agent memory thread %s ownership is immutable',
          OLD."id"
        );
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "agent_memory_thread_owner_immutable"
  ON "agent_memory"."mastra_threads";

CREATE TRIGGER "agent_memory_thread_owner_immutable"
BEFORE UPDATE OF "resourceId"
ON "agent_memory"."mastra_threads"
FOR EACH ROW
EXECUTE FUNCTION "agent_memory"."reject_thread_owner_change"();

CREATE OR REPLACE FUNCTION "agent_memory"."reject_message_owner_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."thread_id" IS DISTINCT FROM OLD."thread_id"
     OR NEW."resourceId" IS DISTINCT FROM OLD."resourceId" THEN
    RAISE EXCEPTION
      USING
        ERRCODE = '23514',
        MESSAGE = format(
          'Agent memory message %s ownership is immutable',
          OLD."id"
        );
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "agent_memory_message_owner_immutable"
  ON "agent_memory"."mastra_messages";

CREATE TRIGGER "agent_memory_message_owner_immutable"
BEFORE UPDATE OF "thread_id", "resourceId"
ON "agent_memory"."mastra_messages"
FOR EACH ROW
EXECUTE FUNCTION "agent_memory"."reject_message_owner_change"();
