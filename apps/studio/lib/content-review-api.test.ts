import { describe, expect, it } from "vitest";
import {
  isVideoFileAllowed,
  MAX_REVIEW_VIDEO_BYTES,
  creditsForDurationSeconds,
  resultFromReviewRecord,
} from "./content-review-api";

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
