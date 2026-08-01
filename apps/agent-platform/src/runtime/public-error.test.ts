import { ActivityFailure, ApplicationFailure, RetryState } from "@temporalio/common";
import { describe, expect, it } from "vitest";

import {
  createAgentPublicError,
  findEmbeddedPublicError,
  findInternalErrorCode,
  retryabilityFrom,
} from "./public-error.js";

const diagnosticId = "019fb3c6-2f59-75da-9455-f40a23b8d719";

describe("Agent public error boundary", () => {
  it("never exposes an unknown provider message, URL, secret, or stack", () => {
    const raw = new Error(
      "provider rejected https://private.example/token?key=secret-root-key\n" +
        "at internal (/srv/private/provider.ts:42:1)"
    );

    const result = createAgentPublicError({
      error: raw,
      fallbackCode: "AGENT_INFERENCE_STEP_FAILED",
      diagnosticId,
    });

    expect(result).toEqual({
      code: "AGENT_INFERENCE_STEP_FAILED",
      retryable: true,
      messageKey: "agent.error.response_failed",
      message: "StoryOS could not generate a response. Please retry.",
      diagnosticId,
    });
    expect(JSON.stringify(result)).not.toContain("private.example");
    expect(JSON.stringify(result)).not.toContain("secret-root-key");
    expect(JSON.stringify(result)).not.toContain("/srv/private");
  });

  it("maps transport configuration failures to stable product copy", () => {
    const result = createAgentPublicError({
      code: "AGENT_ABLY_MUTABLE_MESSAGES_REQUIRED",
      retryable: false,
      fallbackCode: "AGENT_INFERENCE_STEP_FAILED",
      diagnosticId,
    });

    expect(result).toMatchObject({
      code: "AGENT_ABLY_MUTABLE_MESSAGES_REQUIRED",
      retryable: false,
      messageKey: "agent.error.realtime_unavailable",
    });
    expect(result.message).not.toContain("mutableMessages");
    expect(result.message).not.toContain("namespace");
  });

  it("distinguishes an empty model turn from a provider failure without relying on the throw site", () => {
    // An empty turn keeps its own code and message instead of falling back to
    // the generic provider failure, so a creator can tell "the model wrote
    // nothing" from "the provider broke". That identity comes from the policy
    // row and holds however the failure was thrown.
    const result = createAgentPublicError({
      error: ApplicationFailure.nonRetryable(
        "The model step ended without producing any assistant output.",
        "AGENT_INFERENCE_OUTPUT_MISSING"
      ),
      fallbackCode: "AGENT_INFERENCE_STEP_FAILED",
      diagnosticId,
    });

    expect(result).toMatchObject({ code: "AGENT_INFERENCE_OUTPUT_MISSING" });
    expect(result.messageKey).not.toBe("agent.error.response_failed");
    // ⚠️ Retryability does NOT come from the policy when the throw site states
    // it: an explicit nonRetryable outranks the row. Pinned because it is a
    // real hazard — the row says an empty turn is worth retrying, and only the
    // throw site in activities.ts keeps that promise. Change that throw and
    // published retryability flips with nothing in this file moving.
    expect(result.retryable).toBe(false);
    // With no failure to read, the row alone decides, and it says retry.
    expect(
      createAgentPublicError({
        code: "AGENT_INFERENCE_OUTPUT_MISSING",
        fallbackCode: "AGENT_INFERENCE_STEP_FAILED",
        diagnosticId,
      }).retryable
    ).toBe(true);
  });

  it("reads the originating type and retryability through an Activity failure wrapper", () => {
    const wrapped = new ActivityFailure(
      "Activity task failed",
      "claimLongDocumentAnalysisActivity",
      "1",
      RetryState.NON_RETRYABLE_FAILURE,
      "worker-1",
      ApplicationFailure.nonRetryable(
        "private provider response",
        "AGENT_DOCUMENT_ANALYSIS_INDEX_INVALID"
      )
    );

    // The wrapper carries neither a type nor a retryability of its own, so
    // reading it directly would report every permanent failure as retryable.
    expect(findInternalErrorCode(wrapped)).toBe("AGENT_DOCUMENT_ANALYSIS_INDEX_INVALID");
    expect(retryabilityFrom(wrapped)).toBe(false);
  });

  it("recovers the same sanitized error from a nested Temporal failure", () => {
    const publicError = createAgentPublicError({
      fallbackCode: "AGENT_TOOL_STEP_FAILED",
      diagnosticId,
    });
    const nested = {
      cause: {
        details: [{ publicError }],
      },
    };

    expect(findEmbeddedPublicError(nested)).toEqual(publicError);
    expect(
      createAgentPublicError({
        error: nested,
        fallbackCode: "AGENT_RUNTIME_FAILED",
        diagnosticId: "019fb3c6-2f59-75da-9455-f40a23b8d720",
      })
    ).toEqual(publicError);
  });
});
