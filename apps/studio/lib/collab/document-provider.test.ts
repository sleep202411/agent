// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { DocumentProvider } from "./document-provider";
import { TEXT_DOC_ROOT_SCHEMA, base64ToBytes, type ClientFrame } from "./protocol";
vi.mock("y-indexeddb", () => ({
  IndexeddbPersistence: class {
    whenSynced = Promise.resolve();
    destroy() {
      return Promise.resolve();
    }
  },
}));
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  frames: ClientFrame[] = [];
  constructor() {
    Socket.instances.push(this);
  }
  send(raw: string) {
    this.frames.push(JSON.parse(raw) as ClientFrame);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  frame(event: string, data: unknown) {
    this.onmessage?.({ data: JSON.stringify({ event, data }) });
  }
  sync() {
    this.frame("operations_sync", { operations: [], afterSequence: 0 });
  }
  operations() {
    return this.frames.filter(
      (frame): frame is Extract<ClientFrame, { event: "operation" }> => frame.event === "operation"
    );
  }
}
let provider: DocumentProvider;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  provider = new DocumentProvider({ documentId: "doc", rootSchema: TEXT_DOC_ROOT_SCHEMA });
  await Promise.resolve();
});
afterEach(() => {
  provider.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function reconnect() {
  Socket.instances.at(-1)!.close();
  await vi.advanceTimersByTimeAsync(1000);
  const socket = Socket.instances.at(-1)!;
  socket.open();
  socket.sync();
  return socket;
}
it("replays unacknowledged edits with their original mutation and idempotency keys", async () => {
  const first = Socket.instances[0]!;
  first.open();
  first.sync();
  provider.doc.getText("content").insert(0, "offline-safe edit");
  const operation = first.operations()[0]!;
  const second = await reconnect();
  expect(second.operations()).toHaveLength(1);
  expect(second.operations()[0]).toEqual(operation);
  expect(operation.data.idempotencyKey).toBe(operation.data.clientMutationId);
  expect(operation.data.idempotencyKey).toBeTruthy();
});
it("stops replaying an edit after its acknowledgement", async () => {
  const first = Socket.instances[0]!;
  first.open();
  first.sync();
  provider.doc.getText("content").insert(0, "saved");
  const operation = first.operations()[0]!;
  const second = await reconnect();
  expect(second.operations()).toHaveLength(1);
  second.frame("operation_ack", {
    operation: { sequence: 1, clientMutationId: operation.data.clientMutationId },
  });
  const third = await reconnect();
  expect(third.operations()).toHaveLength(0);
});
it("waits for initial synchronization before sending local edits", () => {
  const socket = Socket.instances[0]!;
  socket.open();
  provider.doc.getText("content").insert(0, "before bootstrap");
  expect(socket.operations()).toHaveLength(0);
  socket.sync();
  expect(socket.operations()).toHaveLength(1);
});

it("recovers unacknowledged and offline edits into the same CRDT document", async () => {
  const first = Socket.instances[0]!;
  first.open();
  first.sync();
  provider.doc.getText("content").insert(0, "a");
  const firstOperation = first.operations()[0]!;
  first.close();
  provider.doc.getText("content").insert(1, "b");
  await vi.advanceTimersByTimeAsync(1000);
  const second = Socket.instances.at(-1)!;
  second.open();
  second.sync();
  expect(second.operations()).toHaveLength(2);
  const server = new Y.Doc();
  try {
    // The first operation committed, but its acknowledgement was lost.
    Y.applyUpdate(server, base64ToBytes(firstOperation.data.yjsUpdateBase64));
    for (const operation of second.operations()) {
      Y.applyUpdate(server, base64ToBytes(operation.data.yjsUpdateBase64));
    }
    expect(server.getText("content").toString()).toBe("ab");
  } finally {
    server.destroy();
  }
});

it("does not restart heartbeat work from an open callback retained after destruction", () => {
  const opened = Socket.instances[0]!.onopen!;
  provider.destroy();
  expect(vi.getTimerCount()).toBe(0);
  opened();
  expect(vi.getTimerCount()).toBe(0);
});

it("ignores a departed socket close after the replacement is synchronized", async () => {
  const first = Socket.instances[0]!;
  first.open();
  first.sync();
  const closed = first.onclose!;
  const second = await reconnect();
  expect(provider.getStatus()).toBe("synced");
  closed();
  expect(provider.getStatus()).toBe("synced");
  await vi.advanceTimersByTimeAsync(1_000);
  expect(Socket.instances).toHaveLength(2);
  expect(second.readyState).toBe(Socket.OPEN);
});

it("delivers application events only from the current document socket", async () => {
  const receive = vi.fn();
  provider.onAppEvent(receive);
  const first = Socket.instances[0]!;
  first.open();
  first.sync();
  const message = first.onmessage!;
  const second = await reconnect();
  message({ data: JSON.stringify({ event: "app_event", data: { id: "old" } }) });
  second.frame("app_event", { id: "current" });
  expect(receive).toHaveBeenCalledExactlyOnceWith({ id: "current" });
});

it("exposes rejected writes and retries original receipts without losing new edits", async () => {
  const first = Socket.instances[0]!;
  first.open();
  first.sync();
  provider.doc.getText("content").insert(0, "first");
  const original = first.operations()[0]!;
  const errors: Array<string | null> = [];
  provider.onError((error) => errors.push(error));
  first.frame("error", { code: "DOCUMENT_WS_ERROR", message: "Storage unavailable" });
  expect(provider.getStatus()).toBe("offline");
  expect(provider.getError()).toBe("Storage unavailable");
  expect(first.readyState).toBe(3);
  provider.doc.getText("content").insert(5, " second");
  provider.retry();
  const second = Socket.instances.at(-1)!;
  second.open();
  second.sync();
  expect(second.operations()[0]).toEqual(original);
  expect(second.operations()).toHaveLength(2);
  expect(provider.getStatus()).not.toBe("synced");
  expect(provider.getError()).toBe("Storage unavailable");
  for (const [index, frame] of second.operations().entries()) {
    second.frame("operation_ack", {
      operation: { sequence: index + 1, clientMutationId: frame.data.clientMutationId },
    });
  }
  expect(provider.doc.getText("content").toString()).toBe("first second");
  expect(provider.getStatus()).toBe("synced");
  expect(errors).toEqual(["Storage unavailable", null]);
});
it("does not reconnect on retry after access revocation", () => {
  const socket = Socket.instances[0]!;
  socket.open();
  socket.sync();
  socket.frame("terminate", { reason: "access_revoked", code: 1000 });
  socket.close();
  provider.retry();
  expect(Socket.instances).toHaveLength(1);
  expect(provider.canRetry()).toBe(false);
  expect(provider.getError()).toBe("Your access to this document was revoked.");
  expect(provider.getStatus()).toBe("offline");
});
