import Ably from "ably";
import { describe, expect, it } from "vitest";

import {
  ABLY_ENCODER_RECOVERY_FAILURE_TYPE,
  ABLY_MUTABLE_MESSAGES_FAILURE_TYPE,
  classifyAgentTransportFailure,
} from "./ably-runtime-error.js";

describe("classifyAgentTransportFailure", () => {
  it("finds the mutable-messages rejection through the AI Transport wrapper", () => {
    const cause = new Ably.ErrorInfo(
      "Can only update/delete/append messages on channels with mutableMessages enabled",
      93_002,
      400
    );
    const wrapped = new Ably.ErrorInfo(
      "unable to flush pending appends; recovery failed",
      104_000,
      500,
      cause
    );

    expect(
      classifyAgentTransportFailure(
        wrapped,
        "agent:v1:conversation:0197f4a2-0800-7000-8000-000000000004"
      )
    ).toEqual({
      type: ABLY_MUTABLE_MESSAGES_FAILURE_TYPE,
      message:
        'StoryOS realtime streaming is not configured for the Ably "agent" channel namespace. ' +
        "Enable “Message annotations, updates, deletes, and appends” (mutableMessages) for that " +
        "namespace (Ably 93002).",
      retryable: false,
      details: {
        ablyCode: 93_002,
        channelNamespace: "agent",
      },
    });
  });

  it("does not rewrite transient or unrelated Ably failures", () => {
    const error = new Ably.ErrorInfo("connection unavailable", 80_003, 500);

    expect(classifyAgentTransportFailure(error, "agent:v1:conversation:test")).toBeNull();
    expect(classifyAgentTransportFailure(new Error("provider failed"), "agent:test")).toBeNull();
  });

  it("recognizes a structurally compatible error from another Ably module instance", () => {
    const crossPackageWrapper = {
      code: 104_000,
      cause: {
        code: 93_002,
        statusCode: 400,
      },
    };

    expect(classifyAgentTransportFailure(crossPackageWrapper, "agent:v1:test")).toMatchObject({
      type: ABLY_MUTABLE_MESSAGES_FAILURE_TYPE,
      retryable: false,
      details: {
        ablyCode: 93_002,
        channelNamespace: "agent",
      },
    });
  });

  it("terminalizes an encoder recovery failure even when the SDK drops its cause", () => {
    const causeWasLostByTheSdk = {
      code: 104_000,
      message: "unable to flush pending appends; recovery failed for stream(s): generated-id",
    };

    expect(
      classifyAgentTransportFailure(causeWasLostByTheSdk, "agent:v1:conversation:test")
    ).toEqual({
      type: ABLY_ENCODER_RECOVERY_FAILURE_TYPE,
      message:
        "StoryOS could not commit its realtime output because Ably failed both the streaming " +
        'append and its recovery update on the "agent" channel namespace. The response was not ' +
        "published. Verify that mutableMessages is enabled and that Ably is available before " +
        "resending (Ably AI Transport 104000).",
      retryable: false,
      details: {
        ablyCode: 104_000,
        channelNamespace: "agent",
      },
    });
  });

  it("recognizes the plain Error left by the Vercel stream bridge", () => {
    const strippedError = new Error(
      "unable to flush pending appends; recovery failed for stream(s): generated-id"
    );

    expect(
      classifyAgentTransportFailure(strippedError, "agent:v1:conversation:test")
    ).toMatchObject({
      type: ABLY_ENCODER_RECOVERY_FAILURE_TYPE,
      retryable: false,
      details: {
        ablyCode: 104_000,
        channelNamespace: "agent",
      },
    });
  });
});
