CREATE SCHEMA IF NOT EXISTS "agent_memory";

CREATE TABLE IF NOT EXISTS "agent_memory"."schema_migrations" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- mastra-memory-ddl:start
CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_threads" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "resourceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP NOT NULL,
  "createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAtZ" TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_messages" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "thread_id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL,
  "resourceId" TEXT,
  "createdAtZ" TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_resources" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "workingMemory" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP NOT NULL,
  "createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAtZ" TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "agent_memory"."mastra_observational_memory" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "lookupKey" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "resourceId" TEXT,
  "threadId" TEXT,
  "activeObservations" TEXT NOT NULL,
  "activeObservationsPendingUpdate" TEXT,
  "originType" TEXT NOT NULL,
  "config" TEXT NOT NULL,
  "generationCount" INTEGER NOT NULL,
  "lastObservedAt" TIMESTAMP,
  "lastReflectionAt" TIMESTAMP,
  "pendingMessageTokens" INTEGER NOT NULL,
  "totalTokensObserved" INTEGER NOT NULL,
  "observationTokenCount" INTEGER NOT NULL,
  "isObserving" BOOLEAN NOT NULL,
  "isReflecting" BOOLEAN NOT NULL,
  "observedMessageIds" JSONB,
  "observedTimezone" TEXT,
  "bufferedObservations" TEXT,
  "bufferedObservationTokens" INTEGER,
  "bufferedMessageIds" JSONB,
  "bufferedReflection" TEXT,
  "bufferedReflectionTokens" INTEGER,
  "bufferedReflectionInputTokens" INTEGER,
  "reflectedObservationLineCount" INTEGER,
  "bufferedObservationChunks" JSONB,
  "isBufferingObservation" BOOLEAN NOT NULL,
  "isBufferingReflection" BOOLEAN NOT NULL,
  "lastBufferedAtTokens" INTEGER NOT NULL,
  "lastBufferedAtTime" TIMESTAMP,
  "metadata" JSONB,
  "createdAt" TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP NOT NULL,
  "lastObservedAtZ" TIMESTAMPTZ DEFAULT NOW(),
  "lastReflectionAtZ" TIMESTAMPTZ DEFAULT NOW(),
  "lastBufferedAtTimeZ" TIMESTAMPTZ DEFAULT NOW(),
  "createdAtZ" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAtZ" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "agent_memory_idx_om_lookup_key"
  ON "agent_memory"."mastra_observational_memory" ("lookupKey");

CREATE INDEX IF NOT EXISTS "agent_memory_mastra_threads_resourceid_createdat_idx"
  ON "agent_memory"."mastra_threads" ("resourceId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "agent_memory_mastra_messages_thread_id_createdat_idx"
  ON "agent_memory"."mastra_messages" ("thread_id", "createdAt" DESC);
-- mastra-memory-ddl:end
