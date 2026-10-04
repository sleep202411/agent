import { describe, expect, it } from "vitest";
import {
  storyPublicationActionErrorKind,
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
