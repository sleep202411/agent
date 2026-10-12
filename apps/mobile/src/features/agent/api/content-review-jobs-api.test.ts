import { beforeEach, expect, it, vi } from "vitest";
import {
  chargeContentReview,
  reconcileContentReviewCharge,
  submitContentReview,
  queryContentReview,
  saveContentReview,
} from "./content-review-jobs-api";
const h = vi.hoisted(() => ({ post: vi.fn(), workspace: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post, get: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./studio-workspace-settings-api", () => ({ fetchWorkspaceSettings: h.workspace }));
const workspaceId = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  media = "33333333-3333-4333-8333-333333333333";
const charge = { id, durationSeconds: 61 },
  signal = new AbortController().signal,
  url = "https://media.test/signed-video?token=abc";
const input = {
  mediaAssetId: media,
  chargeId: id,
  durationSeconds: 61,
  creditsCharged: 20,
  fileName: "clip.mp4",
  exportFileName: "review.xlsx",
  overview: { taskId: "job", riskLevel: "low" },
  details: [],
};
const record = () => ({
  ...input,
  id: media,
  createdByUserId: "user",
  createdAt: "2026-10-01T00:00:00Z",
  findingCount: 0,
  suggestion: null,
  riskLevel: "low",
  comments: [],
});
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.workspace.mockResolvedValue({
    id: workspaceId,
    status: "active",
    accessScope: "workspace",
    role: "editor",
  });
});
it.each([1, 60, 61, 10800])(
  "charges exact official credits for %s seconds using a stable caller ID",
  async (durationSeconds) => {
    const credits = Math.ceil(durationSeconds / 60) * 10;
    h.post.mockResolvedValue({ id, credits });
    expect(await chargeContentReview(workspaceId, 1, { id, durationSeconds }, signal)).toEqual({
      id,
      credits,
    });
    expect(h.post).toHaveBeenCalledWith("/content-review/charges", {
      service: "aurora",
      signal,
      retry: false,
      headers: { "x-fizz-workspace-id": workspaceId },
      data: { id, durationSeconds },
    });
  }
);
it.each([0, 1.5, 10801, NaN])(
  "rejects invalid duration %s before any write",
  async (durationSeconds) => {
    await expect(
      chargeContentReview(workspaceId, 1, { id, durationSeconds }, signal)
    ).rejects.toThrow();
    expect(h.post).not.toHaveBeenCalled();
  }
);
it.each(["viewer", "project_only", "suspended"])(
  "blocks %s access before billing or Java submission",
  async (value) => {
    h.workspace.mockResolvedValue({
      id: workspaceId,
      status: value === "suspended" ? value : "active",
      accessScope: value === "project_only" ? value : "workspace",
      role: value === "viewer" ? value : "editor",
    });
    await expect(chargeContentReview(workspaceId, 1, charge, signal)).rejects.toThrow("editor");
    await expect(submitContentReview(workspaceId, 1, url, signal)).rejects.toThrow("editor");
    expect(h.post).not.toHaveBeenCalled();
  }
);
it("requires matching charge receipts and preserves insufficient balance errors", async () => {
  h.post.mockResolvedValue({ id: media, credits: 20 });
  await expect(chargeContentReview(workspaceId, 1, charge, signal)).rejects.toThrow("receipt");
  h.post.mockResolvedValue({ id, credits: 10 });
  await expect(chargeContentReview(workspaceId, 1, charge, signal)).rejects.toThrow("receipt");
  const error = Object.assign(new Error("Insufficient compute points"), { status: 409 });
  h.post.mockRejectedValue(error);
  await expect(chargeContentReview(workspaceId, 1, charge, signal)).rejects.toBe(error);
});
it("reconciles the original charge without creating a new debit, allowing zero only for release", async () => {
  h.post.mockResolvedValue({ id, credits: 20 });
  await reconcileContentReviewCharge(workspaceId, 1, charge, "settle", signal);
  expect(h.post).toHaveBeenCalledWith(
    `/content-review/charges/${id}/settle`,
    expect.objectContaining({ retry: false, data: {} })
  );
  h.post.mockResolvedValue({ id, credits: 0 });
  await expect(
    reconcileContentReviewCharge(workspaceId, 1, charge, "settle", signal)
  ).rejects.toThrow("receipt");
  await expect(
    reconcileContentReviewCharge(workspaceId, 1, charge, "release", signal)
  ).resolves.toEqual({ id, credits: 0 });
});
it("submits once and never folds uncertain submission into another submit or refund", async () => {
  const error = new Error("Response lost");
  h.post.mockRejectedValue(error);
  await expect(submitContentReview(workspaceId, 1, url, signal)).rejects.toBe(error);
  expect(h.post).toHaveBeenCalledOnce();
  expect(h.post).toHaveBeenCalledWith("/api/user/video/moderation/ai/submit", {
    service: "studio",
    retry: false,
    signal,
    timeout: 60000,
    data: { url },
  });
});
it.each(["http://media.test/video", "https://user:pass@media.test/video", "file:///video"])(
  "rejects unsafe submission URL %s",
  async (unsafe) => {
    await expect(submitContentReview(workspaceId, 1, unsafe, signal)).rejects.toThrow();
    expect(h.post).not.toHaveBeenCalled();
  }
);
it("queries the same job once and preserves complete provider evidence", async () => {
  h.post.mockResolvedValue({ status: "processing", taskId: "job" });
  await expect(queryContentReview(workspaceId, 1, "job", url, signal)).resolves.toEqual({
    status: "processing",
  });
  expect(h.post).toHaveBeenCalledWith(
    "/api/user/video/moderation/ai/query",
    expect.objectContaining({ retry: false, data: { taskId: "job", url } })
  );
  h.post.mockResolvedValue({
    status: "success",
    overview: { taskId: "job", requestId: "request", providerField: "preserved" },
    details: [{ source: "audio", providerEvidence: "preserved" }],
  });
  await expect(queryContentReview(workspaceId, 1, "job", url, signal)).resolves.toMatchObject({
    status: "success",
    result: {
      overview: { providerField: "preserved" },
      details: [{ providerEvidence: "preserved" }],
      fileName: "video-moderation.xlsx",
    },
  });
});
it("distinguishes provider failure, invalid success and wrong-job responses", async () => {
  h.post.mockResolvedValue({ status: "failed", message: "Provider unavailable" });
  await expect(queryContentReview(workspaceId, 1, "job", url, signal)).resolves.toEqual({
    status: "failed",
    message: "Provider unavailable",
  });
  for (const value of [
    { status: "success" },
    { status: "unknown" },
    { status: "processing", taskId: "other" },
  ]) {
    h.post.mockResolvedValue(value);
    await expect(queryContentReview(workspaceId, 1, "job", url, signal)).rejects.toThrow();
  }
});
it("saves with the original chargeId and checks the returned media and credits", async () => {
  h.post.mockResolvedValue(record());
  await expect(saveContentReview(workspaceId, 1, input, signal)).resolves.toMatchObject({
    id: media,
  });
  expect(h.post).toHaveBeenCalledWith(
    "/content-review/records",
    expect.objectContaining({
      retry: false,
      data: input,
      headers: { "x-fizz-workspace-id": workspaceId },
    })
  );
  h.post.mockResolvedValue({ ...record(), mediaAssetId: id });
  await expect(saveContentReview(workspaceId, 1, input, signal)).rejects.toThrow("receipt");
  await expect(
    saveContentReview(workspaceId, 1, { ...input, creditsCharged: 10 }, signal)
  ).rejects.toThrow("credits");
});
it("drops receipts after an account switch or cancellation", async () => {
  h.post.mockImplementation(async () => {
    h.generation = 2;
    return { id, credits: 20 };
  });
  await expect(chargeContentReview(workspaceId, 1, charge, signal)).rejects.toThrow("session");
  h.generation = 1;
  const controller = new AbortController();
  controller.abort();
  h.post.mockClear();
  await expect(chargeContentReview(workspaceId, 1, charge, controller.signal)).rejects.toThrow(
    "session"
  );
  expect(h.post).not.toHaveBeenCalled();
});

it("rejects a reused save receipt with different moderation evidence", async () => {
  h.post.mockResolvedValue({ ...record(), overview: { taskId: "another-job", riskLevel: "low" } });
  await expect(saveContentReview(workspaceId, 1, input, signal)).rejects.toThrow("receipt");
});
