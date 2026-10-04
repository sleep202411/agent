import { describe, expect, it } from "vitest";
import {
  storyPublicationActionErrorKind,
  storyPublicationActionDetail,
  storyPublicationDiagnostics,
  storyPublicationErrorKind,
} from "./story-publication-errors";

describe("publication error classification", () => {
  it("preserves validation and snapshot conflict repair instructions", () => {
    expect(
      storyPublicationActionErrorKind({ status: 422, code: "STORY_BUILD_NOT_PUBLISHABLE" })
    ).toBeNull();
    expect(
      storyPublicationActionErrorKind({ status: 409, code: "STORY_PUBLICATION_CANDIDATE_MISMATCH" })
    ).toBeNull();
    expect(storyPublicationActionErrorKind({ status: 403, code: "STORY_PERMISSION_DENIED" })).toBe(
      "permission"
    );
  });
  it.each([
    [{ status: 401 }, "auth"],
    [{ status: 401, code: "STORY_PUBLICATION_SESSION_EXPIRED" }, "auth"],
    [{ status: 401, code: "STORY_PUBLICATION_SESSION_REQUIRED" }, "auth"],
    [{ status: 403, code: "STORY_PERMISSION_DENIED" }, "permission"],
    [{ status: 404, code: "STORY_PROJECT_NOT_FOUND" }, "permission"],
    [
      { status: 502, code: "STORY_PUBLICATION_UPSTREAM_FAILED", upstreamHttpStatus: 403 },
      "service",
    ],
    [{ status: 503, code: "STORY_PUBLICATION_SERVICE_UNAVAILABLE" }, "service"],
    [new Error("Network connection failed"), "service"],
  ])("classifies %j as %s", (error, kind) => {
    expect(storyPublicationErrorKind(error)).toBe(kind);
  });
});

describe("release diagnostics", () => {
  const chapterId = "11111111-1111-4111-8111-111111111111";
  it("preserves all diagnostics and the server's chapter rather than assuming the open chapter", () => {
    const error = Object.assign(new Error("First problem"), {
      responseBody: JSON.stringify({
        chapterId,
        diagnostics: [
          { message: "First problem", nodeId: "clip:one" },
          { message: " Second problem ", nodeId: "decision:two" },
        ],
      }),
    });
    expect(storyPublicationDiagnostics(error)).toEqual({
      chapterId,
      issues: [
        { message: "First problem", nodeId: "clip:one" },
        { message: "Second problem", nodeId: "decision:two" },
      ],
    });
    expect(storyPublicationActionDetail(error, "Fallback")).toBe("First problem\n\nSecond problem");
  });
  it.each([undefined, null, "not JSON", "null", "[]", "1"])(
    "keeps the backend message when diagnostic data is malformed: %s",
    (responseBody) => {
      const error = Object.assign(new Error("Backend detail"), { responseBody });
      expect(storyPublicationActionDetail(error, "Fallback")).toBe("Backend detail");
      expect(storyPublicationDiagnostics(error)).toEqual({ chapterId: null, issues: [] });
    }
  );
  it("keeps valid messages without inventing navigation for missing or invalid targets", () => {
    const error = {
      responseBody: JSON.stringify({
        chapterId: "other",
        diagnostics: [
          null,
          [],
          7,
          { message: " " },
          { message: 12 },
          { message: "Repair this", nodeId: 42 },
          { message: "Another repair", nodeId: "not-a-node" },
        ],
      }),
    };
    expect(storyPublicationDiagnostics(error)).toEqual({
      chapterId: null,
      issues: [
        { message: "Repair this", nodeId: null },
        { message: "Another repair", nodeId: null },
      ],
    });
    expect(storyPublicationActionDetail(error, "Fallback")).toBe(
      "Fallback\n\nRepair this\n\nAnother repair"
    );
  });
});
