import { beforeEach, expect, it, vi } from "vitest";
import { contentReviewWorkflow } from "./content-review-workflow";
const h = vi.hoisted(() => ({
  generation: 1,
  raw: null as string | null,
  charge: vi.fn(),
  reconcile: vi.fn(),
  submit: vi.fn(),
  query: vi.fn(),
  save: vi.fn(),
  upload: vi.fn(),
  write: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/config", () => ({
  appEnv: { siteRegion: "global", api: { auroraBaseUrl: "https://api.test" } },
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: () => ({ read: () => h.raw, write: h.write }),
}));
vi.mock("./review-workflow-lock", async () => await import("./review-workflow-lock.native"));
vi.mock("./api/content-review-jobs-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api/content-review-jobs-api")>()),
  chargeContentReview: h.charge,
  reconcileContentReviewCharge: h.reconcile,
  submitContentReview: h.submit,
  queryContentReview: h.query,
  saveContentReview: h.save,
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("./api/studio-workspace-settings-api", () => ({ fetchWorkspaceSettings: vi.fn() }));
vi.mock("./content-review-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./content-review-upload")>()),
  uploadReviewVideo: h.upload,
}));
vi.mock("./review-upload-storage", () => ({
  reviewUploadStorage: () => ({ read: () => null, save: vi.fn(), clear: h.clear }),
}));
const workspaceId = "11111111-1111-4111-8111-111111111111",
  chargeId = "22222222-2222-4222-8222-222222222222",
  uploadId = "33333333-3333-4333-8333-333333333333";
const source = {
  name: "clip.mp4",
  size: 5,
  contentType: "video/mp4" as const,
  read: async () => new Uint8Array(5),
};
const result = {
  overview: { taskId: "job", riskLevel: "low" },
  details: [],
  fileName: "review.xlsx",
};
const api = () => contentReviewWorkflow("user", workspaceId, 1),
  signal = () => new AbortController().signal;
const begin = () => api().begin({ chargeId, uploadId }, source, 61);
beforeEach(() => {
  vi.resetAllMocks();
  h.raw = null;
  h.generation = 1;
  h.write.mockImplementation((value: string) => {
    h.raw = value;
  });
  h.charge.mockResolvedValue({ id: chargeId, credits: 20 });
  h.reconcile.mockResolvedValue({ id: chargeId, credits: 20 });
  h.submit.mockResolvedValue("job");
  h.upload.mockResolvedValue({
    mediaAssetId: uploadId,
    storageKey: "key",
    url: "https://media.test/video",
  });
  h.query.mockResolvedValue({ status: "success", result });
  h.save.mockResolvedValue({ id: uploadId });
});
it("persists each non-idempotent intent before its request and saves the completed report", async () => {
  await begin();
  expect(h.charge).not.toHaveBeenCalled();
  h.charge.mockImplementation(async () => {
    expect(api().read()?.phase).toBe("charging");
    return { id: chargeId, credits: 20 };
  });
  h.submit.mockImplementation(async () => {
    expect(api().read()?.phase).toBe("submitting");
    return "job";
  });
  const saved = await api().run(signal(), chargeId, source);
  expect(saved.phase).toBe("saved");
  expect(saved.recordId).toBe(uploadId);
  expect(saved.asset).toBeUndefined();
  expect(saved.result).toBeUndefined();
  expect(h.save).toHaveBeenCalledWith(
    workspaceId,
    1,
    expect.objectContaining({ chargeId, creditsCharged: 20, mediaAssetId: uploadId }),
    expect.any(AbortSignal)
  );
  expect(h.clear).toHaveBeenCalledOnce();
});
it("resumes the same polled job without charging, uploading or submitting again", async () => {
  await begin();
  h.query.mockResolvedValueOnce({ status: "processing" });
  expect((await api().run(signal(), chargeId, source)).phase).toBe("reviewing");
  expect((await api().run(signal(), chargeId)).phase).toBe("saved");
  expect(h.charge).toHaveBeenCalledOnce();
  expect(h.upload).toHaveBeenCalledOnce();
  expect(h.submit).toHaveBeenCalledOnce();
  expect(h.query.mock.calls.map((call) => call[2])).toEqual(["job", "job"]);
});
it("preserves the original charge ID after response loss and confirms it before proceeding", async () => {
  await begin();
  h.charge.mockRejectedValueOnce(new Error("Lost receipt"));
  await expect(api().run(signal(), chargeId, source)).rejects.toThrow("Lost receipt");
  expect(api().read()?.phase).toBe("charging");
  await api().run(signal(), chargeId, source);
  expect(h.charge).toHaveBeenCalledOnce();
  expect(h.reconcile).toHaveBeenCalledWith(
    workspaceId,
    1,
    { id: chargeId, durationSeconds: 61 },
    "settle",
    expect.any(AbortSignal)
  );
});
it("replays the same charge only on the explicit not-found contract", async () => {
  await begin();
  h.charge.mockRejectedValueOnce(new Error("Offline"));
  await expect(api().run(signal(), chargeId, source)).rejects.toThrow();
  h.reconcile.mockRejectedValueOnce(
    Object.assign(new Error("Not found"), {
      status: 404,
      code: "HTTP_404",
      responseBody: JSON.stringify({ code: "CONTENT_REVIEW_CHARGE_NOT_FOUND" }),
    })
  );
  await api().run(signal(), chargeId, source);
  expect(h.charge.mock.calls.map((call) => call[2].id)).toEqual([chargeId, chargeId]);
});
it("does not re-debit when reconciliation fails for another reason", async () => {
  await begin();
  h.charge.mockRejectedValueOnce(new Error("Offline"));
  await expect(api().run(signal(), chargeId, source)).rejects.toThrow();
  h.reconcile.mockRejectedValue(new Error("Access lost"));
  await expect(api().run(signal(), chargeId, source)).rejects.toThrow("Access lost");
  expect(h.charge).toHaveBeenCalledOnce();
});
it("blocks a second submission and refund when its original response is unknown", async () => {
  await begin();
  h.submit.mockRejectedValueOnce(new Error("Response lost"));
  await expect(api().run(signal(), chargeId, source)).rejects.toThrow("Response lost");
  expect(api().read()?.phase).toBe("submitting");
  await expect(api().run(signal(), chargeId)).rejects.toThrow("unknown");
  await expect(api().refund(signal(), chargeId)).rejects.toThrow("Resolve");
  expect(h.submit).toHaveBeenCalledOnce();
  await expect(begin()).rejects.toThrow("existing review");
});
it("requires the original source before making any new debit", async () => {
  await begin();
  await expect(api().run(signal(), chargeId)).rejects.toThrow("original video");
  expect(h.charge).not.toHaveBeenCalled();
});
it("keeps completed findings through settlement and save failures", async () => {
  await begin();
  h.reconcile.mockRejectedValueOnce(new Error("Settle offline"));
  await expect(api().run(signal(), chargeId, source)).rejects.toThrow();
  expect(api().read()?.phase).toBe("reviewed");
  h.save.mockRejectedValueOnce(new Error("Save response lost"));
  await expect(api().run(signal(), chargeId)).rejects.toThrow();
  expect(api().read()?.phase).toBe("settled");
  await api().run(signal(), chargeId);
  expect(h.submit).toHaveBeenCalledOnce();
  expect(h.save).toHaveBeenCalledTimes(2);
  expect(h.save.mock.calls[0][2]).toEqual(h.save.mock.calls[1][2]);
});
it("records provider failure and refunds only on an explicit request", async () => {
  await begin();
  h.query.mockResolvedValue({ status: "failed", message: "Provider failed" });
  const failed = await api().run(signal(), chargeId, source);
  expect(failed.phase).toBe("failed");
  expect(h.reconcile).not.toHaveBeenCalled();
  const refunded = await api().refund(signal(), chargeId);
  expect(refunded.phase).toBe("refunded");
  expect(h.reconcile.mock.calls[0][3]).toBe("release");
});
it("does not mistake a zero refund of an uncertain debit for cancellation", async () => {
  await begin();
  h.charge.mockRejectedValueOnce(new Error("Lost receipt"));
  await expect(api().run(signal(), chargeId, source)).rejects.toThrow();
  h.reconcile.mockRejectedValueOnce(
    Object.assign(new Error("Not found"), {
      status: 404,
      code: "HTTP_404",
      responseBody: JSON.stringify({ code: "CONTENT_REVIEW_CHARGE_NOT_FOUND" }),
    })
  );
  await expect(api().refund(signal(), chargeId)).rejects.toThrow("Not found");
  expect(api().read()?.phase).toBe("charging");
  expect(h.reconcile.mock.calls[0][3]).toBe("settle");
});
it("retries a lost refund receipt using the same charge", async () => {
  await begin();
  h.upload.mockRejectedValue(new Error("Upload failed"));
  await expect(api().run(signal(), chargeId, source)).rejects.toThrow();
  h.reconcile.mockRejectedValueOnce(new Error("Refund response lost"));
  await expect(api().refund(signal(), chargeId)).rejects.toThrow();
  expect(api().read()?.phase).toBe("refunding");
  await api().refund(signal(), chargeId);
  expect(h.reconcile.mock.calls.map((call) => call[2].id)).toEqual([chargeId, chargeId]);
});
it("blocks concurrent resume and aborts stale account writes", async () => {
  await begin();
  let finish!: () => void;
  h.charge.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ id: chargeId, credits: 20 });
      })
  );
  const first = api().run(signal(), chargeId, source);
  await Promise.resolve();
  await expect(api().run(signal(), chargeId, source)).rejects.toThrow("already running");
  h.generation = 2;
  finish();
  await expect(first).rejects.toThrow("session");
  expect(JSON.parse(h.raw!).phase).toBe("charging");
  expect(h.upload).not.toHaveBeenCalled();
});
it("does not send a charge when persistence fails", async () => {
  await begin();
  h.write.mockImplementation(() => {
    throw new Error("Disk full");
  });
  await expect(api().run(signal(), chargeId, source)).rejects.toThrow("Disk full");
  expect(h.charge).not.toHaveBeenCalled();
});

it("never replays a debit on a generic route 404", async () => {
  await begin();
  h.charge.mockRejectedValueOnce(new Error("Response lost"));
  await expect(api().run(signal(), chargeId, source)).rejects.toThrow();
  h.reconcile.mockRejectedValueOnce(
    Object.assign(new Error("Cannot POST route"), {
      status: 404,
      code: "HTTP_404",
      responseBody: JSON.stringify({ message: "Cannot POST route" }),
    })
  );
  await expect(api().run(signal(), chargeId, source)).rejects.toThrow("Cannot POST");
  expect(h.charge).toHaveBeenCalledOnce();
});
it("rejects stale confirmation and cancellation after another tab replaces the review", async () => {
  await begin();
  await api().refund(signal(), chargeId);
  const replacementId = "44444444-4444-4444-8444-444444444444";
  await api().begin({ chargeId: replacementId, uploadId }, source, 61);
  h.write.mockClear();
  await expect(api().run(signal(), chargeId, source)).rejects.toThrow("Review changed");
  await expect(api().refund(signal(), chargeId)).rejects.toThrow("Review changed");
  expect(h.charge).not.toHaveBeenCalled();
  expect(h.reconcile).not.toHaveBeenCalled();
  expect(h.upload).not.toHaveBeenCalled();
  expect(h.write).not.toHaveBeenCalled();
  expect(api().read()?.id).toBe(replacementId);
  expect(api().read()?.phase).toBe("ready");
  expect((await api().run(signal(), replacementId, source)).phase).toBe("saved");
});
