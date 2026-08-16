import { describe, expect, it } from "vitest";
import {
  offsetStoryNodeDockCreationPosition,
  resolveStoryNodeCreationMenuPlacement,
  type StoryNodeCreationKind,
} from "./story-node-creator-model";

describe("story node creator model", () => {
  it("exposes only film clips and cast members", () => {
    const kinds = ["clip"] satisfies StoryNodeCreationKind[];
    expect(kinds).toEqual(["clip"]);
  });

  it("keeps the chosen flow point while clamping the menu", () => {
    expect(
      resolveStoryNodeCreationMenuPlacement({
        clientPosition: { x: 990, y: 790 },
        container: { left: 100, top: 100, width: 900, height: 700 },
        flowPosition: { x: 42, y: 84 },
      })
    ).toMatchObject({ flowPosition: { x: 42, y: 84 } });
  });

  it("nudges dock-created nodes deterministically", () => {
    expect(offsetStoryNodeDockCreationPosition({ x: 10, y: 20 }, 2)).toEqual({ x: 62, y: 72 });
  });
});
