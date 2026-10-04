import { beforeEach, expect, it, vi } from "vitest";
import { createCanvasHost } from "./story-canvas-host";
import { canvasHostInjection, canvasRuntimeHtml, parseCanvasMessage } from "./story-canvas-bridge";
import type { StoryCanvasDocumentState } from "../api/story-canvas-document";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sessionId = id(3);
const snapshot: StoryCanvasDocumentState = {
  document: {
    id: id(2),
    owner: { kind: "story_project", projectId: id(1) },
    storyProjectId: id(1),
    platformProjectId: null,
    storyChapterId: null,
    type: "canvas",
    status: "active",
    currentSequence: 2,
    snapshotSequence: 1,
    crdtStateBase64: "AAA=",
  },
  operations: [
    { id: id(4), documentId: id(2), sequence: 2, operationType: "system", yjsUpdateBase64: "AQI=" },
  ],
  sequence: 2,
};
const result = {
  type: "loaded",
  sessionId,
  documentId: id(2),
  sequence: 2,
  requestId: 1,
  state: "AAA=",
  snapshot: { meta: {}, nodes: {}, edges: {}, groups: {}, assets: {} },
};
const ready = JSON.stringify({ type: "ready", sessionId });
function setup() {
  const send = vi.fn(),
    onResult = vi.fn(),
    onError = vi.fn();
  const host = createCanvasHost({
    scope: { projectId: id(1), generation: 1 },
    sessionId,
    snapshot,
    send,
    onResult,
    onError,
  });
  return { host, send, onResult, onError };
}
beforeEach(() => {
  h.generation = 1;
});
it("waits for runtime readiness and supplies bytes even on system markers", () => {
  const { host, send, onResult } = setup();
  expect(send).not.toHaveBeenCalled();
  host.receive(ready);
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ snapshot: "AAA=", updates: ["AQI="], requestId: 1 })
  );
  host.receive(JSON.stringify(result));
  host.receive(JSON.stringify(result));
  expect(onResult).toHaveBeenCalledExactlyOnceWith(result);
});
it.each([
  { sessionId: id(9) },
  { documentId: id(9) },
  { sequence: 1 },
  { requestId: 2 },
  { snapshot: {} },
])("rejects mismatched results %s", (patch) => {
  const { host, onResult, onError } = setup();
  host.receive(ready);
  host.receive(JSON.stringify({ ...result, ...patch }));
  expect(onResult).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});
it("retires earlier replies when a newer snapshot is sent", () => {
  const { host, onResult, send } = setup();
  host.receive(ready);
  host.remote({ ...snapshot, document: { ...snapshot.document, currentSequence: 3 }, sequence: 3 });
  host.receive(JSON.stringify(result));
  expect(onResult).not.toHaveBeenCalled();
  expect(send.mock.lastCall?.[0]).toMatchObject({ sequence: 3, requestId: 2 });
  host.receive(JSON.stringify({ ...result, sequence: 3, requestId: 2 }));
  expect(onResult).toHaveBeenCalledOnce();
});
it.each(["account", "dispose"])("ignores replies after %s retirement", (reason) => {
  const { host, onResult, send } = setup();
  host.receive(ready);
  if (reason === "account") h.generation++;
  else host.dispose();
  host.receive(JSON.stringify(result));
  host.remote(snapshot);
  host.receive(ready);
  expect(onResult).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledOnce();
});
it("surfaces a matching runtime error without accepting a late result", () => {
  const { host, onError, onResult } = setup();
  host.receive(ready);
  host.receive(
    JSON.stringify({
      type: "error",
      sessionId,
      documentId: id(2),
      sequence: 2,
      requestId: 1,
      message: "Canvas history is incomplete",
    })
  );
  host.receive(JSON.stringify(result));
  expect(onError).toHaveBeenCalledWith("Canvas history is incomplete");
  expect(onResult).not.toHaveBeenCalled();
});
it("rejects foreign or regressed snapshots before sending", () => {
  const { host, send } = setup();
  host.receive(ready);
  expect(() => host.remote({ ...snapshot, document: { ...snapshot.document, id: id(9) } })).toThrow(
    "scope or sequence"
  );
  expect(() =>
    host.remote({
      ...snapshot,
      sequence: 1,
      document: { ...snapshot.document, currentSequence: 1 },
    })
  ).toThrow("scope or sequence");
  expect(send).toHaveBeenCalledOnce();
});
it("ignores malformed messages and validates native injection", () => {
  expect(parseCanvasMessage("not JSON", sessionId)).toBeNull();
  expect(parseCanvasMessage({}, sessionId)).toBeNull();
  const { host, send } = setup();
  host.receive(ready);
  expect(canvasHostInjection(send.mock.lastCall![0])).toContain("__fizzCanvasReceive");
  expect(() => canvasHostInjection({ ...send.mock.lastCall![0], snapshot: "</script>" })).toThrow();
});
it("builds an offline frame with a strict network-blocking policy", () => {
  const html = canvasRuntimeHtml(sessionId);
  expect(html).toContain("default-src 'none'");
  expect(html).toContain("form-action 'none'");
  expect(html).not.toContain("<script src=");
  expect(() => canvasRuntimeHtml("</script>")).toThrow();
});
