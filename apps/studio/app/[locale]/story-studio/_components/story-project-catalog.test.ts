import { describe, expect, it } from "vitest";
import type { InteractiveStoryDraftContent, StoryGraphNode } from "@/lib/story-projects-api";
import { catalogStatus } from "./story-project-catalog-status";
import { catalogNodeTitles } from "./story-project-catalog-titles";

describe("catalogNodeTitles", () => {
  it("shows the canvas clip title instead of an automatic SCENE key", () => {
    const titles = catalogNodeTitles(
      [
        clip("clip:1", "SCENE_1"),
        decision("decision:1"),
        clip("clip:3", "SCENE_3", "明城墙"),
        clip("clip:4", "SCENE_4", "SCENE_4"),
      ],
      "镜头",
      "选择"
    );

    expect(titles.get("clip:1")).toBe("镜头 1");
    expect(titles.get("decision:1")).toBe("选择");
    expect(titles.get("clip:3")).toBe("明城墙");
    expect(titles.get("clip:4")).toBe("镜头 3");
  });
});

describe("catalogStatus", () => {
  it("marks an unused ending as unlinked and an unused variable as redundant", () => {
    const content = {
      storyBible: {
        logline: "",
        synopsis: "",
        characters: [],
        endings: [{ endingId: "ending:1", kind: "neutral", title: { "zh-CN": "未命名结局" } }],
        stateVariables: [
          { key: "favor", name: { "zh-CN": "好感" }, valueType: "number", initialValue: 0 },
        ],
      },
      graph: {
        entryNodeId: "clip:start",
        nodes: [
          clip("clip:start", "SCENE_1", {
            kind: "auto",
            routes: [{ target: { kind: "node", nodeId: "clip:next" } }],
          }),
          clip("clip:next", "SCENE_2", { kind: "auto", routes: [{ target: null }] }),
          clip("clip:orphan", "SCENE_3", { kind: "auto", routes: [{ target: null }] }),
        ],
      },
      productionNotes: [],
    } as InteractiveStoryDraftContent;

    const status = catalogStatus(content, "clip:start");
    expect(status.redundantVariables.map((variable) => variable.key)).toEqual(["favor"]);
    expect(status.nodeMarks.get("clip:orphan")).toBe("unlinked");
    expect(status.nodeMarks.has("clip:start")).toBe(false);
    expect(status.nodeMarks.has("clip:next")).toBe(false);
  });
});

function clip(
  nodeId: string,
  clipKey: string,
  nameOrExit?: string | StoryGraphNode["exit"]
): StoryGraphNode {
  const name = typeof nameOrExit === "string" ? nameOrExit : undefined;
  const exit = typeof nameOrExit === "object" ? nameOrExit : { kind: "auto" as const, routes: [] };
  return {
    kind: "clip",
    nodeId,
    clipKey,
    ...(name ? { name } : {}),
    interactions: [],
    exit,
  };
}

function decision(nodeId: string): StoryGraphNode {
  return {
    kind: "decision",
    nodeId,
    exit: { kind: "choice", decisionId: nodeId, prompt: {}, choices: [] },
  };
}
