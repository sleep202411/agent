/**
 * BatchWriter integration tests — require a live Redis at REDIS_URL.
 * Defaults to redis://localhost:16379, a non-standard port to avoid clobbering
 * a developer's existing Redis. Start one with:
 *
 *   docker run -d --rm -p 16379:6379 redis/redis-stack-server:7.4.0-v3
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { batchUpsert, summarizeBatch, type BatchItem } from "./batch-writer";
import { K } from "./redis-keys";
import { __resetRedisForTests, getRedis } from "./redis-client";
import type { StoryosContext } from "./workspace-client";

const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:16379";

const ctx: StoryosContext = {
  cookie: "test-cookie",
  userId: "user-test",
  projectId: "ws-test",
};

type RoleData = { name: string; description: string };

beforeAll(() => {
  process.env.REDIS_URL = TEST_REDIS_URL;
});

beforeEach(async () => {
  // Fresh singleton each test so REDIS_URL is re-read and state is clean.
  await __resetRedisForTests();
  const redis = getRedis();
  await redis.flushdb();
});

afterAll(async () => {
  await __resetRedisForTests();
});

describe("batchUpsert", () => {
  it("creates fresh items by calling the creator once each", async () => {
    const calls: RoleData[] = [];
    const creator = async (_c: StoryosContext, data: RoleData): Promise<string> => {
      calls.push(data);
      return `java-${data.name}`;
    };

    const items: BatchItem<RoleData>[] = [
      { clientRefId: "c1", data: { name: "Alice", description: "a" } },
      { clientRefId: "c2", data: { name: "Bob", description: "b" } },
    ];

    const results = await batchUpsert({ ctx, entityType: "role", items, creator });

    expect(calls).toHaveLength(2);
    expect(results).toEqual([
      { clientRefId: "c1", serverId: "java-Alice", status: "created" },
      { clientRefId: "c2", serverId: "java-Bob", status: "created" },
    ]);
  });

  it("caches clientRefId → serverId and skips the creator on replay", async () => {
    let createCount = 0;
    const creator = async (_c: StoryosContext, data: RoleData): Promise<string> => {
      createCount++;
      return `java-${data.name}`;
    };

    const items: BatchItem<RoleData>[] = [
      { clientRefId: "c1", data: { name: "Alice", description: "a" } },
    ];

    await batchUpsert({ ctx, entityType: "role", items, creator });
    const second = await batchUpsert({ ctx, entityType: "role", items, creator });

    expect(createCount).toBe(1);
    expect(second).toEqual([{ clientRefId: "c1", serverId: "java-Alice", status: "unchanged" }]);
  });

  it("writes mapping under the idem key with 7d TTL", async () => {
    const creator = async () => "java-42";
    const items: BatchItem<RoleData>[] = [
      { clientRefId: "c-ttl", data: { name: "X", description: "" } },
    ];
    await batchUpsert({ ctx, entityType: "role", items, creator });

    const redis = getRedis();
    const key = K.idem(ctx.projectId, "role", "c-ttl");
    expect(await redis.get(key)).toBe("java-42");
    const ttl = await redis.ttl(key);
    // Allow slack for request latency
    expect(ttl).toBeGreaterThan(7 * 24 * 3600 - 60);
    expect(ttl).toBeLessThanOrEqual(7 * 24 * 3600);
  });

  it("marks status=failed when creator throws and does not cache a mapping", async () => {
    const creator = async (_c: StoryosContext, data: RoleData): Promise<string> => {
      if (data.name === "BadName") throw new Error("Java said no");
      return `java-${data.name}`;
    };

    const items: BatchItem<RoleData>[] = [
      { clientRefId: "ok", data: { name: "OK", description: "" } },
      { clientRefId: "bad", data: { name: "BadName", description: "" } },
    ];
    const results = await batchUpsert({ ctx, entityType: "role", items, creator });

    expect(results[0]).toEqual({ clientRefId: "ok", serverId: "java-OK", status: "created" });
    expect(results[1]).toMatchObject({ clientRefId: "bad", status: "failed" });
    expect(results[1].error).toContain("Java said no");
    expect(results[1].serverId).toBeUndefined();

    // Failed item is not cached; retrying would call creator again.
    const redis = getRedis();
    expect(await redis.get(K.idem(ctx.projectId, "role", "bad"))).toBeNull();
  });

  it("preserves input order even with concurrency > 1", async () => {
    // Creator has varied latency, so fastest finishers would reorder if we
    // weren't writing results[i] by index.
    const latencies = [30, 5, 15, 20, 1];
    const creator = async (_c: StoryosContext, data: RoleData): Promise<string> => {
      const ms = latencies[Number(data.description)] ?? 0;
      await new Promise((r) => setTimeout(r, ms));
      return `java-${data.name}`;
    };
    const items: BatchItem<RoleData>[] = latencies.map((_, i) => ({
      clientRefId: `c-${i}`,
      data: { name: `N${i}`, description: String(i) },
    }));

    const results = await batchUpsert({
      ctx,
      entityType: "role",
      items,
      creator,
      opts: { concurrency: 5 },
    });

    expect(results.map((r) => r.clientRefId)).toEqual(["c-0", "c-1", "c-2", "c-3", "c-4"]);
    expect(results.every((r) => r.status === "created")).toBe(true);
  });

  it("isolates idem mappings across workspaces", async () => {
    const creator = async (_c: StoryosContext, data: RoleData): Promise<string> =>
      `java-${data.name}`;
    const items: BatchItem<RoleData>[] = [
      { clientRefId: "shared-ref", data: { name: "Alice", description: "" } },
    ];

    const ctxA = { ...ctx, projectId: "ws-A" };
    const ctxB = { ...ctx, projectId: "ws-B" };

    const rA = await batchUpsert({ ctx: ctxA, entityType: "role", items, creator });
    const rB = await batchUpsert({ ctx: ctxB, entityType: "role", items, creator });

    // Both are 'created' because idem key is scoped to workspace
    expect(rA[0].status).toBe("created");
    expect(rB[0].status).toBe("created");
  });

  it("isolates idem mappings across entity types", async () => {
    const creator = async (_c: StoryosContext, data: RoleData): Promise<string> =>
      `java-${data.name}`;
    const items: BatchItem<RoleData>[] = [
      { clientRefId: "shared-ref", data: { name: "Alice", description: "" } },
    ];
    const r1 = await batchUpsert({ ctx, entityType: "role", items, creator });
    const r2 = await batchUpsert({ ctx, entityType: "scene", items, creator });
    expect(r1[0].status).toBe("created");
    expect(r2[0].status).toBe("created");
  });

  it("returns empty array for empty input without touching Redis", async () => {
    const creator = async () => {
      throw new Error("should not be called");
    };
    const results = await batchUpsert({ ctx, entityType: "role", items: [], creator });
    expect(results).toEqual([]);
  });
});

describe("summarizeBatch", () => {
  it("aggregates counts across statuses and surfaces first error", () => {
    const summary = summarizeBatch([
      { clientRefId: "a", serverId: "1", status: "created" },
      { clientRefId: "b", serverId: "2", status: "unchanged" },
      { clientRefId: "c", status: "failed", error: "first failure" },
      { clientRefId: "d", status: "failed", error: "second failure" },
    ]);
    expect(summary).toEqual({
      total: 4,
      created: 1,
      unchanged: 1,
      failed: 2,
      firstError: "first failure",
    });
  });
});
