import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import {
  isVideoFileAllowed,
  MAX_REVIEW_VIDEO_BYTES,
  creditsForDurationSeconds,
  resultFromReviewRecord,
  reviewModeration,
} from "./content-review-api";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

afterEach(() => {
  vi.mocked(api.post).mockReset();
  vi.useRealTimers();
});

describe("content review upload guards", () => {
  it("accepts mp4 and mov", () => {
    expect(isVideoFileAllowed(new File(["x"], "a.mp4", { type: "video/mp4" }))).toBe(true);
    expect(isVideoFileAllowed(new File(["x"], "b.mov", { type: "video/quicktime" }))).toBe(true);
    expect(isVideoFileAllowed(new File(["x"], "c.MP4", { type: "" }))).toBe(true);
  });

  it("rejects other types", () => {
    expect(isVideoFileAllowed(new File(["x"], "d.webm", { type: "video/webm" }))).toBe(false);
    expect(isVideoFileAllowed(new File(["x"], "e.png", { type: "image/png" }))).toBe(false);
  });

  it("uses the 2 GB upload cap", () => {
    expect(MAX_REVIEW_VIDEO_BYTES).toBe(2 * 1024 ** 3);
  });

  it("bills 10 credits per minute, rounded up, minimum one minute", () => {
    expect(creditsForDurationSeconds(1)).toBe(10);
    expect(creditsForDurationSeconds(60)).toBe(10);
    expect(creditsForDurationSeconds(61)).toBe(20);
    expect(creditsForDurationSeconds(180)).toBe(30);
  });

  it("maps a saved record back to a playable result", () => {
    expect(
      resultFromReviewRecord({
        id: "rec",
        mediaAssetId: "asset",
        fileName: "clip.mp4",
        exportFileName: "clip.xlsx",
        durationSeconds: 12,
        creditsCharged: 10,
        findingCount: 1,
        suggestion: "pass",
        riskLevel: "none",
        createdByUserId: "1",
        createdAt: "2026-09-20T00:00:00.000Z",
        overview: { aiSuggestion: "pass" },
        details: [{ label: "ok", timeOffset: "00:00:01" }],
        comments: [],
      })
    ).toEqual({
      overview: { aiSuggestion: "pass" },
      details: [{ label: "ok", timeOffset: "00:00:01" }],
      fileName: "clip.xlsx",
      creditsCharged: 10,
    });
  });
});

describe("reviewModeration polling", () => {
  it("submits once and returns when Aliyun query succeeds", async () => {
    vi.useFakeTimers();
    vi.mocked(api.post)
      .mockResolvedValueOnce({ taskId: "task-1" })
      .mockResolvedValueOnce({ status: "Processing", taskId: "task-1" })
      .mockResolvedValueOnce({
        status: "Success",
        taskId: "task-1",
        overview: { aiSuggestion: "pass", riskLevel: "none" },
        details: [],
        fileName: "report.xlsx",
      });

    const pending = reviewModeration("https://cdn.example/video.mp4");
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(api.post).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toEqual({
      overview: { aiSuggestion: "pass", riskLevel: "none" },
      details: [],
      fileName: "report.xlsx",
      creditsCharged: null,
    });
    expect(api.post).toHaveBeenNthCalledWith(
      1,
      "/api/user/video/moderation/ai/submit",
      expect.objectContaining({ data: { url: "https://cdn.example/video.mp4" } })
    );
    expect(api.post).toHaveBeenNthCalledWith(
      3,
      "/api/user/video/moderation/ai/query",
      expect.objectContaining({
        data: { taskId: "task-1", url: "https://cdn.example/video.mp4" },
      })
    );
  });

  it("surfaces an Aliyun failure without waiting for the client timeout", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ taskId: "task-1" }).mockResolvedValueOnce({
      status: "Failed",
      message: "video download failed",
    });

    await expect(reviewModeration("https://cdn.example/video.mp4")).rejects.toMatchObject({
      name: "ApiRequestError",
      code: "REVIEW_FAILED",
      message: "video download failed",
    });
  });

  it("aborts while waiting between polls", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    vi.mocked(api.post)
      .mockResolvedValueOnce({ taskId: "task-1" })
      .mockResolvedValueOnce({ status: "Processing" });

    const pending = reviewModeration("https://cdn.example/video.mp4", controller.signal);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(api.post).toHaveBeenCalledTimes(2);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
