// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import * as Y from "yjs";
import { readAllNodes, writeNode } from "./canvas-doc";
import { useCanvasGraph, type CanvasGraph } from "./use-canvas-graph";

it("undoes prompt edits without losing the submission receipt or completed output", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const doc = new Y.Doc();
  writeNode(doc, {
    id: "node",
    type: "video",
    position: { x: 0, y: 0 },
    data: { prompt: "original" },
  });
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  doc.on("update", (update: Uint8Array) => Y.applyUpdate(peer, update));
  let graph!: CanvasGraph;
  function Harness() {
    const current = useCanvasGraph(doc);
    useLayoutEffect(() => {
      graph = current;
    }, [current]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Harness />));
    const receipt = { status: "submitting", submissionKey: "receipt" };
    await act(async () => graph.patchNodeData("node", { generation: receipt }));
    expect(graph.canUndo).toBe(false);
    await act(async () => graph.patchNodeData("node", { prompt: "edited" }));
    await act(async () => graph.undo());
    expect(graph.getNode("node")?.data).toEqual({ prompt: "original", generation: receipt });
    await act(async () => graph.redo());
    const completed = { status: "done", jobId: "job", outputs: [{ assetId: "asset" }] };
    await act(async () => graph.patchNodeData("node", { generation: completed }));
    await act(async () => graph.undo());
    expect(graph.getNode("node")?.data).toEqual({ prompt: "original", generation: completed });
    expect(readAllNodes(peer)[0].data).toEqual(graph.getNode("node")?.data);
    expect(graph.canUndo).toBe(false);
  } finally {
    await act(async () => root.unmount());
    doc.destroy();
    peer.destroy();
  }
});
