import { describe, expect, it } from "vitest";

import { buildToolIdempotencyKey } from "./idempotency.js";
import { getTool, parseToolInput, riskForTool, toolDescriptorsForModel } from "./registry.js";

describe("agent-tools registry", () => {
  it("registers golden-path tools", () => {
    expect(getTool("script.readSection").kind).toBe("query");
    expect(getTool("characters.upsert").kind).toBe("command");
    expect(riskForTool("characters.upsert")).toBe("sensitive");
    expect(toolDescriptorsForModel().some((t) => t.id === "canvas.applyPatch")).toBe(true);
  });

  it("validates characters.upsert input", () => {
    const parsed = parseToolInput("characters.upsert", {
      baseRevision: 0,
      characters: [
        {
          id: "lin-daiyu",
          name: { "zh-CN": "林黛玉" },
          summary: "贾母外孙女，体弱多病。",
          intent: "create",
        },
      ],
    });
    expect(parsed).toMatchObject({ baseRevision: 0 });
  });

  it("builds stable idempotency keys", () => {
    expect(
      buildToolIdempotencyKey({
        projectId: "p1",
        runId: "r1",
        toolCallId: "c1",
      })
    ).toBe("p1:r1:c1:v1");
  });
});
