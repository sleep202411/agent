import { MessageList, type MastraDBMessage } from "@mastra/core/agent";
import { toAISdkMessages } from "@mastra/ai-sdk/ui";
import type { MastraModelConfig } from "@mastra/core/llm";
import { Memory } from "@mastra/memory";
import { PostgresStore } from "@mastra/pg";
import type { UIMessage } from "ai";
import { z } from "zod";

import type { AgentRuntimeConfig } from "../config/env.js";
import { projectProductUiMessages } from "../runtime/product-ui-message.js";

export const AGENT_MEMORY_SCHEMA = "agent_memory";
export const AGENT_MEMORY_REQUIRED_MIGRATION = "0004_mastra_framework_storage";

/**
 * How many stored messages Mastra's MessageHistory processor injects into each
 * model request (via the per-call memory scope), newest first. Twenty rows is
 * roughly ten conversational turns — enough recent context for multi-step
 * story work while keeping the per-turn input O(1): the retired Observational
 * Memory configuration loaded the ENTIRE thread on every turn once a frozen OM
 * record existed (~12-14k tokens and 76KB of re-uploaded thoughtSignature
 * metadata on an 81-message production thread, growing without bound toward
 * the 48k TokenLimiter cliff).
 */
export const AGENT_HISTORY_MESSAGE_LIMIT = 20;

type StoredMessageRow = Readonly<{
  id: string;
  threadId: string;
  resourceId: string | null;
  content: unknown;
}>;

export type AgentMessageHistoryPage = Readonly<{
  messages: UIMessage[];
  nextCursor: string | null;
}>;

export class InvalidAgentHistoryCursorError extends Error {
  constructor() {
    super("Invalid Agent message history cursor");
    this.name = "InvalidAgentHistoryCursorError";
  }
}

export type AgentMemory = Readonly<{
  storage: PostgresStore;
  memory: Memory;
  reconcileRunMessages: (
    messages: ReadonlyArray<UIMessage>,
    scope: Readonly<{ threadId: string; resourceId: string }>
  ) => Promise<UIMessage[]>;
  persistRunMessages: (
    messages: ReadonlyArray<UIMessage>,
    scope: Readonly<{ threadId: string; resourceId: string }>
  ) => Promise<void>;
  listUiMessages: (
    scope: Readonly<{ threadId: string; resourceId: string }>,
    input: Readonly<{ cursor?: string; limit: number }>
  ) => Promise<AgentMessageHistoryPage>;
  assertReady: () => Promise<void>;
  close: () => Promise<void>;
}>;

export function createAgentMemory(
  config: AgentRuntimeConfig["memory"],
  // Vestigial: Observational Memory is retired (below), so the observer model
  // is no longer wired into anything. The parameter stays because
  // core-platform still passes it; removing that plumbing belongs to the
  // caller, not this module.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for the caller's signature until the observer plumbing is removed
  _observerModel?: MastraModelConfig
): AgentMemory {
  const storage = new PostgresStore({
    id: "fizzdragon-agent-memory",
    connectionString: config.databaseUrl,
    schemaName: AGENT_MEMORY_SCHEMA,
    disableInit: true,
    max: config.poolMax,
    idleTimeoutMillis: config.poolIdleTimeoutMs,
  });
  const memory = new Memory({
    storage,
    options: {
      // Intent declaration ONLY — this flag does NOT enforce the single-writer
      // contract. Mastra's runtime gates parse the raw per-call memory config
      // out of the RequestContext and never consult this merged constructor
      // option (verified empirically: with only this flag set, Mastra still
      // wrote orphan assistant rows). The enforcing switch is the per-call
      // `options: { readOnly: true }` on agent.stream in runtime/activities.ts
      // — change it THERE. Kept here so a future Mastra that honours merged
      // config fails safe, and as documentation of the contract: the canonical
      // reconcile/persist path below is the only writer of agent memory.
      readOnly: true,
      // Bounded history injection via Mastra's MessageHistory processor. Its
      // load path is not gated by readOnly (history injection stays live) and
      // its persistence path re-checks the per-call readOnly at execution
      // time, so the single-writer contract holds. Observational Memory is
      // deliberately NOT configured: under the per-call readOnly contract it
      // could never record an observation, and once a frozen OM record existed
      // for a thread its context loader ignored every bound and injected the
      // entire thread into each request. While OM is enabled Mastra suppresses
      // MessageHistory entirely, so the only way to get bounded injection is
      // to retire OM. The frozen production rows in
      // mastra_observational_memory are inert without this config.
      lastMessages: AGENT_HISTORY_MESSAGE_LIMIT,
    },
  });

  return Object.freeze({
    storage,
    memory,
    reconcileRunMessages: (messages, scope) => reconcileRunMessages(storage, messages, scope),
    persistRunMessages: (messages, scope) => persistRunMessages(memory, storage, messages, scope),
    listUiMessages: (scope, input) => listUiMessages(storage, scope, input),
    assertReady: () => assertAgentMemoryReady(storage, config.databaseRole),
    close: () => storage.close(),
  });
}

const historyCursorSchema = z
  .object({
    version: z.literal(1),
    createdAt: z.iso.datetime({ offset: true }),
    id: z.string().min(1).max(512),
  })
  .strict();

const storedMessageContentSchema = z
  .object({
    format: z.literal(2),
    parts: z.array(z.unknown()),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

type HistoryMessageRow = StoredMessageRow &
  Readonly<{
    role: "user" | "assistant";
    createdAt: Date;
  }>;

async function listUiMessages(
  storage: PostgresStore,
  scope: Readonly<{ threadId: string; resourceId: string }>,
  input: Readonly<{ cursor?: string; limit: number }>
): Promise<AgentMessageHistoryPage> {
  const cursor = input.cursor ? decodeHistoryCursor(input.cursor) : undefined;
  const rows = await storage.db.manyOrNone<HistoryMessageRow>(
    `
      SELECT
        "id",
        "thread_id" AS "threadId",
        "resourceId",
        "content"::jsonb AS "content",
        "role",
        "createdAtZ" AS "createdAt"
      FROM "${AGENT_MEMORY_SCHEMA}"."mastra_messages"
      WHERE "thread_id" = $1
        AND "resourceId" = $2
        AND "role" IN ('user', 'assistant')
        AND (
          $3::timestamp IS NULL
          OR ("createdAtZ", "id") < ($3::timestamptz, $4::text)
        )
      ORDER BY "createdAtZ" DESC, "id" DESC
      LIMIT $5
    `,
    [
      scope.threadId,
      scope.resourceId,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      input.limit + 1,
    ]
  );
  const hasMore = rows.length > input.limit;
  const pageRows = rows.slice(0, input.limit);
  const oldest = pageRows.at(-1);
  const storedMessages = pageRows.toReversed().map((row) => storedRowToMastraMessage(row, scope));
  // Mastra persists one canonical DB format across SDK generations. The
  // official conversion is the version boundary: legacy tool-invocation
  // parts become AI SDK v6 `tool-*` parts before the product sees them.
  const messages = projectProductUiMessages(
    stampDurableHistoryMetadata(
      toAISdkMessages(storedMessages, { version: "v6" }) as unknown as UIMessage[],
      storedMessages
    )
  );
  return {
    messages,
    nextCursor:
      hasMore && oldest
        ? encodeHistoryCursor({
            version: 1,
            createdAt: oldest.createdAt.toISOString(),
            id: oldest.id,
          })
        : null,
  };
}

function storedRowToMastraMessage(
  row: HistoryMessageRow,
  scope: Readonly<{ threadId: string; resourceId: string }>
): MastraDBMessage {
  if (row.threadId !== scope.threadId || row.resourceId !== scope.resourceId) {
    throw new Error(`Agent memory history ownership mismatch for ${row.id}`);
  }
  const content = storedMessageContentSchema.parse(row.content) as MastraDBMessage["content"];
  return {
    id: row.id,
    role: row.role,
    threadId: row.threadId,
    resourceId: row.resourceId,
    createdAt: row.createdAt,
    type: "v2",
    content,
  };
}

function stampDurableHistoryMetadata(
  messages: ReadonlyArray<UIMessage>,
  storedMessages: ReadonlyArray<MastraDBMessage>
): UIMessage[] {
  const createdAtById = new Map(
    storedMessages.map((message) => [message.id, message.createdAt.toISOString()])
  );
  return messages.map((message) => {
    const createdAt = createdAtById.get(message.id);
    if (!createdAt) {
      throw new Error(`Converted Agent memory message is missing durable identity ${message.id}`);
    }
    const metadata =
      typeof message.metadata === "object" && message.metadata !== null
        ? (message.metadata as Record<string, unknown>)
        : {};
    return {
      ...message,
      metadata: {
        ...metadata,
        createdAt,
      },
    };
  });
}

function encodeHistoryCursor(cursor: z.infer<typeof historyCursorSchema>): string {
  return Buffer.from(JSON.stringify(historyCursorSchema.parse(cursor))).toString("base64url");
}

function decodeHistoryCursor(value: string): z.infer<typeof historyCursorSchema> {
  try {
    return historyCursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    throw new InvalidAgentHistoryCursorError();
  }
}

async function reconcileRunMessages(
  storage: PostgresStore,
  messages: ReadonlyArray<UIMessage>,
  scope: Readonly<{ threadId: string; resourceId: string }>
): Promise<UIMessage[]> {
  if (messages.length === 0) return [];

  const normalized = normalizeUiMessages(messages, scope);
  const rows = await storage.db.manyOrNone<StoredMessageRow>(
    `
      SELECT
        "id",
        "thread_id" AS "threadId",
        "resourceId",
        "content"::jsonb AS "content"
      FROM "${AGENT_MEMORY_SCHEMA}"."mastra_messages"
      WHERE "id" = ANY($1::text[])
    `,
    [normalized.map((message) => message.id)]
  );
  const storedById = new Map(rows.map((row) => [row.id, row]));
  const normalizedById = new Map(normalized.map((message) => [message.id, message]));

  for (const row of rows) {
    if (row.threadId !== scope.threadId || row.resourceId !== scope.resourceId) {
      throw new Error(
        `Agent memory message identity collision for ${row.id}; stored ownership does not match the signed session`
      );
    }
  }

  return messages.filter((message) => {
    const stored = storedById.get(message.id);
    if (!stored) return true;
    const candidate = normalizedById.get(message.id);
    if (!candidate) {
      throw new Error(`Normalized agent memory message is missing for ${message.id}`);
    }
    return (
      stableJson(stored.content) !==
      stableJson(preserveStoredMessageOwnership(candidate.content, stored.content))
    );
  });
}

/**
 * Ably owns the conversation transport and can replay historical user inputs
 * without the durable metadata FizzDragon stamped while persisting them.
 * `runId` and `conversationId` are server-owned identity, so their absence in
 * a replay is not a mutation. An explicit conflicting value is deliberately
 * preserved and will compare different, allowing the runtime to fail closed.
 */
export function preserveStoredMessageOwnership(candidate: unknown, stored: unknown): unknown {
  if (!isRecord(candidate) || !isRecord(stored)) return candidate;
  const storedMetadata = isRecord(stored.metadata) ? stored.metadata : undefined;
  if (!storedMetadata) return candidate;
  const candidateMetadata = isRecord(candidate.metadata) ? candidate.metadata : {};
  let nextMetadata: Record<string, unknown> | undefined;
  for (const key of ["runId", "conversationId"] as const) {
    if (candidateMetadata[key] !== undefined || storedMetadata[key] === undefined) continue;
    nextMetadata ??= { ...candidateMetadata };
    nextMetadata[key] = storedMetadata[key];
  }
  return nextMetadata ? { ...candidate, metadata: nextMetadata } : candidate;
}

async function persistRunMessages(
  memory: Memory,
  storage: PostgresStore,
  messages: ReadonlyArray<UIMessage>,
  scope: Readonly<{ threadId: string; resourceId: string }>
): Promise<void> {
  if (messages.length === 0) return;

  const existingThread = await storage.db.oneOrNone<{
    resourceId: string;
  }>(
    `
      SELECT "resourceId"
      FROM "${AGENT_MEMORY_SCHEMA}"."mastra_threads"
      WHERE "id" = $1
    `,
    [scope.threadId]
  );
  if (existingThread && existingThread.resourceId !== scope.resourceId) {
    throw new Error(
      `Agent memory thread identity collision for ${scope.threadId}; stored ownership does not match the signed session`
    );
  }
  if (!existingThread) {
    await memory.createThread({
      threadId: scope.threadId,
      resourceId: scope.resourceId,
      title: "FizzDragon agent session",
      saveThread: true,
    });
  }

  await memory.saveMessages({
    messages: normalizeUiMessages(messages, scope),
  });
}

function normalizeUiMessages(
  messages: ReadonlyArray<UIMessage>,
  scope: Readonly<{ threadId: string; resourceId: string }>
): MastraDBMessage[] {
  return new MessageList({
    threadId: scope.threadId,
    resourceId: scope.resourceId,
  })
    .add([...messages], "input")
    .get.all.db();
}

async function assertAgentMemoryReady(
  storage: PostgresStore,
  expectedDatabaseRole: string
): Promise<void> {
  const result = await storage.db.one<{
    databaseRole: string;
    migrationApplied: boolean;
    threadsTable: string | null;
    messagesTable: string | null;
    resourcesTable: string | null;
    observationalMemoryTable: string | null;
  }>(
    `
      SELECT
        current_user::text AS "databaseRole",
        EXISTS (
          SELECT 1
          FROM "${AGENT_MEMORY_SCHEMA}"."schema_migrations"
          WHERE "id" = $1
        ) AS "migrationApplied",
        to_regclass('${AGENT_MEMORY_SCHEMA}.mastra_threads')::text AS "threadsTable",
        to_regclass('${AGENT_MEMORY_SCHEMA}.mastra_messages')::text AS "messagesTable",
        to_regclass('${AGENT_MEMORY_SCHEMA}.mastra_resources')::text AS "resourcesTable",
        to_regclass('${AGENT_MEMORY_SCHEMA}.mastra_observational_memory')::text
          AS "observationalMemoryTable"
    `,
    [AGENT_MEMORY_REQUIRED_MIGRATION]
  );

  if (
    result.databaseRole !== expectedDatabaseRole ||
    !result.migrationApplied ||
    !result.threadsTable ||
    !result.messagesTable ||
    !result.resourcesTable ||
    !result.observationalMemoryTable
  ) {
    throw new Error(
      "Agent framework storage identity or schema is not at the required production baseline"
    );
  }
}

function stableJson(value: unknown): string {
  const serialized = JSON.stringify(sortJson(value));
  if (serialized === undefined) {
    throw new Error("Agent memory message content is not JSON serializable");
  }
  return serialized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)])
    );
  }
  return value;
}
