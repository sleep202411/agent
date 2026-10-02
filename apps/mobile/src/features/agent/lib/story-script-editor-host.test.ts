import { beforeEach, expect, it, vi } from "vitest";
import { createScriptEditorHost } from "./story-script-editor-host";
const h = vi.hoisted(() => ({
  generation: 1,
  raw: null as string | null,
  write: vi.fn(),
  submit: vi.fn(),
  readPending: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: () => ({ read: () => h.raw, write: h.write }),
}));
vi.mock("../api/story-script-collaboration", () => ({
  scriptUpdatePending: () => ({ read: h.readPending, submit: h.submit }),
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { projectId: id(1), chapterId: id(2), documentId: id(3), generation: 1 };
const snapshot = {
  document: {
    id: id(3),
    storyProjectId: id(1),
    storyChapterId: id(2),
    type: "script" as const,
    status: "active" as const,
    snapshotSequence: 0,
    currentSequence: 0,
    crdtStateBase64: "AAA=",
  },
  operations: [],
  sequence: 0,
};
const edit = { clientKey: id(5), yjsUpdateBase64: "AQI=" };
const next = { clientKey: id(6), yjsUpdateBase64: "AQM=" };
const checkpoint = (pending = [edit]) => ({ version: 1, state: "AAA=", pending });
const send = vi.fn(),
  onError = vi.fn();
const create = (editable = true) =>
  createScriptEditorHost({
    scope,
    userId: "user",
    sessionId: id(4),
    editable,
    snapshot,
    send,
    onError,
  });
const receive = (host: ReturnType<typeof create>, revision: number, pending = [edit]) =>
  host.receive(
    JSON.stringify({
      type: "checkpoint",
      sessionId: id(4),
      revision,
      checkpoint: checkpoint(pending),
    })
  );
const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.raw = null;
  h.write.mockImplementation((raw: string) => {
    h.raw = raw;
  });
  h.submit.mockResolvedValue(undefined);
  h.readPending.mockReturnValue(null);
});
it("persists before submitting and waits for an acknowledged edit to leave the checkpoint", async () => {
  const host = create();
  h.submit.mockImplementation(async () => {
    expect(JSON.parse(h.raw!).pending).toContainEqual(edit);
  });
  receive(host, 1, [edit, next]);
  await flush();
  expect(h.submit).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith({ type: "ack", sessionId: id(4), edit });
  h.submit.mockResolvedValue(undefined);
  receive(host, 2, [next]);
  await flush();
  expect(h.submit).toHaveBeenLastCalledWith(next);
  receive(host, 3, []);
  expect(JSON.parse(h.raw!).pending).toEqual([]);
});
it("blocks network writes after disk failure and retries the retained checkpoint", async () => {
  const host = create();
  h.write.mockImplementationOnce(() => {
    throw Error("disk full");
  });
  receive(host, 1);
  await flush();
  expect(h.submit).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledWith({ type: "hostError", sessionId: id(4), message: "disk full" });
  host.retry();
  await flush();
  expect(h.submit).toHaveBeenCalledWith(edit);
});
it("retries the exact journal entry after a failed request", async () => {
  const host = create();
  h.submit.mockRejectedValueOnce(Error("offline"));
  receive(host, 1);
  await flush();
  expect(onError).toHaveBeenCalledWith("offline");
  host.retry();
  await flush();
  expect(h.submit.mock.calls).toEqual([[edit], [edit]]);
});
it("retains read-only edits until permission is granted", async () => {
  const host = create(false);
  receive(host, 1);
  await flush();
  expect(h.submit).not.toHaveBeenCalled();
  expect(h.raw).not.toBeNull();
  host.setEditable(true);
  await flush();
  expect(h.submit).toHaveBeenCalledWith(edit);
});
it("ignores stale revisions and prior account sessions", async () => {
  const host = create(false);
  receive(host, 2, [next]);
  receive(host, 1);
  expect(h.write).toHaveBeenCalledTimes(1);
  h.generation = 2;
  receive(host, 3);
  host.setEditable(true);
  await flush();
  expect(h.write).toHaveBeenCalledTimes(1);
  expect(h.submit).not.toHaveBeenCalled();
});
it("restores the journal and rejects an orphaned pending request", () => {
  h.raw = JSON.stringify(checkpoint());
  h.readPending.mockReturnValue(edit);
  const host = create();
  host.receive(JSON.stringify({ type: "ready", sessionId: id(4) }));
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ type: "init", checkpoint: checkpoint() })
  );
  h.readPending.mockReturnValue(next);
  expect(create).toThrow("recovery");
});
it("uses the latest scoped snapshot for late initialization", () => {
  const host = create();
  host.remote({ ...snapshot, document: { ...snapshot.document, crdtStateBase64: "AQI=" } });
  host.receive(JSON.stringify({ type: "ready", sessionId: id(4) }));
  expect(send).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: "init", snapshot: "AQI=" })
  );
  expect(() => host.remote({ ...snapshot, document: { ...snapshot.document, id: id(9) } })).toThrow(
    "scope mismatch"
  );
});
