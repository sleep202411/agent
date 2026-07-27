// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readAllGroups, writeNode } from "./canvas-doc";
import { useCanvasGraph, type CanvasGraph } from "./use-canvas-graph";

describe("useCanvasGraph grouping", () => {
  let container: HTMLDivElement;
  let root: Root;
  let doc: Y.Doc;
  let graph: CanvasGraph | null;

  function Harness({ canEdit = true }: { canEdit?: boolean }) {
    graph = useCanvasGraph(doc, null, canEdit);
    return <span data-group-count={graph.groups.length} />;
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    doc = new Y.Doc();
    ["a", "b", "c"].forEach((id, index) =>
      writeNode(doc, {
        id,
        type: "note",
        position: { x: index * 300, y: 0 },
        data: {},
      })
    );
    graph = null;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    doc.destroy();
    container.remove();
  });

  it("persists group creation, membership, color, and explicit removal", async () => {
    await act(async () => root.render(<Harness />));

    let groupId: string | null = null;
    await act(async () => {
      groupId = current().toggleGroup(["a", "b"]);
    });
    expect(groupId).toMatch(/^group-/);
    expect(readAllGroups(doc)).toEqual([{ id: groupId, nodeIds: ["a", "b"], color: "slate" }]);

    await act(async () => {
      expect(current().addNodesToGroup(groupId!, ["c"])).toBe(true);
      current().setGroupColor(groupId!, "pink");
    });
    expect(current().groups).toEqual([{ id: groupId, nodeIds: ["a", "b", "c"], color: "pink" }]);

    await act(async () => {
      expect(current().removeNodesFromGroups(["c"])).toBe(true);
    });
    expect(readAllGroups(doc)).toEqual([{ id: groupId, nodeIds: ["a", "b"], color: "pink" }]);
  });

  it("includes group changes in undo and redo", async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      current().toggleGroup(["a", "b"]);
    });
    expect(current().groups).toHaveLength(1);
    expect(current().canUndo).toBe(true);

    await act(async () => current().undo());
    expect(current().groups).toEqual([]);
    expect(current().canRedo).toBe(true);

    await act(async () => current().redo());
    expect(current().groups).toHaveLength(1);
  });

  it("cleans up group membership when a node is deleted", async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      current().toggleGroup(["a", "b", "c"]);
      current().removeNode("c");
    });
    expect(current().groups[0]?.nodeIds).toEqual(["a", "b"]);

    await act(async () => current().removeNode("b"));
    expect(current().groups).toEqual([]);
  });

  it("keeps groups visible but immutable for read-only collaborators", async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      current().toggleGroup(["a", "b"]);
    });
    await act(async () => root.render(<Harness canEdit={false} />));

    expect(current().groups).toHaveLength(1);
    expect(current().toggleGroup(["a", "b"])).toBeNull();
    expect(current().removeNodesFromGroups(["a"])).toBe(false);
    expect(readAllGroups(doc)).toHaveLength(1);
  });

  function current(): CanvasGraph {
    if (!graph) throw new Error("Canvas graph is unavailable.");
    return graph;
  }
});
