import { SpanType, type AnyExportedSpan } from "@mastra/core/observability";
import { describe, expect, it } from "vitest";

import { privacyPreservingSpanFormatter } from "./privacy.js";

describe("privacyPreservingSpanFormatter", () => {
  it("removes model and tool content before OTLP export", async () => {
    const span = {
      id: "span-1",
      traceId: "0123456789abcdef0123456789abcdef",
      name: "agent",
      type: SpanType.AGENT_RUN,
      startTime: new Date(),
      isRootSpan: true,
      isEvent: false,
      input: [{ role: "user", content: "private prompt" }],
      output: "private answer",
      attributes: {
        instructions: "private system prompt",
        availableTools: ["story_apply_change_set"],
      },
      errorInfo: {
        id: "PROVIDER_FAILURE",
        message: "provider echoed private prompt",
        stack: "private stack",
      },
    } as AnyExportedSpan;

    const result = await privacyPreservingSpanFormatter(span);

    expect(result.input).toBeUndefined();
    expect(result.output).toBeUndefined();
    expect(result.attributes).not.toHaveProperty("instructions");
    expect(result.attributes).toHaveProperty("availableTools");
    expect(result.errorInfo).toEqual({
      id: "PROVIDER_FAILURE",
      message: "Operation failed with PROVIDER_FAILURE.",
    });
  });
});
