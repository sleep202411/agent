import { beforeEach, expect, it, vi } from "vitest";
import {
  storyReferences,
  referenceReviewInputSchema,
  type ReferenceSpec,
} from "./story-references-api";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post, put: h.put } }));
const projectId = "11111111-1111-4111-8111-111111111111",
  slotId = "22222222-2222-4222-8222-222222222222",
  versionId = "33333333-3333-4333-8333-333333333333",
  assetId = "44444444-4444-4444-8444-444444444444",
  variantId = "55555555-5555-4555-8555-555555555555",
  reviewId = "66666666-6666-4666-8666-666666666666";
const spec: ReferenceSpec = {
  key: "HERO",
  kind: "character",
  label: "Hero",
  description: "Front view",
  required: true,
  rank: 0,
};
const asset = {
  id: assetId,
  kind: "image",
  status: "ready",
  moderationStatus: "approved",
  contentType: "image/png",
  width: 640,
  height: 480,
  durationSeconds: null,
  checksumSha256: "a".repeat(64),
  previewUrl: "https://example.com/image.png",
};
const version = {
  id: versionId,
  slotId,
  number: 1,
  source: "upload",
  aiJobId: null,
  aiJobOutputId: null,
  asset,
  variantId,
  sourceRecipeSnapshot: null,
  checksumSha256: "a".repeat(64),
  reviewRevision: 0,
  approved: false,
  createdByUserId: "7",
  createdAt: "2026-10-04",
};
const slot = {
  ...spec,
  id: slotId,
  projectId,
  version: 0,
  status: "candidate",
  approvedVersionId: null,
  versions: [version],
  createdAt: "2026-10-04",
  updatedAt: "2026-10-04",
};
const passing = {
  technical: "pass",
  identityContinuity: "na",
  rights: "pass",
  safety: "pass",
} as const;
const input = { expectedReviewRevision: 0, decision: "approve" as const, checklist: passing };
const client = () => storyReferences({ projectId, generation: 1 });
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue([slot]);
  h.post.mockResolvedValue([slot]);
  h.put.mockResolvedValue(slot);
});
it("reads project-owned slots without hiding read errors", async () => {
  expect(await client().list(signal())).toEqual([slot]);
  expect(h.get.mock.calls[0]).toEqual([
    `/story-projects/${projectId}/reference-slots`,
    expect.objectContaining({ service: "aurora", retry: false }),
  ]);
  const failure = Error("Permission denied");
  h.get.mockRejectedValue(failure);
  await expect(client().list(signal())).rejects.toBe(failure);
});
it.each([
  { ...slot, projectId: assetId },
  { ...slot, versions: [{ ...version, slotId: assetId }] },
  { ...slot, status: "approved", approvedVersionId: versionId },
])("rejects foreign or unproven slot receipts", async (value) => {
  h.get.mockResolvedValue([value]);
  await expect(client().list(signal())).rejects.toThrow();
});
it("uses caller-owned retry keys and rejects duplicate batch keys", async () => {
  await client().create([spec], "attempt-1", signal());
  expect(h.post.mock.calls[0][1]).toMatchObject({
    headers: { "Idempotency-Key": "attempt-1" },
    data: { slots: [spec] },
    retry: false,
  });
  await expect(client().create([spec, spec], "attempt-2", signal())).rejects.toThrow("Duplicate");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it.each(["", "hero", "A/../../B"])("rejects invalid stable key %s", async (key) => {
  await expect(client().create([{ ...spec, key }], "attempt", signal())).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects an unrelated creation receipt", async () => {
  h.post.mockResolvedValue([{ ...slot, key: "OTHER" }]);
  await expect(client().create([spec], "attempt", signal())).rejects.toThrow("receipt mismatch");
});
it("preserves expected versions and server conflict details", async () => {
  const failure = Error("Reference changed. Reload before editing.");
  h.put.mockRejectedValue(failure);
  await expect(client().update(slotId, 4, spec, signal())).rejects.toBe(failure);
  expect(h.put.mock.calls[0][1]).toMatchObject({
    data: { expectedSlotVersion: 4, slot: spec },
    retry: false,
  });
});
it("checks uploaded media identity and preserves its retry key", async () => {
  h.post.mockResolvedValue(version);
  const data = { expectedSlotVersion: 0, source: "upload" as const, assetId, variantId };
  expect(await client().addVersion(slotId, data, "upload-1", signal())).toEqual(version);
  expect(h.post.mock.calls[0][1]).toMatchObject({
    headers: { "Idempotency-Key": "upload-1" },
    data,
  });
  h.post.mockResolvedValue({ ...version, variantId: assetId });
  await expect(client().addVersion(slotId, data, "upload-1", signal())).rejects.toThrow(
    "media receipt mismatch"
  );
});
it("rejects versions owned by another slot", async () => {
  h.get.mockResolvedValue([version]);
  expect(await client().versions(slotId, signal())).toEqual([version]);
  h.get.mockResolvedValue([{ ...version, slotId: assetId }]);
  await expect(client().versions(slotId, signal())).rejects.toThrow("ownership");
});
it.each(["reject", "request_changes"] as const)("requires a comment for %s", (decision) => {
  expect(referenceReviewInputSchema.safeParse({ ...input, decision, comment: "  " }).success).toBe(
    false
  );
  expect(
    referenceReviewInputSchema.parse({ ...input, decision, comment: "Fix identity" }).comment
  ).toBe("Fix identity");
});
it.each(["technical", "rights", "safety"] as const)("cannot approve a failed %s check", (key) => {
  expect(
    referenceReviewInputSchema.safeParse({ ...input, checklist: { ...passing, [key]: "fail" } })
      .success
  ).toBe(false);
});
it("records review separately from slot approval", async () => {
  const review = {
    id: reviewId,
    decision: "approve",
    checklist: passing,
    comment: null,
    reviewerUserId: "7",
    createdAt: "2026-10-04",
  };
  h.post.mockResolvedValue({ reference: { ...version, reviewRevision: 1 }, review });
  expect((await client().review(slotId, versionId, input, signal())).review.id).toBe(reviewId);
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.post.mock.calls[0][0]).toContain(`/versions/${versionId}/reviews`);
});
it("approves an explicit review/version and verifies the active selection", async () => {
  const approved = {
    ...slot,
    version: 1,
    status: "approved",
    approvedVersionId: versionId,
    versions: [{ ...version, approved: true }],
  };
  h.post.mockResolvedValue(approved);
  expect(await client().approve(slotId, 0, versionId, reviewId, signal())).toEqual(approved);
  expect(h.post.mock.calls[0][1].data).toEqual({
    expectedSlotVersion: 0,
    referenceVersionId: versionId,
    approveReviewId: reviewId,
  });
  h.post.mockResolvedValue(slot);
  await expect(client().approve(slotId, 0, versionId, reviewId, signal())).rejects.toThrow(
    "approval receipt"
  );
});
it("blocks requests from expired accounts", async () => {
  h.generation = 2;
  await expect(client().list(signal())).rejects.toThrow("session expired");
  await expect(client().create([spec], "attempt", signal())).rejects.toThrow("session expired");
  expect(h.get).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects late write receipts after account change", async () => {
  h.post.mockImplementation(async () => {
    h.generation = 2;
    return [slot];
  });
  await expect(client().create([spec], "attempt", signal())).rejects.toThrow("session expired");
});
it("rejects cancelled reads even if transport resolves", async () => {
  const c = new AbortController();
  h.get.mockImplementation(async () => {
    c.abort();
    return [slot];
  });
  await expect(client().list(c.signal)).rejects.toThrow();
});
