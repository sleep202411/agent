import { describe, expect, it } from "vitest";
import { ApiRequestError } from "@/lib/api";
import {
  shouldRetryStoryProjectAccess,
  storyProjectAccessFailure,
} from "./story-project-access-error";

describe("storyProjectAccessFailure", () => {
  it.each([
    [401, "authentication"],
    [403, "forbidden"],
    [404, "unavailable"],
  ] as const)("classifies HTTP %s as an expected %s state", (status, expected) => {
    expect(storyProjectAccessFailure(new ApiRequestError(`HTTP_${status}`, "failed", status))).toBe(
      expected
    );
  });

  it("recognizes the masked project-not-found application code", () => {
    expect(
      storyProjectAccessFailure(
        new ApiRequestError("STORY_PROJECT_NOT_FOUND", "Story project not found.", 200)
      )
    ).toBe("unavailable");
  });

  it("survives error-boundary serialization that strips the custom prototype", () => {
    expect(storyProjectAccessFailure({ status: 404, code: "STORY_PROJECT_NOT_FOUND" })).toBe(
      "unavailable"
    );
  });

  it("leaves unexpected failures for the route error boundary", () => {
    expect(storyProjectAccessFailure(new Error("render failed"))).toBeNull();
    expect(storyProjectAccessFailure(new ApiRequestError("HTTP_500", "failed", 500))).toBeNull();
  });
});

describe("shouldRetryStoryProjectAccess", () => {
  it.each([401, 403, 404])("does not retry expected HTTP %s access failures", (status) => {
    expect(
      shouldRetryStoryProjectAccess(0, new ApiRequestError(`HTTP_${status}`, "failed", status))
    ).toBe(false);
  });

  it.each([0, 500, 503])("retries transient status %s at most twice", (status) => {
    const error = new ApiRequestError("TRANSIENT", "failed", status);
    expect(shouldRetryStoryProjectAccess(0, error)).toBe(true);
    expect(shouldRetryStoryProjectAccess(1, error)).toBe(true);
    expect(shouldRetryStoryProjectAccess(2, error)).toBe(false);
  });
});
