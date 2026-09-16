// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import * as Y from "yjs";
import { readAllNodes, writeNode } from "./canvas-doc";
import { useCanvasGraph, type CanvasGraph } from "./use-canvas-graph";
it.each(["replace", "permission", "unmount"])(
  "rejects retained graph writes after %s",
  async (change) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const a = new Y.Doc();
    const b = new Y.Doc();
    let graph!: CanvasGraph;
    function Probe({ doc, edit = true }: { doc: Y.Doc; edit?: boolean }) {
      graph = useCanvasGraph(doc, null, edit);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(<Probe doc={a} />));
      const retained = graph;
      await act(async () =>
        root.render(
          change === "unmount" ? null : (
            <Probe doc={change === "replace" ? b : a} edit={change !== "permission"} />
          )
        )
      );
      await act(async () =>
        retained.addNode({ id: "stale", type: "note", position: { x: 0, y: 0 }, data: {} })
      );
      expect(readAllNodes(a)).toHaveLength(0);
      expect(readAllNodes(b)).toHaveLength(0);
    } finally {
      await act(async () => root.unmount());
      a.destroy();
      b.destroy();
    }
  }
);
it("cannot use an old undo callback against the replacement document", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const a = new Y.Doc();
  const b = new Y.Doc();
  writeNode(b, { id: "node", type: "note", position: { x: 0, y: 0 }, data: { prompt: "before" } });
  let graph!: CanvasGraph;
  function Probe({ doc }: { doc: Y.Doc }) {
    graph = useCanvasGraph(doc);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Probe doc={a} />));
    const oldUndo = graph.undo;
    await act(async () => root.render(<Probe doc={b} />));
    await act(async () => graph.patchNodeData("node", { prompt: "after" }));
    await act(async () => oldUndo());
    expect(readAllNodes(b)[0]?.data.prompt).toBe("after");
    await act(async () => graph.undo());
    expect(readAllNodes(b)[0]?.data.prompt).toBe("before");
  } finally {
    await act(async () => root.unmount());
    a.destroy();
    b.destroy();
  }
});
