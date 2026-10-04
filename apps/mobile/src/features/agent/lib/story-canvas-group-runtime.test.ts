// @vitest-environment node
import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import * as Y from "yjs";
import bundle from "../canvas-data/runtime-bundle.json";
import { encodeCanvasBytes, materializeCanvas } from "../../../../canvas-editor/state";
import { canvasRuntimeMessage } from "../../../../canvas-editor/protocol";
import type { CanvasGroupEdit } from "../../../../canvas-editor/group-schema";

it("applies group commands through the shipped runtime with exact replay and stable node identity", () => {
  const sessionId = "00000000-0000-4000-8000-000000000001";
  const documentId = "00000000-0000-4000-8000-000000000002";
  const groupId = "group-00000000-0000-4000-8000-000000000003";
  const received: unknown[] = [];
  const host = {
    addEventListener() {},
    __fizzCanvasReceive: undefined as undefined | ((raw: string) => void),
  };
  runInNewContext(bundle, {
    window: host,
    document: { querySelector: () => ({ textContent: JSON.stringify({ sessionId }) }) },
    parent: { postMessage: (raw: string) => received.push(JSON.parse(raw)) },
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    setTimeout,
    clearTimeout,
    console,
  });
  const doc = new Y.Doc();
  try {
    for (const id of ["a", "b"]) {
      doc.getMap("nodes").set(
        id,
        new Y.Map<unknown>([
          ["id", id],
          ["type", "note"],
          ["data", new Y.Map([["text", id]])],
          [
            "position",
            new Y.Map([
              ["x", 10],
              ["y", 20],
            ]),
          ],
        ])
      );
    }
    let state = encodeCanvasBytes(Y.encodeStateAsUpdate(doc)),
      requestId = 0;
    const run = (group: CanvasGroupEdit) => {
      const base = state;
      host.__fizzCanvasReceive!(
        JSON.stringify({
          type: "group",
          sessionId,
          documentId,
          requestId: ++requestId,
          sequence: 1,
          snapshot: base,
          group,
        })
      );
      const reply = canvasRuntimeMessage.parse(received.at(-1));
      expect(reply.type).toBe("edited");
      if (reply.type !== "edited") throw Error("Runtime did not return an edit");
      expect(reply).toMatchObject({ documentId, requestId, sequence: 1 });
      expect(reply.yjsUpdateBase64).not.toBeNull();
      expect(
        materializeCanvas(base, [reply.yjsUpdateBase64!, reply.yjsUpdateBase64!]).snapshot
      ).toEqual(reply.snapshot);
      state = reply.state;
      return reply;
    };
    expect(
      run({ operation: "create", groupId, nodeIds: ["a", "b"] }).snapshot.groups[groupId]
    ).toHaveProperty("color", "slate");
    expect(
      run({ operation: "color", groupId, color: "cyan" }).snapshot.groups[groupId]
    ).toHaveProperty("color", "cyan");
    const moved = run({ operation: "move", groupId, delta: { x: 15, y: -10 } });
    expect(moved.snapshot.nodes.a).toHaveProperty("position", { x: 25, y: 10 });
    host.__fizzCanvasReceive!(
      JSON.stringify({
        type: "moveNodes",
        sessionId,
        documentId,
        requestId: ++requestId,
        sequence: 1,
        snapshot: state,
        move: { action: "moveNodes", positions: [{ nodeId: "a", x: 77, y: -33 }] },
      })
    );
    const positioned = canvasRuntimeMessage.parse(received.at(-1));
    expect(positioned.type).toBe("edited");
    if (positioned.type !== "edited") throw Error("Position command failed");
    expect(positioned.snapshot.nodes.a).toHaveProperty("position", { x: 77, y: -33 });
    expect(
      materializeCanvas(state, [positioned.yjsUpdateBase64!, positioned.yjsUpdateBase64!]).snapshot
    ).toEqual(positioned.snapshot);
    state = positioned.state;
    const ungrouped = run({ operation: "ungroup", groupId });
    expect(ungrouped.snapshot.groups).toEqual({});
    expect(ungrouped.snapshot.nodes).toEqual(positioned.snapshot.nodes);
    host.__fizzCanvasReceive!(
      JSON.stringify({
        type: "group",
        sessionId,
        documentId,
        requestId: ++requestId,
        sequence: 1,
        snapshot: state,
        group: { operation: "move", groupId, delta: { x: 1, y: 1 } },
      })
    );
    expect(received.at(-1)).toMatchObject({
      type: "error",
      message: "The canvas group changed. Reload the document.",
    });
  } finally {
    doc.destroy();
  }
});
