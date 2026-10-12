import { beforeEach, expect, it, vi } from "vitest";
import {
  openScriptCollaboration,
  reloadScriptCollaboration,
  scriptUpdatePending,
} from "./story-script-collaboration";
const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { projectId: id(1), chapterId: id(2), documentId: id(3), generation: 1 };
const doc = {
  id: id(3),
  storyProjectId: id(1),
  storyChapterId: id(2),
  type: "script",
  status: "active",
  snapshotSequence: 1,
  currentSequence: 2,
  crdtStateBase64: "AAA=",
};
const command = { clientKey: id(4), yjsUpdateBase64: "AQI=" };
const op = (sequence = 2) => ({
  id: id(sequence + 5),
  documentId: id(3),
  sequence,
  operationType: "yjs_update",
  clientMutationId: id(4),
  yjsUpdateBase64: "AQI=",
});
let raw: string | null;
const storage = {
  read: () => raw,
  write: vi.fn((s: string) => {
    raw = s;
  }),
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  raw = null;
  storage.write.mockImplementation((s) => {
    raw = s;
  });
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/operations") ? { operations: [op()] } : { document: doc }
  );
  h.post.mockImplementation(async (path: string) =>
    path.endsWith("/ensure") ? { document: doc } : { operation: op() }
  );
});
it("reconstructs from the snapshot horizon and ignores newer operations beyond the captured head", async () => {
  h.get.mockResolvedValue({ operations: [op(), op(3)] });
  const result = await openScriptCollaboration(scope, new AbortController().signal);
  expect(result.operations).toEqual([op()]);
  expect(result.sequence).toBe(2);
  expect(h.get).toHaveBeenCalledWith(
    `/documents/${id(3)}/operations`,
    expect.objectContaining({ params: { afterSequence: 1, limit: 500 } })
  );
});
it("paginates a complete operation tail", async () => {
  h.post.mockResolvedValue({ document: { ...doc, currentSequence: 502 } });
  h.get
    .mockResolvedValueOnce({ operations: Array.from({ length: 500 }, (_, i) => op(i + 2)) })
    .mockResolvedValueOnce({ operations: [op(502)] });
  expect(
    (await openScriptCollaboration(scope, new AbortController().signal)).operations
  ).toHaveLength(501);
  expect(h.get.mock.calls[1][1].params.afterSequence).toBe(501);
});
it.each([
  { operations: [], error: "history changed" },
  { operations: [op(3)], error: "history is incomplete" },
  { operations: [{ ...op(), documentId: id(9) }], error: "history is incomplete" },
  { operations: [{ ...op(), operationType: "snapshot" }], error: "fresh compacted CRDT" },
])("rejects incomplete or incompatible history %j", async ({ operations, error }) => {
  h.get.mockResolvedValue({ operations });
  await expect(openScriptCollaboration(scope, new AbortController().signal)).rejects.toThrow(error);
});
it("rejects a snapshot that cannot represent its horizon", async () => {
  h.post.mockResolvedValue({ document: { ...doc, crdtStateBase64: undefined } });
  await expect(openScriptCollaboration(scope, new AbortController().signal)).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
});
it("checks chapter identity for both bootstrap and reload", async () => {
  h.post.mockResolvedValue({ document: { ...doc, storyChapterId: id(9) } });
  await expect(openScriptCollaboration(scope, new AbortController().signal)).rejects.toThrow(
    "scope mismatch"
  );
  h.get.mockResolvedValue({ document: { ...doc, id: id(9) } });
  await expect(reloadScriptCollaboration(scope, new AbortController().signal)).rejects.toThrow(
    "scope mismatch"
  );
});
it("rejects late account responses and aborted bootstrap", async () => {
  h.post.mockImplementation(async () => {
    h.generation++;
    return { document: doc };
  });
  await expect(openScriptCollaboration(scope, new AbortController().signal)).rejects.toThrow(
    "expired"
  );
  expect(h.get).not.toHaveBeenCalled();
  h.generation = 1;
  h.post.mockClear();
  const c = new AbortController();
  c.abort();
  await expect(openScriptCollaboration(scope, c.signal)).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("persists before dispatch and retries the identical operation after a lost response", async () => {
  h.post.mockImplementationOnce(async () => {
    expect(raw).toContain(command.clientKey);
    throw Error("Lost reply");
  });
  await expect(scriptUpdatePending(scope, "user", storage).submit(command)).rejects.toThrow(
    "Lost reply"
  );
  const reopened = scriptUpdatePending(scope, "user", storage);
  await expect(reopened.submit({ ...command, clientKey: id(8) })).rejects.toThrow("pending");
  await reopened.submit(reopened.read()!);
  expect(h.post.mock.calls[0]).toEqual(h.post.mock.calls[1]);
  expect(reopened.read()).toBeNull();
  expect(h.post.mock.calls[0][1].data).toEqual({
    operationType: "yjs_update",
    clientMutationId: command.clientKey,
    idempotencyKey: `mobile-script:${command.clientKey}`,
    yjsUpdateBase64: command.yjsUpdateBase64,
  });
});
it.each(["documentId", "clientMutationId", "yjsUpdateBase64", "operationType"])(
  "retains update for mismatched %s receipt",
  async (field) => {
    h.post.mockResolvedValue({
      operation: {
        ...op(),
        [field]:
          field === "yjsUpdateBase64" ? "AwQ=" : field === "operationType" ? "comment" : id(9),
      },
    });
    const store = scriptUpdatePending(scope, "user", storage);
    await expect(store.submit(command)).rejects.toThrow();
    expect(store.read()).toEqual(command);
  }
);
it("does not write to a different chapter's document", async () => {
  h.get.mockResolvedValue({ document: { ...doc, storyChapterId: id(8) } });
  await expect(scriptUpdatePending(scope, "user", storage).submit(command)).rejects.toThrow(
    "scope mismatch"
  );
  expect(h.post).not.toHaveBeenCalled();
});
it("does not dispatch when recovery storage fails", async () => {
  storage.write.mockImplementation(() => {
    throw Error("Disk full");
  });
  await expect(scriptUpdatePending(scope, "user", storage).submit(command)).rejects.toThrow(
    "Disk full"
  );
  expect(h.get).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
});
