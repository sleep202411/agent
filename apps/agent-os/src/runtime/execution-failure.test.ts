import { describe, expect, it } from "vitest";

import { classifyTerminalExecutionFailure } from "./execution-failure.js";
import { InvalidToolResponseError } from "@repo/model-router";

describe("classifyTerminalExecutionFailure", () => {
  it("terminalizes an exhausted tool protocol retry even through an error cause", () => {
    expect(
      classifyTerminalExecutionFailure(
        new Error("Invocation failed", {
          cause: new InvalidToolResponseError(),
        })
      )
    ).toMatchObject({ code: "MODEL_TOOL_CALL_INVALID", retryable: false });
  });
  it("stops deterministic provider content rejections without exposing diagnostics", () => {
    const error = Object.assign(
      new Error("400 Input text data may contain inappropriate content."),
      {
        status: 400,
        code: "data_inspection_failed",
      }
    );

    expect(classifyTerminalExecutionFailure(error)).toEqual({
      code: "MODEL_CONTENT_REJECTED",
      message:
        "The selected model could not process this content. Revise the content or choose another model, then try again.",
      retryable: false,
    });
  });

  it("finds provider diagnostics nested in an error cause", () => {
    const error = new Error("Model invocation failed", {
      cause: {
        statusCode: 400,
        error: {
          code: "content_filter",
          message: "provider-only detail",
        },
      },
    });

    expect(classifyTerminalExecutionFailure(error)?.code).toBe("MODEL_CONTENT_REJECTED");
  });

  it("stops other permanent request errors", () => {
    expect(
      classifyTerminalExecutionFailure(Object.assign(new Error("bad request"), { status: 422 }))
    ).toMatchObject({ code: "REQUEST_REJECTED", retryable: false });
  });

  it.each([
    Object.assign(new Error("rate limited"), { status: 429 }),
    Object.assign(new Error("provider unavailable"), { status: 503 }),
    Object.assign(new Error("request timed out"), { status: 408 }),
    new Error("connection reset"),
  ])("keeps ambiguous failures recoverable", (error) => {
    expect(classifyTerminalExecutionFailure(error)).toBeNull();
  });

  it("stops an output-limit response", () => {
    expect(
      classifyTerminalExecutionFailure(
        new Error("The model response exceeded its output limit before completion.")
      )
    ).toMatchObject({ code: "MODEL_OUTPUT_LIMIT", retryable: false });
  });
});
