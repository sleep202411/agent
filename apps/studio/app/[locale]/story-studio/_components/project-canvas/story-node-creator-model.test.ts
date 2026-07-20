import { describe, expect, it } from "vitest";
import {
  offsetStoryNodeDockCreationPosition,
  resolveStoryNodeCreationMenuPlacement,
} from "./story-node-creator-model";

describe("resolveStoryNodeCreationMenuPlacement", () => {
  const container = { left: 380, top: 64, width: 740, height: 912 };

  it("uses canvas-local menu coordinates while preserving the selected flow point", () => {
    expect(
      resolveStoryNodeCreationMenuPlacement({
        clientPosition: { x: 700, y: 400 },
        container,
        flowPosition: { x: 1234, y: -480 },
      })
    ).toEqual({
      left: 320,
      top: 336,
      flowPosition: { x: 1234, y: -480 },
    });
  });

  it("keeps the menu inside every canvas edge without moving the node anchor", () => {
    expect(
      resolveStoryNodeCreationMenuPlacement({
        clientPosition: { x: 200, y: 20 },
        container,
        flowPosition: { x: -200, y: -100 },
      })
    ).toEqual({ left: 12, top: 12, flowPosition: { x: -200, y: -100 } });

    expect(
      resolveStoryNodeCreationMenuPlacement({
        clientPosition: { x: 1_300, y: 1_100 },
        container,
        flowPosition: { x: 900, y: 800 },
      })
    ).toEqual({ left: 418, top: 550, flowPosition: { x: 900, y: 800 } });
  });
});

describe("offsetStoryNodeDockCreationPosition", () => {
  it("nudges repeated center adds and starts a new cycle after six nodes", () => {
    const center = { x: 100, y: 200 };

    expect(offsetStoryNodeDockCreationPosition(center, 0)).toEqual(center);
    expect(offsetStoryNodeDockCreationPosition(center, 1)).toEqual({ x: 126, y: 226 });
    expect(offsetStoryNodeDockCreationPosition(center, 5)).toEqual({ x: 230, y: 330 });
    expect(offsetStoryNodeDockCreationPosition(center, 6)).toEqual(center);
  });
});
