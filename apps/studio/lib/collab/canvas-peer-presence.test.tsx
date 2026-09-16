// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { readAllNodes, writeNode } from "./canvas-doc";
import { useCanvasGraph, type CanvasGraph } from "./use-canvas-graph";

it.each([
  { drag: { node: null } },
  { drag: { node: { x: "invalid", y: 4 } } },
  { selection: { node: true } },
])("ignores malformed peer presence %j while preserving the document", async (state) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  awareness.getStates().set(doc.clientID + 1, state);
  writeNode(doc, { id: "node", type: "note", position: { x: 10, y: 20 }, data: {} });
  let graph!: CanvasGraph;
  function Probe() {
    graph = useCanvasGraph(doc, awareness);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Probe />));
    expect(graph.nodes[0]?.position).toEqual({ x: 10, y: 20 });
  } finally {
    await act(async () => root.unmount());
    awareness.destroy();
    doc.destroy();
  }
});

it("preserves valid peer dragging and selection without persisting the overlay", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  awareness.getStates().set(doc.clientID + 1, {
    drag: { node: { x: 30, y: 40 } },
    selection: ["node"],
    user: { color: "blue" },
  });
  writeNode(doc, { id: "node", type: "note", position: { x: 10, y: 20 }, data: {} });
  let graph!: CanvasGraph;
  function Probe() {
    graph = useCanvasGraph(doc, awareness);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Probe />));
    expect(graph.nodes[0]?.position).toEqual({ x: 30, y: 40 });
    expect(graph.nodes[0]?.style?.boxShadow).toContain("blue");
    expect(readAllNodes(doc)[0]?.position).toEqual({ x: 10, y: 20 });
  } finally {
    await act(async () => root.unmount());
    awareness.destroy();
    doc.destroy();
  }
});
