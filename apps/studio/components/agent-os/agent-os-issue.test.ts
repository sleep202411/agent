import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";
import { toAgentOsIssue } from "./agent-os-issue";

describe("toAgentOsIssue", () => {
  it("replaces a bare server status while preserving it for diagnostics", () => {
    expect(
      toAgentOsIssue(
        new ApiRequestError("HTTP_500", "HTTP 500", 500),
        "Upload failed",
        "Service unavailable"
      )
    ).toEqual({
      message: "Service unavailable",
      technicalDetail: "HTTP 500",
    });
  });

  it("keeps an actionable backend message verbatim", () => {
    expect(
      toAgentOsIssue(
        new ApiRequestError("FILE_TOO_LARGE", "The file exceeds 20 MB", 413),
        "Upload failed",
        "Service unavailable"
      )
    ).toEqual({ message: "The file exceeds 20 MB" });
  });

  it("uses the localized operation fallback for an unknown failure", () => {
    expect(toAgentOsIssue(null, "Upload failed", "Service unavailable")).toEqual({
      message: "Upload failed",
    });
  });
});
