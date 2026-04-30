/**
 * Integration tests for `attachment-resolve` — the two-tier resolver that
 * patches the "Attachment ref not found or expired" production bug.
 *
 * Strategy:
 *   - Real libsql in-memory artifact store (`MASTRA_DB_URL` set before
 *     module import, mirroring artifact-store.test.ts).
 *   - Mocked Redis client so we can control hit / miss / payload shape
 *     without standing up a Redis instance.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.MASTRA_DB_URL = "file::memory:?cache=shared";

const mockRedisGet = vi.fn();
vi.mock("./redis-client", () => ({
  getRedis: () => ({ get: mockRedisGet }),
}));

import {
  findArtifactByAttachmentRef,
  listProjectArtifacts,
  putArtifact,
  _resetForTests,
} from "./artifact-store";
import { resolveAttachmentRefs, resolveAttachmentText } from "./attachment-resolve";

beforeAll(async () => {
  await _resetForTests();
});

afterEach(async () => {
  await _resetForTests();
  mockRedisGet.mockReset();
});

const REF = "att_abc123";

function redisPayload(text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ text, filename: "x.docx", chars: text.length, ...extra });
}

describe("resolveAttachmentText — Redis tier", () => {
  it("returns the cached text on a Redis hit", async () => {
    mockRedisGet.mockResolvedValueOnce(redisPayload("hello world"));
    const text = await resolveAttachmentText(REF, { projectId: "p1" });
    expect(text).toBe("hello world");
  });

  it("promotes the resolved text to a durable user_doc artifact", async () => {
    mockRedisGet.mockResolvedValueOnce(redisPayload("durable copy"));
    await resolveAttachmentText(REF, { projectId: "p1" });
    const artifact = await findArtifactByAttachmentRef<{ text: string }>("p1", "user_doc", REF);
    expect(artifact).not.toBeNull();
    expect(artifact?.content.text).toBe("durable copy");
    expect(artifact?.meta?.attachmentRef).toBe(REF);
  });

  it("is idempotent — repeated resolves don't create duplicate artifacts", async () => {
    mockRedisGet.mockResolvedValue(redisPayload("once"));
    await resolveAttachmentText(REF, { projectId: "p1" });
    await resolveAttachmentText(REF, { projectId: "p1" });
    await resolveAttachmentText(REF, { projectId: "p1" });
    const all = await listProjectArtifacts("p1");
    const matching = all.filter(
      (r) =>
        r.kind === "user_doc" &&
        (r.meta as Record<string, unknown> | undefined)?.attachmentRef === REF
    );
    expect(matching).toHaveLength(1);
  });

  it("skips the durable promote when projectId is absent", async () => {
    mockRedisGet.mockResolvedValueOnce(redisPayload("ephemeral"));
    const text = await resolveAttachmentText(REF, {});
    expect(text).toBe("ephemeral");
    // No project to scope to, but make sure no orphan write happened
    // under common project ids.
    const orphan = await findArtifactByAttachmentRef("", "user_doc", REF);
    expect(orphan).toBeNull();
  });

  it("rejects refs that don't start with att_", async () => {
    await expect(resolveAttachmentText("not_a_ref")).rejects.toThrow(/Not an attachment ref/);
  });
});

describe("resolveAttachmentText — artifact-store fallback", () => {
  it("returns the durable copy when Redis has evicted", async () => {
    // Pre-seed the durable copy as if a previous resolve had promoted it.
    await putArtifact({
      projectId: "p1",
      kind: "user_doc",
      source: "attachment_promote",
      content: { text: "from durable storage" },
      meta: { attachmentRef: REF },
    });
    mockRedisGet.mockResolvedValueOnce(null);
    const text = await resolveAttachmentText(REF, { projectId: "p1" });
    expect(text).toBe("from durable storage");
  });

  it("falls back to the latest user_doc on the project as a last resort", async () => {
    // Simulates the production scenario: parse_script committed a user_doc
    // (no attachmentRef in meta because it predates this fix), Redis has
    // evicted, the by-ref lookup misses — but we still want resolution to
    // succeed against the project's most recent user_doc.
    await putArtifact({
      projectId: "p1",
      kind: "user_doc",
      source: "parse_script",
      content: { text: "legacy parse_script body" },
      meta: { runId: "old-run" },
    });
    mockRedisGet.mockResolvedValueOnce(null);
    const text = await resolveAttachmentText(REF, { projectId: "p1" });
    expect(text).toBe("legacy parse_script body");
  });

  it("throws the canonical error when both tiers miss", async () => {
    mockRedisGet.mockResolvedValueOnce(null);
    await expect(resolveAttachmentText(REF, { projectId: "p1" })).rejects.toThrow(
      `Attachment ref not found or expired: ${REF}`
    );
  });

  it("throws when projectId is absent and Redis misses (no fallback to attempt)", async () => {
    mockRedisGet.mockResolvedValueOnce(null);
    await expect(resolveAttachmentText(REF, {})).rejects.toThrow(/not found or expired/);
  });
});

describe("resolveAttachmentRefs — recursive walker", () => {
  it("rewrites *Ref keys to bare keys with resolved text", async () => {
    mockRedisGet.mockResolvedValueOnce(redisPayload("script body"));
    const out = (await resolveAttachmentRefs(
      { textRef: REF, targetEpisodeCount: 12 },
      { projectId: "p1" }
    )) as Record<string, unknown>;
    expect(out.text).toBe("script body");
    expect(out.targetEpisodeCount).toBe(12);
    expect(out.textRef).toBeUndefined();
  });

  it("walks into nested objects and arrays", async () => {
    mockRedisGet.mockResolvedValueOnce(redisPayload("nested"));
    const out = (await resolveAttachmentRefs(
      { items: [{ textRef: REF, n: 1 }] },
      { projectId: "p1" }
    )) as { items: Array<Record<string, unknown>> };
    expect(out.items[0].text).toBe("nested");
    expect(out.items[0].n).toBe(1);
  });

  it("leaves non-att_ string values untouched", async () => {
    const out = (await resolveAttachmentRefs(
      { someRef: "not-an-attachment", x: 1 },
      { projectId: "p1" }
    )) as Record<string, unknown>;
    expect(out.someRef).toBe("not-an-attachment");
    expect(out.x).toBe(1);
    expect(mockRedisGet).not.toHaveBeenCalled();
  });
});
