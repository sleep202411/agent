/**
 * Unit tests for the workflow state module. Integration with Mastra / BullMQ
 * is covered separately by the role_design workflow end-to-end test.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  appendEvent,
  clearCancel,
  getMeta,
  isCancelled,
  listWorkflowsByUser,
  listWorkflowsByWorkspace,
  patchMeta,
  putMeta,
  readEvents,
  requestCancel,
  setStatus,
} from "./state";
import { __resetRedisForTests, getRedis } from "../../lib/redis-client";
import type { WorkflowMeta } from "./types";

const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:16379";

function baseMeta(overrides: Partial<WorkflowMeta> = {}): WorkflowMeta {
  const now = Date.now();
  return {
    runId: `run-${Math.random().toString(36).slice(2, 10)}`,
    workflowName: "role_design",
    workspaceId: "ws-1",
    userId: "user-1",
    status: "queued",
    startedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeAll(() => {
  process.env.REDIS_URL = TEST_REDIS_URL;
});

beforeEach(async () => {
  await __resetRedisForTests();
  const redis = getRedis();
  await redis.flushdb();
});

afterAll(async () => {
  await __resetRedisForTests();
});

describe("putMeta / getMeta", () => {
  it("persists and reads back workflow meta", async () => {
    const meta = baseMeta();
    await putMeta(meta);
    const loaded = await getMeta(meta.runId);
    expect(loaded).not.toBeNull();
    expect(loaded?.runId).toBe(meta.runId);
    expect(loaded?.workflowName).toBe("role_design");
  });

  it("returns null for unknown runId", async () => {
    expect(await getMeta("unknown-run")).toBeNull();
  });

  it("bumps updatedAt on every put", async () => {
    const meta = baseMeta({ startedAt: 1000, updatedAt: 1000 });
    await putMeta(meta);
    const first = await getMeta(meta.runId);
    expect(first?.updatedAt).toBeGreaterThan(1000);
  });
});

describe("patchMeta", () => {
  it("merges partial updates", async () => {
    const meta = baseMeta();
    await putMeta(meta);
    const patched = await patchMeta(meta.runId, { status: "running", currentStep: "plan_roles" });
    expect(patched?.status).toBe("running");
    expect(patched?.currentStep).toBe("plan_roles");
  });

  it("returns null and does not create meta if missing", async () => {
    const result = await patchMeta("missing-run", { status: "running" });
    expect(result).toBeNull();
    expect(await getMeta("missing-run")).toBeNull();
  });

  it("preserves runId even if the patch tries to change it", async () => {
    const meta = baseMeta();
    await putMeta(meta);
    const patched = await patchMeta(meta.runId, { runId: "hijacked" } as Partial<WorkflowMeta>);
    expect(patched?.runId).toBe(meta.runId);
  });
});

describe("setStatus", () => {
  it("sets terminal timestamps for terminal statuses", async () => {
    const meta = baseMeta();
    await putMeta(meta);
    const patched = await setStatus(meta.runId, "completed", { result: { ok: true } });
    expect(patched?.status).toBe("completed");
    expect(patched?.completedAt).toBeGreaterThan(0);
    expect(patched?.result).toEqual({ ok: true });
  });

  it("does not set completedAt for running/suspended", async () => {
    const meta = baseMeta();
    await putMeta(meta);
    const patched = await setStatus(meta.runId, "running");
    expect(patched?.completedAt).toBeUndefined();
  });
});

describe("cancel flag", () => {
  it("round-trips request / check / clear", async () => {
    expect(await isCancelled("r1")).toBe(false);
    await requestCancel("r1");
    expect(await isCancelled("r1")).toBe(true);
    await clearCancel("r1");
    expect(await isCancelled("r1")).toBe(false);
  });
});

describe("event log", () => {
  it("appends and reads events in chronological order", async () => {
    await appendEvent("r1", "enqueued", { workflow: "role_design" });
    await appendEvent("r1", "started");
    await appendEvent("r1", "step.completed", { stepId: "plan_roles" });

    const events = await readEvents("r1");
    expect(events.map((e) => e.type)).toEqual(["enqueued", "started", "step.completed"]);
    expect(events[0].data).toEqual({ workflow: "role_design" });
    expect(events[2].data).toEqual({ stepId: "plan_roles" });
  });

  it("respects the limit parameter", async () => {
    for (let i = 0; i < 10; i++) {
      await appendEvent("r2", "progress", { i });
    }
    const events = await readEvents("r2", { limit: 3 });
    expect(events).toHaveLength(3);
  });

  it("returns empty array for runs with no events", async () => {
    expect(await readEvents("no-such-run")).toEqual([]);
  });
});

describe("listing indexes", () => {
  it("lists by user, newest first", async () => {
    await putMeta(baseMeta({ runId: "a", userId: "u-1", startedAt: 1000 }));
    await putMeta(baseMeta({ runId: "b", userId: "u-1", startedAt: 2000 }));
    await putMeta(baseMeta({ runId: "c", userId: "u-2", startedAt: 1500 }));
    const list = await listWorkflowsByUser("u-1");
    expect(list.map((m) => m.runId)).toEqual(["b", "a"]);
  });

  it("lists by workspace, newest first", async () => {
    await putMeta(baseMeta({ runId: "a", workspaceId: "ws-X", startedAt: 1000 }));
    await putMeta(baseMeta({ runId: "b", workspaceId: "ws-X", startedAt: 3000 }));
    await putMeta(baseMeta({ runId: "c", workspaceId: "ws-X", startedAt: 2000 }));
    const list = await listWorkflowsByWorkspace("ws-X");
    expect(list.map((m) => m.runId)).toEqual(["b", "c", "a"]);
  });

  it("respects the limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      await putMeta(baseMeta({ runId: `r-${i}`, userId: "u-many", startedAt: 1000 + i }));
    }
    const list = await listWorkflowsByUser("u-many", { limit: 3 });
    expect(list).toHaveLength(3);
  });
});
