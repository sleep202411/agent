import { describe, expect, it } from "vitest";
import {
  classifyReviewSource,
  findingsNearTime,
  formatReviewTimecode,
  groupReviewFindings,
  parseReviewTimeOffset,
  reviewFindingsFromComments,
  reviewFindingsFromDetails,
} from "./content-review-findings";

describe("parseReviewTimeOffset", () => {
  it("reads clock strings", () => {
    expect(parseReviewTimeOffset("00:04:21")).toBe(261);
    expect(parseReviewTimeOffset("04:21")).toBe(261);
    expect(parseReviewTimeOffset("1:02:03.5")).toBe(3723.5);
  });

  it("reads seconds, milliseconds, and unit suffixes", () => {
    expect(parseReviewTimeOffset(12.5)).toBe(12.5);
    expect(parseReviewTimeOffset("12.5")).toBe(12.5);
    expect(parseReviewTimeOffset("15000")).toBe(15);
    expect(parseReviewTimeOffset("320ms")).toBe(0.32);
    expect(parseReviewTimeOffset("8s")).toBe(8);
  });

  it("rejects empty and impossible values", () => {
    expect(parseReviewTimeOffset(null)).toBeNull();
    expect(parseReviewTimeOffset("")).toBeNull();
    expect(parseReviewTimeOffset(-1)).toBeNull();
    expect(parseReviewTimeOffset("nope")).toBeNull();
  });
});

describe("formatReviewTimecode", () => {
  it("formats below and above one hour", () => {
    expect(formatReviewTimecode(261)).toBe("04:21");
    expect(formatReviewTimecode(3723)).toBe("01:02:03");
  });
});

describe("reviewFindingsFromDetails", () => {
  it("drops empty rows, classifies source, and sorts by time", () => {
    const findings = reviewFindingsFromDetails([
      { source: "audio", timeOffset: "00:08:11", label: "abuse", description: "later" },
      { source: "frame", timeOffset: "00:04:21", label: "violence", description: "earlier" },
      { source: "unknown" },
      { timeOffset: "1s", audioText: "hello" },
    ]);
    expect(findings.map((finding) => finding.seconds)).toEqual([1, 261, 491]);
    expect(findings[1]?.source).toBe("frame");
    expect(findings[2]?.source).toBe("audio");
    expect(classifyReviewSource("ASR")).toBe("audio");
  });

  it("selects findings near the playhead", () => {
    const findings = reviewFindingsFromDetails([
      { timeOffset: "10s", label: "a", description: "a" },
      { timeOffset: "12s", label: "b", description: "b" },
    ]);
    expect(findingsNearTime(findings, 10.2).map((finding) => finding.label)).toEqual(["a"]);
  });

  it("turns workspace comments into timeline findings", () => {
    expect(
      reviewFindingsFromComments([
        { id: "c1", seconds: 8, body: "cut here", createdByUserId: "1" },
        { id: "c2", seconds: -1, body: "nope", createdByUserId: "1" },
      ]).map((finding) => finding.source)
    ).toEqual(["comment"]);
  });
});

describe("groupReviewFindings", () => {
  it("keeps same-second comments together and separate from detections", () => {
    const groups = groupReviewFindings([
      {
        id: "f1",
        seconds: 4,
        source: "frame",
        label: "violent_bloody",
        description: "血腥",
        confidence: null,
        frameUrl: "https://example/a.jpg",
        audioText: null,
        createdByUserId: null,
      },
      {
        id: "c1",
        seconds: 4.2,
        source: "comment",
        label: "",
        description: "不错",
        confidence: null,
        frameUrl: null,
        audioText: null,
        createdByUserId: "1",
      },
      {
        id: "c2",
        seconds: 4.8,
        source: "comment",
        label: "",
        description: "你好",
        confidence: null,
        frameUrl: null,
        audioText: null,
        createdByUserId: "1",
      },
      {
        id: "c3",
        seconds: 2,
        source: "comment",
        label: "",
        description: "删除",
        confidence: null,
        frameUrl: null,
        audioText: null,
        createdByUserId: "1",
      },
    ]);
    expect(groups.map((group) => group.key)).toEqual(["4", "2"]);
    expect(groups[0]?.detections.map((item) => item.id)).toEqual(["f1"]);
    expect(groups[0]?.comments.map((item) => item.id)).toEqual(["c1", "c2"]);
    expect(groups[1]?.comments.map((item) => item.id)).toEqual(["c3"]);
  });
});
