import { describe, expect, it } from "vitest";
import type { StoryGraphNode } from "@/lib/story-projects-api";
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

function clip(nodeId: string, clipKey: string, name?: string): StoryGraphNode {
  return {
    kind: "clip",
    nodeId,
    clipKey,
    ...(name ? { name } : {}),
    interactions: [],
    exit: { kind: "auto", routes: [] },
  };
}

function decision(nodeId: string): StoryGraphNode {
  return {
    kind: "decision",
    nodeId,
    exit: { kind: "choice", decisionId: nodeId, prompt: {}, choices: [] },
  };
}
