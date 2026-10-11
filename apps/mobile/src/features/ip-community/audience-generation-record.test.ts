import { beforeEach, expect, it, vi } from "vitest";
import { audienceGenerationRecord, recoverAudienceJob } from "./audience-generation-record";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: () => {
    throw Error("Explicit storage required");
  },
}));
let raw: string | null;
const storage = {
  read: () => raw,
  write: (value: string) => {
    raw = value;
  },
};
const intent = {
  key: "original-key",
  ipId: "ip",
  templateId: "template",
  templateName: "Portrait",
  referenceImageAssetId: "ref",
};
beforeEach(() => {
  h.generation = 1;
  h.get.mockReset();
  raw = null;
});
it("persists the exact command before dispatch and keeps its acknowledged job across reopening", () => {
  const first = audienceGenerationRecord("ip", "viewer", 1, storage);
  first.create(intent);
  const reopened = audienceGenerationRecord("ip", "viewer", 1, storage);
  expect(reopened.read()).toEqual(intent);
  expect(() => reopened.create({ ...intent, key: "replacement" })).toThrow("recovered first");
  reopened.acknowledge(intent.key, "job");
  expect(first.read()?.jobId).toBe("job");
  expect(() => first.acknowledge("other", "job")).toThrow("does not match");
  expect(() => first.acknowledge(intent.key, "another-job")).toThrow("does not match");
});
it("fails closed on storage errors, wrong IP, malformed records and stale sessions", () => {
  expect(() =>
    audienceGenerationRecord("ip", "viewer", 1, {
      read: () => null,
      write: () => {
        throw Error("Disk full");
      },
    }).create(intent)
  ).toThrow("Disk full");
  const store = audienceGenerationRecord("ip", "viewer", 1, storage);
  store.create(intent);
  expect(() => audienceGenerationRecord("other", "viewer", 1, storage).read()).toThrow(
    "does not match"
  );
  h.generation++;
  expect(() => store.acknowledge(intent.key, "job")).toThrow("session expired");
  h.generation = 1;
  raw = "broken";
  expect(() => store.read()).toThrow();
});
it("recovers by exact key and audience surface without posting", async () => {
  h.get.mockResolvedValue({
    jobs: [{ id: "job", idempotencyKey: intent.key, sourceSurface: "ip_audience_generation" }],
  });
  const signal = new AbortController().signal;
  expect(await recoverAudienceJob(intent, signal)).toBe("job");
  expect(h.get).toHaveBeenCalledWith("/ai/jobs", {
    service: "aurora",
    retry: false,
    signal,
    params: { idempotencyKey: intent.key, sourceSurface: "ip_audience_generation", limit: 80 },
  });
});
it.each(
  [
    [{ id: "job", idempotencyKey: "other", sourceSurface: "ip_audience_generation" }],
    [{ id: "job", idempotencyKey: intent.key, sourceSurface: "ai-lab" }],
    [
      { id: "a", idempotencyKey: intent.key, sourceSurface: "ip_audience_generation" },
      { id: "b", idempotencyKey: intent.key, sourceSurface: "ip_audience_generation" },
    ],
  ].map((jobs) => ({ jobs }))
)("rejects unrelated or ambiguous receipts", async ({ jobs }) => {
  h.get.mockResolvedValue({ jobs });
  await expect(recoverAudienceJob(intent, new AbortController().signal)).rejects.toThrow(
    "need review"
  );
});
it("does not turn a missing receipt into permission to resubmit", async () => {
  h.get.mockResolvedValue({ jobs: [] });
  expect(await recoverAudienceJob(intent, new AbortController().signal)).toBeNull();
});
