import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  countDrafts,
  deleteAllDrafts,
  deleteDraft,
  getDraft,
  listDrafts,
  markDraftCommitted,
  markDraftCommitting,
  markDraftDiscarded,
  markDraftFailed,
  patchDraft,
  putDraft,
} from "./drafts";
import { __resetRedisForTests, getRedis } from "./redis-client";

const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:16379";

type RoleData = { name: string; description: string };
type SceneData = { name: string };

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

describe("putDraft / getDraft", () => {
  it("persists and reads back a draft", async () => {
    const draft = await putDraft<RoleData>("run-1", "role", "c-1", {
      name: "Alice",
      description: "alpha",
    });
    expect(draft.status).toBe("pending");
    expect(draft.createdAt).toBeGreaterThan(0);

    const loaded = await getDraft<RoleData>("run-1", "c-1");
    expect(loaded).not.toBeNull();
    expect(loaded?.data.name).toBe("Alice");
    expect(loaded?.entityType).toBe("role");
  });

  it("returns null for missing clientRefId", async () => {
    expect(await getDraft("run-1", "missing")).toBeNull();
  });

  it('defaults updatedBy to "ai"', async () => {
    const draft = await putDraft("run-1", "role", "c-1", { name: "X", description: "" });
    expect(draft.updatedBy).toBe("ai");
  });

  it("records an updatedBy override", async () => {
    const draft = await putDraft(
      "run-1",
      "role",
      "c-1",
      { name: "X", description: "" },
      { updatedBy: "user-42" }
    );
    expect(draft.updatedBy).toBe("user-42");
  });
});

describe("listDrafts", () => {
  it("lists all drafts for a run, oldest first", async () => {
    await putDraft("run-1", "role", "c-1", { name: "A", description: "" });
    await new Promise((r) => setTimeout(r, 2));
    await putDraft("run-1", "role", "c-2", { name: "B", description: "" });
    await new Promise((r) => setTimeout(r, 2));
    await putDraft("run-1", "scene", "c-3", { name: "S1" });

    const all = await listDrafts("run-1");
    expect(all.map((d) => d.clientRefId)).toEqual(["c-1", "c-2", "c-3"]);
  });

  it("filters by entityType", async () => {
    await putDraft("run-1", "role", "c-1", { name: "A", description: "" });
    await putDraft("run-1", "scene", "c-2", { name: "S" });
    await putDraft("run-1", "scene", "c-3", { name: "S2" });

    const scenes = await listDrafts<SceneData>("run-1", { entityType: "scene" });
    expect(scenes).toHaveLength(2);
    expect(scenes.every((d) => d.entityType === "scene")).toBe(true);
  });

  it("filters by statuses", async () => {
    await putDraft("run-1", "role", "c-1", { name: "A", description: "" });
    await putDraft("run-1", "role", "c-2", { name: "B", description: "" });
    await markDraftCommitted("run-1", "c-1", "java-1");

    const pending = await listDrafts("run-1", { statuses: ["pending"] });
    expect(pending.map((d) => d.clientRefId)).toEqual(["c-2"]);

    const committed = await listDrafts("run-1", { statuses: ["committed"] });
    expect(committed.map((d) => d.clientRefId)).toEqual(["c-1"]);
  });

  it("returns empty array for a run with no drafts", async () => {
    expect(await listDrafts("no-such-run")).toEqual([]);
  });

  it("isolates drafts across runs", async () => {
    await putDraft("run-A", "role", "c-1", { name: "A", description: "" });
    await putDraft("run-B", "role", "c-1", { name: "B", description: "" });

    const listA = await listDrafts<RoleData>("run-A");
    const listB = await listDrafts<RoleData>("run-B");
    expect(listA[0].data.name).toBe("A");
    expect(listB[0].data.name).toBe("B");
  });
});

describe("countDrafts", () => {
  it("counts by run and optional entityType", async () => {
    await putDraft("run-1", "role", "c-1", { name: "A", description: "" });
    await putDraft("run-1", "role", "c-2", { name: "B", description: "" });
    await putDraft("run-1", "scene", "c-3", { name: "S" });

    expect(await countDrafts("run-1")).toBe(3);
    expect(await countDrafts("run-1", { entityType: "role" })).toBe(2);
    expect(await countDrafts("run-1", { entityType: "scene" })).toBe(1);
    expect(await countDrafts("run-1", { entityType: "prop" })).toBe(0);
  });
});

describe("status transitions", () => {
  beforeEach(async () => {
    await putDraft("run-1", "role", "c-1", { name: "A", description: "" });
  });

  it("pending → committing → committed", async () => {
    await markDraftCommitting("run-1", "c-1");
    expect((await getDraft("run-1", "c-1"))?.status).toBe("committing");
    await markDraftCommitted("run-1", "c-1", "java-42");
    const d = await getDraft("run-1", "c-1");
    expect(d?.status).toBe("committed");
    expect(d?.serverId).toBe("java-42");
  });

  it("pending → failed carries error message", async () => {
    await markDraftFailed("run-1", "c-1", "Java 500");
    const d = await getDraft("run-1", "c-1");
    expect(d?.status).toBe("failed");
    expect(d?.error).toBe("Java 500");
  });

  it("pending → discarded", async () => {
    await markDraftDiscarded("run-1", "c-1");
    expect((await getDraft("run-1", "c-1"))?.status).toBe("discarded");
  });

  it("patchDraft returns null for unknown draft", async () => {
    expect(await patchDraft("run-X", "missing", { status: "committed" })).toBeNull();
  });

  it("patchDraft cannot change identity fields", async () => {
    const patched = await patchDraft("run-1", "c-1", {
      runId: "hijacked",
      clientRefId: "hijacked",
      entityType: "scene",
    } as never);
    expect(patched?.runId).toBe("run-1");
    expect(patched?.clientRefId).toBe("c-1");
    expect(patched?.entityType).toBe("role");
  });
});

describe("deletes", () => {
  it("deleteDraft removes main key and index entry", async () => {
    await putDraft("run-1", "role", "c-1", { name: "A", description: "" });
    await putDraft("run-1", "role", "c-2", { name: "B", description: "" });

    await deleteDraft("run-1", "c-1");
    expect(await getDraft("run-1", "c-1")).toBeNull();
    expect(await countDrafts("run-1")).toBe(1);
  });

  it("deleteAllDrafts purges every draft and the index", async () => {
    await putDraft("run-1", "role", "c-1", { name: "A", description: "" });
    await putDraft("run-1", "scene", "c-2", { name: "S" });
    await putDraft("run-1", "prop", "c-3", { name: "P" } as never);

    await deleteAllDrafts("run-1");
    expect(await listDrafts("run-1")).toEqual([]);
    expect(await countDrafts("run-1")).toBe(0);
  });

  it("deleteAllDrafts is idempotent on empty runs", async () => {
    await deleteAllDrafts("nope");
    expect(await listDrafts("nope")).toEqual([]);
  });
});
