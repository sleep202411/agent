import { describe, expect, it, vi } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import {
  computeCanvasTidyLayout,
  createCanvasTidyLayoutRequest,
  resolveCanvasTidyTargets,
  type CanvasTidyPosition,
} from "./canvas-tidy-layout";

// jsdom has no Worker, so swap the browser client (which spawns one) for
// the bundled in-thread ELK. Same layout algorithm, different executor.
vi.mock("./browser-elk-layout-client", async () => {
  const bundled = await import("elkjs/lib/elk.bundled.js");
  return {
    createBrowserElkLayoutEngine: () => new bundled.default({}),
  };
});

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

describe("createCanvasTidyLayoutRequest", () => {
  it("prefers real measurements and keeps semantic estimates for unmeasured cards", () => {
    const measured = node("measured", 280, 300);
    const unmeasuredNode = unmeasured("estimated");
    const request = createCanvasTidyLayoutRequest([measured, unmeasuredNode], [], (candidate) =>
      candidate.id === "estimated" ? 420 : 999
    );

    expect(request.nodes.map(({ id, width, height }) => ({ id, width, height }))).toEqual([
      { id: "measured", width: 280, height: 300 },
      { id: "estimated", width: 320, height: 420 },
    ]);
  });

  it("assigns a node to the first matching semantic lane only", () => {
    const character = { ...unmeasured("cast"), data: { kind: "character" } };
    const request = createCanvasTidyLayoutRequest([character], [], undefined, {
      lanes: [
        { id: "cast", side: "left", matches: () => true },
        { id: "other", side: "right", matches: () => true },
      ],
    });

    expect(request.lanes.map((lane) => lane.nodeIds)).toEqual([["cast"], []]);
  });
});

describe("computeCanvasTidyLayout", () => {
  it("lays out a branching dependency graph left-to-right without overlaps", async () => {
    const nodes = [
      node("source", 320, 180),
      node("image", 280, 240),
      node("video", 420, 300),
      node("sibling", 260, 100),
    ];
    const positions = await computeCanvasTidyLayout(nodes, [
      edge("source", "image"),
      edge("image", "video"),
      edge("source", "sibling"),
    ]);
    const byId = positionMap(positions);

    expect(byId.get("source")!.x).toBeLessThan(byId.get("image")!.x);
    expect(byId.get("source")!.x).toBeLessThan(byId.get("sibling")!.x);
    expect(byId.get("image")!.x).toBeLessThan(byId.get("video")!.x);
    expectNoOverlaps(nodes, positions);
  });

  it("handles directed cycles instead of inflating a phantom depth forever", async () => {
    const nodes = [node("a", 280, 180), node("b", 280, 180), node("c", 280, 180)];
    const positions = await computeCanvasTidyLayout(nodes, [
      edge("a", "b"),
      edge("b", "c"),
      edge("c", "a"),
    ]);

    expect(new Set(positions.map(({ position }) => position.x)).size).toBeGreaterThan(1);
    positions.forEach(({ position }) => {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
    });
    expectNoOverlaps(nodes, positions);
  });

  it("packs disconnected components in two dimensions instead of one vertical column", async () => {
    const nodes = Array.from({ length: 10 }, (_, index) => node(`orphan-${index}`, 280, 180));
    const positions = await computeCanvasTidyLayout(nodes, [edge("missing", "orphan-0")]);
    const bounds = layoutBounds(nodes, positions);

    expect(new Set(positions.map(({ position }) => position.x)).size).toBeGreaterThan(1);
    expect(new Set(positions.map(({ position }) => position.y)).size).toBeGreaterThan(1);
    expect(bounds.width / bounds.height).toBeGreaterThan(1);
    expect(bounds.width / bounds.height).toBeLessThan(3);
    expectNoOverlaps(nodes, positions);
  });

  it("packs heterogeneous media cards without overlap or a degenerate single axis", async () => {
    const nodes = Array.from({ length: 15 }, (_, index) =>
      node(`media-${index}`, 240 + (index % 4) * 80, 120 + (index % 3) * 90)
    );
    const positions = await computeCanvasTidyLayout(nodes, []);

    expect(new Set(positions.map(({ position }) => position.x)).size).toBeGreaterThan(2);
    expect(new Set(positions.map(({ position }) => position.y)).size).toBeGreaterThan(1);
    expectNoOverlaps(nodes, positions);
  });

  it("packs several story islands while preserving each island's flow", async () => {
    const nodes = [
      node("a1", 280, 180),
      node("a2", 280, 180),
      node("b1", 280, 180),
      node("b2", 280, 180),
      node("orphan", 280, 180),
    ];
    const positions = await computeCanvasTidyLayout(nodes, [edge("a1", "a2"), edge("b1", "b2")]);
    const byId = positionMap(positions);

    expect(byId.get("a1")!.x).toBeLessThan(byId.get("a2")!.x);
    expect(byId.get("b1")!.x).toBeLessThan(byId.get("b2")!.x);
    expectNoOverlaps(nodes, positions);
  });

  it("keeps semantic lane nodes together beside the graph", async () => {
    const storyNodes = [
      storyNode("entry", "clip", 320, 260),
      storyNode("next", "clip", 320, 260),
      storyNode("cast-1", "character", 280, 140),
      storyNode("cast-2", "character", 280, 140),
    ];
    const positions = await computeCanvasTidyLayout(
      storyNodes,
      [edge("entry", "next")],
      undefined,
      {
        lanes: [
          {
            id: "cast",
            side: "left",
            gap: 160,
            nodeGap: 48,
            matches: (candidate) => candidate.data.kind === "character",
          },
        ],
      }
    );
    const byId = positionMap(positions);
    const storyLeft = Math.min(byId.get("entry")!.x, byId.get("next")!.x);

    expect(byId.get("cast-1")!.x + 280).toBeLessThan(storyLeft);
    expect(byId.get("cast-2")!.x + 280).toBeLessThan(storyLeft);
    expect(byId.get("cast-1")!.x).toBe(byId.get("cast-2")!.x);
    expectNoOverlaps(storyNodes, positions);
  });

  it("preserves the centre of the tidied target so selected islands do not jump", async () => {
    const nodes = [
      positionedNode("a", 280, 180, 1400, -300),
      positionedNode("b", 280, 180, 1800, 500),
      positionedNode("c", 280, 180, 2200, 100),
    ];
    const positions = await computeCanvasTidyLayout(nodes, [edge("a", "b"), edge("a", "c")]);
    const before = sourceBounds(nodes);
    const after = layoutBounds(nodes, positions);

    expect(after.x + after.width / 2).toBeCloseTo(before.x + before.width / 2, 0);
    expect(after.y + after.height / 2).toBeCloseTo(before.y + before.height / 2, 0);
  });

  it("honours vertical flow for canvases that opt into a top-to-bottom graph", async () => {
    const nodes = [node("root", 320, 180), node("middle", 280, 240), node("leaf", 360, 160)];
    const positions = await computeCanvasTidyLayout(
      nodes,
      [edge("root", "middle"), edge("middle", "leaf")],
      undefined,
      { direction: "DOWN" }
    );
    const byId = positionMap(positions);

    expect(byId.get("root")!.y).toBeLessThan(byId.get("middle")!.y);
    expect(byId.get("middle")!.y).toBeLessThan(byId.get("leaf")!.y);
    expectNoOverlaps(nodes, positions);
  });

  it("is deterministic for the same graph and author order", async () => {
    const nodes = Array.from({ length: 7 }, (_, index) => node(`n${index}`, 280, 180));
    const edges = [
      edge("n0", "n1"),
      edge("n0", "n2"),
      edge("n1", "n3"),
      edge("n2", "n3"),
      edge("n4", "n5"),
    ];

    expect(await computeCanvasTidyLayout(nodes, edges)).toEqual(
      await computeCanvasTidyLayout(nodes, edges)
    );
  });
});

function positionMap(positions: CanvasTidyPosition[]): Map<string, { x: number; y: number }> {
  return new Map(positions.map(({ id, position }) => [id, position]));
}

function expectNoOverlaps(nodes: Node[], positions: CanvasTidyPosition[]): void {
  const byId = positionMap(positions);
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const leftNode = nodes[leftIndex]!;
    const left = byId.get(leftNode.id)!;
    const leftWidth = leftNode.measured?.width ?? leftNode.width ?? 320;
    const leftHeight = leftNode.measured?.height ?? leftNode.height ?? 240;
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const rightNode = nodes[rightIndex]!;
      const right = byId.get(rightNode.id)!;
      const rightWidth = rightNode.measured?.width ?? rightNode.width ?? 320;
      const rightHeight = rightNode.measured?.height ?? rightNode.height ?? 240;
      const separated =
        left.x + leftWidth <= right.x ||
        right.x + rightWidth <= left.x ||
        left.y + leftHeight <= right.y ||
        right.y + rightHeight <= left.y;
      expect(separated, `${leftNode.id} overlaps ${rightNode.id}`).toBe(true);
    }
  }
}

function layoutBounds(nodes: Node[], positions: CanvasTidyPosition[]) {
  const byId = positionMap(positions);
  return sourceBounds(
    nodes.map((candidate) => ({ ...candidate, position: byId.get(candidate.id)! }))
  );
}

function sourceBounds(nodes: Node[]) {
  const x = Math.min(...nodes.map((candidate) => candidate.position.x));
  const y = Math.min(...nodes.map((candidate) => candidate.position.y));
  const right = Math.max(
    ...nodes.map((candidate) => candidate.position.x + (candidate.measured?.width ?? 320))
  );
  const bottom = Math.max(
    ...nodes.map((candidate) => candidate.position.y + (candidate.measured?.height ?? 240))
  );
  return { x, y, width: right - x, height: bottom - y };
}

function unmeasured(id: string): Node {
  return { id, position: { x: 0, y: 0 }, data: {} };
}

function node(id: string, width: number, height: number): Node {
  return positionedNode(id, width, height, 0, 0);
}

function positionedNode(id: string, width: number, height: number, x: number, y: number): Node {
  return {
    id,
    position: { x, y },
    data: {},
    measured: { width, height },
  };
}

function storyNode(
  id: string,
  kind: "clip" | "character",
  width: number,
  height: number
): Node<{ kind: "clip" | "character" }> {
  return {
    id,
    type: "storyCanvas",
    position: { x: 0, y: 0 },
    data: { kind },
    measured: { width, height },
  };
}

function selected<NodeType extends Node>(candidate: NodeType): NodeType {
  return { ...candidate, selected: true };
}

function edge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target };
}
