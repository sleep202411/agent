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

    expect(computeCanvasTidyLayout(nodes, edges)).toEqual([
      { id: "source", position: { x: 0, y: 0 } },
      { id: "image", position: { x: 400, y: 0 } },
      { id: "sibling", position: { x: 400, y: 288 } },
      { id: "video", position: { x: 760, y: 0 } },
    ]);
  });

  it("ignores orphaned edges instead of creating phantom columns", () => {
    expect(
      computeCanvasTidyLayout(
        [node("one", 280, 200), node("two", 280, 200)],
        [edge("missing", "two")]
      )
    ).toEqual([
      { id: "one", position: { x: 0, y: 0 } },
      { id: "two", position: { x: 0, y: 248 } },
    ]);
  });
});

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
