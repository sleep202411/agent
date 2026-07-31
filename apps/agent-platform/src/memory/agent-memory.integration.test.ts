import { randomUUID } from "node:crypto";

import { RequestContext } from "@mastra/core/request-context";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createFizzDragonAgent } from "../agents/fizzdragon-agent.js";
import {
  agentMemoryScope,
  createAgentRequestContext,
  type AgentSessionContext,
} from "../context/agent-context.js";
import type { AgentRuntimeDomainGateway } from "../domain/domain-gateway.js";
import { AGENT_MEMORY_SCHEMA, createAgentMemory, type AgentMemory } from "./agent-memory.js";

const integrationEnabled = process.env.AGENT_MEMORY_POSTGRES_INTEGRATION === "1";
const describePostgres = integrationEnabled ? describe : describe.skip;
const databaseUrl =
  process.env.AGENT_MEMORY_TEST_DATABASE_URL ??
  "postgres://fizzdragon:fizzdragon@localhost:5433/fizzdragon";
const testPrefix = `agent-memory-integration-${randomUUID()}`;

describePostgres("AgentMemory PostgreSQL integration", () => {
  let agentMemory: AgentMemory;

  beforeAll(async () => {
    assertLocalIntegrationDatabase(databaseUrl);
    agentMemory = createAgentMemory({
      databaseUrl,
      databaseRole: new URL(databaseUrl).username,
      poolMax: 2,
      poolIdleTimeoutMs: 5_000,
    });
    await agentMemory.assertReady();
  });

  afterEach(async () => {
    await agentMemory.storage.db.tx(async (transaction) => {
      await transaction.none(
        `DELETE FROM "${AGENT_MEMORY_SCHEMA}"."mastra_messages"
         WHERE "thread_id" LIKE $1`,
        [`${testPrefix}%`]
      );
      await transaction.none(
        `DELETE FROM "${AGENT_MEMORY_SCHEMA}"."mastra_observational_memory"
         WHERE "threadId" LIKE $1`,
        [`${testPrefix}%`]
      );
      await transaction.none(
        `DELETE FROM "${AGENT_MEMORY_SCHEMA}"."mastra_threads"
         WHERE "id" LIKE $1`,
        [`${testPrefix}%`]
      );
    });
  });

  afterAll(async () => {
    await agentMemory?.close();
  });

  it("rejects a runtime credential that does not match the configured DML role", async () => {
    const mismatched = createAgentMemory({
      databaseUrl,
      databaseRole: "unexpected_runtime_role",
      poolMax: 1,
      poolIdleTimeoutMs: 5_000,
    });
    try {
      await expect(mismatched.assertReady()).rejects.toThrow(/storage identity/u);
    } finally {
      await mismatched.close();
    }
  });

  it("persists canonical messages and returns only new or changed input", async () => {
    const scope = {
      threadId: `${testPrefix}-reconcile`,
      resourceId: "workspace.integration:actor-1",
    };
    const original = {
      id: `${testPrefix}-message`,
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Original" }],
    };

    await expect(agentMemory.reconcileRunMessages([original], scope)).resolves.toEqual([original]);
    await agentMemory.persistRunMessages([original], scope);
    await expect(agentMemory.reconcileRunMessages([original], scope)).resolves.toEqual([]);

    const changed = {
      ...original,
      parts: [{ type: "text" as const, text: "Changed" }],
    };
    await expect(agentMemory.reconcileRunMessages([changed], scope)).resolves.toEqual([changed]);
    await agentMemory.persistRunMessages([changed], scope);
    await expect(agentMemory.reconcileRunMessages([changed], scope)).resolves.toEqual([]);
  });

  it("treats omitted server ownership as replay, while retaining explicit conflicts", async () => {
    const scope = {
      threadId: `${testPrefix}-ownership-replay`,
      resourceId: "workspace.integration:actor-1",
    };
    const canonical = {
      id: `${testPrefix}-ownership-replay-message`,
      role: "user" as const,
      metadata: {
        conversationId: "00000000-0000-4000-8000-000000000001",
        runId: "00000000-0000-4000-8000-000000000010",
      },
      parts: [{ type: "text" as const, text: "Original" }],
    };
    await agentMemory.persistRunMessages([canonical], scope);

    const transportReplay = {
      id: canonical.id,
      role: canonical.role,
      parts: canonical.parts,
    };
    await expect(agentMemory.reconcileRunMessages([transportReplay], scope)).resolves.toEqual([]);

    const explicitConflict = {
      ...canonical,
      metadata: {
        ...canonical.metadata,
        runId: "00000000-0000-4000-8000-000000000099",
      },
    };
    await expect(agentMemory.reconcileRunMessages([explicitConflict], scope)).resolves.toEqual([
      explicitConflict,
    ]);
  });

  it("rejects message and thread identities crossing signed partitions", async () => {
    const firstScope = {
      threadId: `${testPrefix}-ownership`,
      resourceId: "workspace.integration:actor-1",
    };
    const secondScope = {
      threadId: firstScope.threadId,
      resourceId: "workspace.other:actor-2",
    };
    const message = {
      id: `${testPrefix}-owned-message`,
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Owned" }],
    };

    await agentMemory.persistRunMessages([message], firstScope);
    await expect(agentMemory.reconcileRunMessages([message], secondScope)).rejects.toThrow(
      /message identity collision/u
    );
    await expect(
      agentMemory.persistRunMessages([{ ...message, id: `${message.id}-other` }], secondScope)
    ).rejects.toThrow(/thread identity collision/u);
  });

  it("enforces immutable ownership and thread ownership at the database boundary", async () => {
    const firstScope = {
      threadId: `${testPrefix}-database-owner`,
      resourceId: "workspace.integration:actor-1",
    };
    const secondScope = {
      threadId: `${testPrefix}-database-other-thread`,
      resourceId: "workspace.other:actor-2",
    };
    const message = {
      id: `${testPrefix}-database-message`,
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Database-owned" }],
    };

    await agentMemory.persistRunMessages([message], firstScope);
    await agentMemory.persistRunMessages(
      [
        {
          ...message,
          id: `${message.id}-other`,
        },
      ],
      secondScope
    );

    await expect(
      agentMemory.storage.db.none(
        `
          UPDATE "${AGENT_MEMORY_SCHEMA}"."mastra_threads"
          SET "resourceId" = $1
          WHERE "id" = $2
        `,
        [secondScope.resourceId, firstScope.threadId]
      )
    ).rejects.toThrow(/thread .* ownership is immutable/u);

    await expect(
      agentMemory.storage.db.none(
        `
          UPDATE "${AGENT_MEMORY_SCHEMA}"."mastra_messages"
          SET "thread_id" = $1, "resourceId" = $2
          WHERE "id" = $3
        `,
        [secondScope.threadId, secondScope.resourceId, message.id]
      )
    ).rejects.toThrow(/message .* ownership is immutable/u);

    await expect(
      agentMemory.storage.db.none(
        `
          INSERT INTO "${AGENT_MEMORY_SCHEMA}"."mastra_messages" (
            "id",
            "thread_id",
            "content",
            "role",
            "type",
            "createdAt",
            "resourceId"
          )
          VALUES ($1, $2, $3, $4, $5, NOW(), $6)
        `,
        [
          `${message.id}-cross-owner`,
          firstScope.threadId,
          JSON.stringify({ parts: [{ type: "text", text: "Cross-owner" }] }),
          "user",
          "v2",
          secondScope.resourceId,
        ]
      )
    ).rejects.toThrow(/agent_memory_messages_thread_owner_fk/u);
  });

  it("returns stable newest-first keyset pages as chronological UI message seeds", async () => {
    const scope = {
      threadId: `${testPrefix}-history`,
      resourceId: "workspace.integration:actor-1",
    };
    const messages = Array.from({ length: 5 }, (_, index) => ({
      id: `${testPrefix}-history-message-${index}`,
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      parts: [{ type: "text" as const, text: `Message ${index}` }],
    }));
    await agentMemory.persistRunMessages(messages, scope);
    for (const [index, message] of messages.entries()) {
      await agentMemory.storage.db.none(
        `
          UPDATE "${AGENT_MEMORY_SCHEMA}"."mastra_messages"
          SET
            "createdAt" = TIMESTAMP '2026-07-30 12:00:00' + ($1 * INTERVAL '1 second'),
            "createdAtZ" = TIMESTAMPTZ '2026-07-30 12:00:00+00' + ($1 * INTERVAL '1 second')
          WHERE "id" = $2
        `,
        [index, message.id]
      );
    }

    const newest = await agentMemory.listUiMessages(scope, { limit: 2 });
    expect(newest.messages.map((message) => message.id)).toEqual([
      messages[3]!.id,
      messages[4]!.id,
    ]);
    expect(
      newest.messages.map((message) =>
        typeof message.metadata === "object" && message.metadata !== null
          ? (message.metadata as Record<string, unknown>).createdAt
          : undefined
      )
    ).toEqual(["2026-07-30T12:00:03.000Z", "2026-07-30T12:00:04.000Z"]);
    expect(newest.nextCursor).toBeTruthy();

    const middle = await agentMemory.listUiMessages(scope, {
      cursor: newest.nextCursor!,
      limit: 2,
    });
    expect(middle.messages.map((message) => message.id)).toEqual([
      messages[1]!.id,
      messages[2]!.id,
    ]);
    expect(middle.nextCursor).toBeTruthy();

    const oldest = await agentMemory.listUiMessages(scope, {
      cursor: middle.nextCursor!,
      limit: 2,
    });
    expect(oldest.messages.map((message) => message.id)).toEqual([messages[0]!.id]);
    expect(oldest.nextCursor).toBeNull();
    await expect(
      agentMemory.listUiMessages(scope, {
        cursor: "not-a-valid-cursor",
        limit: 2,
      })
    ).rejects.toThrow(/history cursor/u);
  });

  it("bounds injected model history and keeps the single writer on a live stream", async () => {
    const conversationId = "0197f4a2-0800-7000-8000-000000000004";
    const sessionContext: AgentSessionContext = {
      actorId: "actor-1",
      actorDisplayName: "Actor One",
      conversationId,
      sessionName: `agent:v1:conversation:${conversationId}`,
      permissionMode: "smart",
      locale: "zh-CN",
      roles: ["creator"],
      permissions: ["story.read", "story.write"],
      traceId: "trace-integration",
      surface: "story-studio",
      scope: {
        kind: "story-project",
        workspaceId: "workspace-1",
        projectId: "project-1",
      },
    };
    // Mastra's memory processors read the memory scope out of the
    // RequestContext, which createAgentRequestContext seeds from the signed
    // session — so the test must use the production scope mapping, exactly as
    // runInferenceActivity does.
    const scope = agentMemoryScope(sessionContext);
    // Production-shaped memory: core-platform passes the observer model into
    // createAgentMemory, so construct it the same way here. The regression this
    // pins: with a frozen Observational Memory record present (single-writer
    // readOnly blocks observation writes, so lastObservedAt stays NULL), Mastra
    // loaded the ENTIRE thread into every model request, growing without bound.
    const memoryUnderTest = createAgentMemory(
      {
        databaseUrl,
        databaseRole: new URL(databaseUrl).username,
        poolMax: 2,
        poolIdleTimeoutMs: 5_000,
      },
      new MockLanguageModelV3() as never
    );
    try {
      const seeded = Array.from({ length: 25 }, (_, index) => ({
        id: `${testPrefix}-bounded-message-${String(index).padStart(2, "0")}`,
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        parts: [
          {
            type: "text" as const,
            text: `HISTORY-MARKER-${String(index).padStart(2, "0")}`,
          },
        ],
      }));
      await memoryUnderTest.persistRunMessages(seeded, scope);
      for (const [index, message] of seeded.entries()) {
        await memoryUnderTest.storage.db.none(
          `
            UPDATE "${AGENT_MEMORY_SCHEMA}"."mastra_messages"
            SET
              "createdAt" = TIMESTAMP '2026-07-30 12:00:00' + ($1 * INTERVAL '1 second'),
              "createdAtZ" = TIMESTAMPTZ '2026-07-30 12:00:00+00' + ($1 * INTERVAL '1 second')
            WHERE "id" = $2
          `,
          [index, message.id]
        );
      }
      // The exact production shape of the six live frozen records: created
      // before the single-writer contract, never observed since (readOnly
      // blocks observation writes), lastObservedAt/lastObservedAtZ NULL.
      await memoryUnderTest.storage.db.none(
        `
          INSERT INTO "${AGENT_MEMORY_SCHEMA}"."mastra_observational_memory" (
            "id", "lookupKey", "scope", "resourceId", "threadId",
            "activeObservations", "originType", "config", "generationCount",
            "pendingMessageTokens", "totalTokensObserved", "observationTokenCount",
            "isObserving", "isReflecting", "isBufferingObservation",
            "isBufferingReflection", "lastBufferedAtTokens",
            "lastObservedAt", "lastObservedAtZ", "createdAt", "updatedAt"
          )
          VALUES (
            $1, $2, 'thread', $3, $4,
            '', 'initial', '{}', 0,
            0, 0, 0,
            FALSE, FALSE, FALSE,
            FALSE, 0,
            NULL, NULL, NOW(), NOW()
          )
        `,
        [randomUUID(), `thread:${scope.threadId}`, scope.resourceId, scope.threadId]
      );

      const prompts: string[] = [];
      const actorModel = new MockLanguageModelV3({
        doStream: async (options) => {
          prompts.push(JSON.stringify(options.prompt));
          return {
            stream: convertArrayToReadableStream([
              { type: "stream-start", warnings: [] },
              {
                type: "response-metadata",
                id: "response-0",
                modelId: "mock-actor",
                timestamp: new Date(0),
              },
              { type: "text-start", id: "1" },
              { type: "text-delta", id: "1", delta: "收到。" },
              { type: "text-end", id: "1" },
              {
                type: "finish",
                finishReason: { unified: "stop" as const, raw: "STOP" },
                usage: {
                  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 5, text: 5, reasoning: 0 },
                },
              },
            ]),
          };
        },
      });
      const domainGateway = {
        execute: async () => ({ status: "succeeded" as const, data: {} }),
        resolveAttachments: async () => [],
        reportInvocationLifecycle: async () => undefined,
        assertReady: async () => undefined,
      } satisfies AgentRuntimeDomainGateway;
      const agent = createFizzDragonAgent(
        actorModel as never,
        memoryUnderTest.memory,
        domainGateway
      );
      const requestContext = new RequestContext(
        Object.entries(createAgentRequestContext(sessionContext).toJSON())
      ) as never;

      const result = await agent.stream(
        [
          {
            id: `${testPrefix}-bounded-new-user`,
            role: "user" as const,
            parts: [{ type: "text" as const, text: "继续下一场戏。" }],
            metadata: {
              conversationId,
              runId: "00000000-0000-4000-8000-000000000010",
            },
          },
        ] as never,
        {
          requestContext,
          memory: {
            thread: scope.threadId,
            resource: scope.resourceId,
            // The production single-writer switch, exactly as placed by
            // runInferenceActivity.
            options: { readOnly: true },
          },
          runId: "00000000-0000-4000-8000-000000000010",
          maxSteps: 1,
        }
      );
      for await (const chunk of result.fullStream) void chunk;
      await result.response;
      // Allow any debounced framework persistence to fire before auditing.
      await new Promise((resolve) => setTimeout(resolve, 1_000));

      const prompt = prompts.join("\n");
      // History injection stays live: the model must see the previous
      // assistant reply and the newest turns.
      expect(prompt).toContain("HISTORY-MARKER-23");
      expect(prompt).toContain("HISTORY-MARKER-24");
      expect(prompt).toContain("HISTORY-MARKER-05");
      // Bounded: the whole-thread load is gone; rows older than the injection
      // bound never reach the provider request.
      expect(prompt).not.toContain("HISTORY-MARKER-04");
      expect(prompt).not.toContain("HISTORY-MARKER-00");

      // Single writer: Mastra persisted nothing during the stream — the 25
      // seeded rows are still the only rows, and the canonical thread title
      // was not rewritten by a framework writer.
      const { messageCount } = await memoryUnderTest.storage.db.one<{ messageCount: string }>(
        `
          SELECT COUNT(*) AS "messageCount"
          FROM "${AGENT_MEMORY_SCHEMA}"."mastra_messages"
          WHERE "thread_id" = $1
        `,
        [scope.threadId]
      );
      expect(Number(messageCount)).toBe(25);
      const thread = await memoryUnderTest.storage.db.one<{ title: string }>(
        `
          SELECT "title"
          FROM "${AGENT_MEMORY_SCHEMA}"."mastra_threads"
          WHERE "id" = $1
        `,
        [scope.threadId]
      );
      expect(thread.title).toBe("FizzDragon agent session");
    } finally {
      // The session-derived thread id does not carry the testPrefix, so the
      // shared afterEach cannot clean it up. Remove it here.
      await memoryUnderTest.storage.db.tx(async (transaction) => {
        await transaction.none(
          `DELETE FROM "${AGENT_MEMORY_SCHEMA}"."mastra_messages" WHERE "thread_id" = $1`,
          [scope.threadId]
        );
        await transaction.none(
          `DELETE FROM "${AGENT_MEMORY_SCHEMA}"."mastra_observational_memory" WHERE "threadId" = $1`,
          [scope.threadId]
        );
        await transaction.none(
          `DELETE FROM "${AGENT_MEMORY_SCHEMA}"."mastra_threads" WHERE "id" = $1`,
          [scope.threadId]
        );
      });
      await memoryUnderTest.close();
    }
  });

  it("keeps Mastra Observational Memory diagnostics outside product history", async () => {
    const scope = {
      threadId: `${testPrefix}-product-history`,
      resourceId: "workspace.integration:actor-1",
    };
    await agentMemory.persistRunMessages(
      [
        {
          id: `${testPrefix}-product-history-assistant`,
          role: "assistant",
          parts: [
            {
              type: "data-om-status",
              data: { recordId: "memory-1" },
            },
            {
              type: "text",
              text: "Visible answer",
            },
            {
              type: "tool-invocation",
              toolInvocation: {
                state: "result",
                toolCallId: "tool-call-1",
                toolName: "story_apply_change_set",
                args: { operation: "verify" },
                result: { status: "succeeded" },
              },
            },
          ],
        } as never,
      ],
      scope
    );

    const page = await agentMemory.listUiMessages(scope, { limit: 10 });

    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]?.parts).toHaveLength(2);
    expect(page.messages[0]?.parts[0]).toMatchObject({
      type: "text",
      text: "Visible answer",
    });
    expect(page.messages[0]?.parts[1]).toMatchObject({
      type: "tool-story_apply_change_set",
      toolCallId: "tool-call-1",
      state: "output-available",
      input: { operation: "verify" },
      output: { status: "succeeded" },
    });
  });
});

function assertLocalIntegrationDatabase(connectionString: string): void {
  const url = new URL(connectionString);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Agent Memory integration tests require a PostgreSQL connection string");
  }
  const allowedPorts = process.env.CI === "true" ? ["5432", "5433"] : ["5433"];
  if (
    !["localhost", "127.0.0.1", "::1"].includes(url.hostname) ||
    !allowedPorts.includes(url.port)
  ) {
    throw new Error(
      "Refusing Agent Memory integration tests: database must be the isolated local PostgreSQL port"
    );
  }
}
