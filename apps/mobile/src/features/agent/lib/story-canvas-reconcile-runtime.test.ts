// @vitest-environment node
import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import * as Y from "yjs";
import bundle from "../canvas-data/runtime-bundle.json";
import { encodeCanvasBytes, materializeCanvas } from "../../../../canvas-editor/state";
import { canvasRuntimeMessage } from "../../../../canvas-editor/protocol";

it("runs reconciliation through the shipped runtime and replays its exact delta", () => {
  const sessionId = "00000000-0000-4000-8000-000000000001";
  const documentId = "00000000-0000-4000-8000-000000000002";
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
    const nodes = doc.getMap("nodes");
    for (const [id, type, data] of [
      ["shot", "shot", { dialogue: "Keep" }],
      ["source", "image", { src: "https://example.test/image" }],
    ] as const) {
      nodes.set(
        id,
        new Y.Map<unknown>([
          ["id", id],
          ["type", type],
          ["data", new Y.Map(Object.entries(data))],
        ])
      );
    }
    doc
      .getMap("edges")
      .set(
        "pending",
        new Y.Map(Object.entries({ id: "pending", source: "source", target: "shot" }))
      );
    const snapshot = encodeCanvasBytes(Y.encodeStateAsUpdate(doc));
    const request = {
      type: "reconcileShotMedia",
      sessionId,
      documentId,
      requestId: 1,
      sequence: 3,
      snapshot,
    };
    host.__fizzCanvasReceive!(JSON.stringify({ ...request, sessionId: documentId }));
    expect(received).toEqual([{ type: "ready", sessionId }]);
    host.__fizzCanvasReceive!(JSON.stringify(request));
    const reply = canvasRuntimeMessage.parse(received.at(-1));
    expect(reply.type).toBe("edited");
    if (reply.type !== "edited") throw Error("Runtime did not return an edit");
    expect(reply).toMatchObject({ documentId, requestId: 1, sequence: 3 });
    expect(reply.yjsUpdateBase64).not.toBeNull();
    expect(
      materializeCanvas(snapshot, [reply.yjsUpdateBase64!, reply.yjsUpdateBase64!]).snapshot
    ).toEqual(reply.snapshot);
    expect(reply.snapshot.nodes.shot).toHaveProperty("data.references.frame", [
      expect.objectContaining({ edgeId: "pending", url: "https://example.test/image" }),
    ]);
    host.__fizzCanvasReceive!(JSON.stringify(request));
    expect(received).toHaveLength(2);
    host.__fizzCanvasReceive!(JSON.stringify({ ...request, requestId: 2, snapshot: reply.state }));
    expect(received.at(-1)).toMatchObject({ type: "edited", yjsUpdateBase64: null });
  } finally {
    doc.destroy();
  }
});
