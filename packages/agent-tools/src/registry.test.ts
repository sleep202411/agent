import { describe, expect, it } from "vitest";

import { buildToolIdempotencyKey } from "./idempotency.js";
import { getTool, parseToolInput, riskForTool, toolDescriptorsForModel } from "./registry.js";

describe("agent-tools registry", () => {
  it("registers golden-path tools", () => {
    expect(getTool("script.readSection").kind).toBe("query");
    expect(getTool("characters.upsert").kind).toBe("command");
    expect(riskForTool("characters.upsert")).toBe("sensitive");
    expect(riskForTool("storyboard.upsertShots")).toBe("sensitive");
    expect(riskForTool("storyboard.deleteShots")).toBe("sensitive");
    expect(toolDescriptorsForModel().some((t) => t.id === "storyboard.listShots")).toBe(true);
    expect(toolDescriptorsForModel().some((t) => t.id === "storyboard.deleteShots")).toBe(true);
    expect(toolDescriptorsForModel().some((t) => t.id === "canvas.applyPatch")).toBe(true);
  });

  it("requires attachmentId for script.readSection", () => {
    expect(() =>
      parseToolInput("script.readSection", {
        sectionIndex: 0,
        maxChars: 1000,
      })
    ).toThrow();
    const parsed = parseToolInput("script.readSection", {
      attachmentId: "00000000-0000-4000-8000-000000000001",
      sectionIndex: 0,
      maxChars: 1000,
    });
    expect(parsed).toMatchObject({ sectionIndex: 0 });
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

  it("validates semantic Story interaction input", () => {
    const parsed = parseToolInput("story.putInteraction", {
      baseDraftRevision: 4,
      nodeId: "scene.opening",
      interaction: {
        kind: "hotspot",
        interactionId: "interaction.dodge",
        label: { "zh-CN": "向右闪避" },
        trigger: { kind: "swipe", direction: "right" },
        rect: { x: 0.2, y: 0.25, width: 0.4, height: 0.5 },
        startMs: 800,
        endMs: 1_600,
        outcomes: {
          success: { kind: "continue" },
          failure: { kind: "goto", nodeId: "ending.caught" },
          timeout: { kind: "goto", nodeId: "ending.caught" },
        },
      },
    });
    expect(parsed).toMatchObject({
      nodeId: "scene.opening",
      interaction: {
        interactionId: "interaction.dodge",
        trigger: { kind: "swipe", direction: "right" },
      },
    });
    expect(() =>
      parseToolInput("story.putInteraction", {
        baseDraftRevision: 4,
        nodeId: "scene.opening",
        interaction: {
          kind: "hotspot",
          interactionId: "interaction.dodge",
          label: {},
          trigger: { kind: "press-hold", durationMs: 100 },
          rect: { x: 0.2, y: 0.25, width: 0.4, height: 0.5 },
          startMs: 800,
          endMs: 1_600,
          outcomes: { success: { kind: "continue" } },
        },
      })
    ).toThrow();
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

  it("mints valid operationId when canvas.applyPatch gets a fake UUID", () => {
    const parsed = parseToolInput("canvas.applyPatch", {
      baseDraftRevision: 1,
      baseLayoutRevision: 1,
      operations: [
        {
          operationId: "not-a-real-uuid",
          kind: "shot.upsert",
          payload: {
            id: "shot-04",
            title: "随笔爱你吧",
            prompt: "soft light",
          },
        },
      ],
    }) as {
      operations: Array<{ operationId: string }>;
    };
    expect(parsed.operations[0]?.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});
