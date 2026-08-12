import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { computeCanvasTidyLayout, resolveCanvasTidyTargets } from "./canvas-tidy-layout";

describe("resolveCanvasTidyTargets", () => {
  it("tidies the whole canvas when selection scoping is off", () => {
    const nodes = [selected(node("a", 280, 200)), node("b", 280, 200)];
    const edges = [edge("a", "b")];

    const target = resolveCanvasTidyTargets(nodes, edges);

    expect(target.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(target.edges.map((e) => e.id)).toEqual(["a-b"]);
  });

  it("keeps a lone selected node from shrinking the pass to itself", () => {
    const nodes = [selected(node("a", 280, 200)), node("b", 280, 200)];

    expect(resolveCanvasTidyTargets(nodes, [], true).nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("scopes to a multi-node selection and drops edges leaving it", () => {
    const nodes = [
      selected(node("a", 280, 200)),
      selected(node("b", 280, 200)),
      node("outside", 280, 200),
    ];
    const edges = [edge("a", "b"), edge("b", "outside")];

    const target = resolveCanvasTidyTargets(nodes, edges, true);

    expect(target.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(target.edges.map((e) => e.id)).toEqual(["a-b"]);
  });
});

describe("computeCanvasTidyLayout", () => {
  it("places dependencies left-to-right and stacks siblings by measured height", () => {
    const nodes = [
      node("source", 320, 180),
      node("image", 280, 240),
      node("video", 420, 300),
      node("sibling", 260, 100),
    ];
    const edges = [edge("source", "image"), edge("image", "video"), edge("source", "sibling")];

    // Every column is centred on y = 0: -90+180/2, -194+388/2, -150+300/2.
    expect(computeCanvasTidyLayout(nodes, edges)).toEqual([
      { id: "source", position: { x: 0, y: -90 } },
      { id: "image", position: { x: 400, y: -194 } },
      { id: "sibling", position: { x: 400, y: 94 } },
      { id: "video", position: { x: 760, y: -150 } },
    ]);
  });

  it("ignores orphaned edges instead of creating phantom columns", () => {
    expect(
      computeCanvasTidyLayout(
        [node("one", 280, 200), node("two", 280, 200)],
        [edge("missing", "two")]
      )
    ).toEqual([
      { id: "one", position: { x: 0, y: -224 } },
      { id: "two", position: { x: 0, y: 24 } },
    ]);
  });

  /**
   * Regression: unmeasured nodes all fell back to one height, so a tall card —
   * a three-option decision is nearly twice a clip — landed under the card above
   * it. The default layout runs before React Flow measures anything, which is
   * exactly when this happens.
   */
  it("stacks unmeasured nodes by the caller's estimate instead of one flat height", () => {
    const nodes = [unmeasured("tall"), unmeasured("short")];

    const flat = computeCanvasTidyLayout(nodes, []);
    const estimated = computeCanvasTidyLayout(nodes, [], (n) => (n.id === "tall" ? 400 : 120));

    // Without a caller estimate, the shared node geometry still reserves a
    // deterministic per-type height rather than one arbitrary global box.
    expect(flat[1]!.position.y - flat[0]!.position.y).toBe(288);
    // With one, the short card clears the tall card's full height.
    expect(estimated[1]!.position.y - estimated[0]!.position.y).toBe(448);
  });

  it("centres every column on one shared axis", () => {
    const nodes = [node("head", 280, 200), node("a", 280, 200), node("b", 280, 200)];
    const positions = computeCanvasTidyLayout(nodes, [edge("head", "a"), edge("head", "b")]);
    const mid = (id: string, height: number) =>
      positions.find((p) => p.id === id)!.position.y + height / 2;

    expect(mid("head", 200)).toBe(0);
    expect((mid("a", 200) + mid("b", 200)) / 2).toBe(0);
  });

  it("prefers a real measurement over the estimate", () => {
    const positions = computeCanvasTidyLayout(
      [node("a", 280, 300), unmeasured("b")],
      [],
      () => 999
    );

    expect(positions[1]!.position.y - positions[0]!.position.y).toBe(348);
  });
});

function unmeasured(id: string): Node {
  return { id, position: { x: 0, y: 0 }, data: {} };
}

function node(id: string, width: number, height: number): Node {
  return {
    id,
    position: { x: 0, y: 0 },
    data: {},
    measured: { width, height },
  };
}

function selected<NodeType extends Node>(node: NodeType): NodeType {
  return { ...node, selected: true };
}

function edge(source: string, target: string): Edge {
  return {
    id: `${source}-${target}`,
    source,
    target,
  };
}
