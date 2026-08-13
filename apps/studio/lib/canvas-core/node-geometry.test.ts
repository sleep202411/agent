import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import { canvasNodeGeometry, canvasNodeLayoutSize } from "./node-geometry";

describe("canvas node geometry", () => {
  it("uses one optical scale without flattening every node to one width", () => {
    expect(canvasNodeGeometry(node("note")).width).toBe(280);
    expect(canvasNodeGeometry(node("image")).width).toBe(320);
    expect(canvasNodeGeometry(node("prompt")).width).toBe(360);
  });

  it("keeps story node proportions semantic", () => {
    expect(canvasNodeGeometry(node("storyCanvas", { kind: "character" })).width).toBe(280);
    expect(canvasNodeGeometry(node("storyCanvas", { kind: "clip" })).width).toBe(320);
    expect(
      canvasNodeGeometry(node("storyCanvas", { kind: "decision", choices: [{}, {}, {}] }))
    ).toMatchObject({ width: 360, estimatedHeight: 386 });
  });

  it("uses live measurements only while available in the current client", () => {
    const measured = {
      ...node("note"),
      measured: { width: 286, height: 212 },
    } satisfies Node;

    expect(canvasNodeLayoutSize(measured)).toEqual({ width: 286, height: 212 });
    expect(canvasNodeLayoutSize(node("note"))).toEqual({ width: 280, height: 188 });
  });
});

function node(type: string, data: Record<string, unknown> = {}): Node {
  return { id: type, type, position: { x: 0, y: 0 }, data };
}
