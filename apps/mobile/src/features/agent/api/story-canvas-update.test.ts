import { beforeEach, expect, it, vi } from "vitest";
import { canvasUpdatePending } from "./story-canvas-update";
const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { projectId: id(1), documentId: id(2), generation: 1 };
const command = { clientKey: id(3), yjsUpdateBase64: "AQI=" };
const doc = {
  id: id(2),
  owner: { kind: "story_project", projectId: id(1) },
  storyProjectId: id(1),
  platformProjectId: null,
  storyChapterId: null,
  type: "canvas",
  status: "active",
  currentSequence: 1,
  snapshotSequence: 1,
  crdtStateBase64: "AAA=",
};
const receipt = {
  id: id(4),
  documentId: id(2),
  sequence: 2,
  operationType: "yjs_update",
  clientMutationId: id(3),
  yjsUpdateBase64: "AQI=",
};
let saved: string | null, controller: AbortController;
const storage = {
  read: () => saved,
  write: vi.fn((value: string) => {
    saved = value;
  }),
};
const client = () => canvasUpdatePending(scope, "user", storage);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  saved = null;
  controller = new AbortController();
  storage.write.mockImplementation((value) => {
    saved = value;
  });
  h.get.mockResolvedValue({ document: doc });
  h.post.mockResolvedValue({ operation: receipt });
});
it("persists before sending and clears only after a matching receipt", async () => {
  const c = client();
  h.post.mockImplementation(async () => {
    expect(c.read()).toEqual(command);
    return { operation: receipt };
  });
  expect(await c.submit(command, controller.signal)).toEqual(receipt);
  expect(c.read()).toBeNull();
  expect(h.post).toHaveBeenCalledWith(
    `/documents/${id(2)}/operations`,
    expect.objectContaining({
      retry: false,
      data: {
        operationType: "yjs_update",
        clientMutationId: id(3),
        idempotencyKey: `mobile-canvas:${id(3)}`,
        yjsUpdateBase64: "AQI=",
      },
    })
  );
});
it("restores and retries exact bytes/key after a lost reply", async () => {
  h.post.mockRejectedValueOnce(Error("Reply lost"));
  await expect(client().submit(command, controller.signal)).rejects.toThrow("Reply lost");
  const reopened = client();
  expect(reopened.read()).toEqual(command);
  await reopened.submit(reopened.read()!, controller.signal);
  expect(h.post.mock.calls[0][1].data).toEqual(h.post.mock.calls[1][1].data);
  expect(reopened.read()).toBeNull();
});
it.each([
  { documentId: id(9) },
  { clientMutationId: id(9) },
  { yjsUpdateBase64: "AAA=" },
  { operationType: "patch" },
  { sequence: 0 },
])("retains the pending edit on a mismatched receipt %s", async (patch) => {
  h.post.mockResolvedValue({ operation: { ...receipt, ...patch } });
  const c = client();
  await expect(c.submit(command, controller.signal)).rejects.toThrow();
  expect(c.read()).toEqual(command);
});
it.each([
  { storyProjectId: id(9) },
  { owner: { kind: "story_project", projectId: id(9) } },
  { storyChapterId: id(9) },
  { type: "script" },
  { status: "archived" },
])("rejects a foreign/inactive document before writing %s", async (patch) => {
  h.get.mockResolvedValue({ document: { ...doc, ...patch } });
  await expect(client().submit(command, controller.signal)).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it.each(["account", "abort"])(
  "does not write after %s retirement during preflight",
  async (reason) => {
    h.get.mockImplementation(async () => {
      if (reason === "account") h.generation++;
      else controller.abort();
      return { document: doc };
    });
    await expect(client().submit(command, controller.signal)).rejects.toThrow();
    expect(h.post).not.toHaveBeenCalled();
    expect(saved).toContain(command.clientKey);
  }
);
it("retains uncertain writes when aborted after sending", async () => {
  h.post.mockImplementation(async () => {
    controller.abort();
    return { operation: receipt };
  });
  await expect(client().submit(command, controller.signal)).rejects.toThrow();
  expect(client().read()).toEqual(command);
});
it("does not write if durable storage is unavailable", async () => {
  storage.write.mockImplementation(() => {
    throw Error("Storage unavailable");
  });
  await expect(client().submit(command, controller.signal)).rejects.toThrow("Storage unavailable");
  expect(h.get).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
});
it("does not replace an uncertain edit with another command", async () => {
  h.post.mockRejectedValue(Error("Reply lost"));
  const c = client();
  await expect(c.submit(command, controller.signal)).rejects.toThrow();
  await expect(c.submit({ ...command, clientKey: id(8) }, controller.signal)).rejects.toThrow(
    "pending"
  );
  expect(h.post).toHaveBeenCalledOnce();
  expect(c.read()).toEqual(command);
});
it("preserves permission failures and leaves an explicit retry intent", async () => {
  h.post.mockRejectedValue(Error("Editing permission required"));
  const c = client();
  await expect(c.submit(command, controller.signal)).rejects.toThrow("Editing permission required");
  expect(c.read()).toEqual(command);
  expect(h.post).toHaveBeenCalledOnce();
});
it("does not clear the original account's intent after a late receipt", async () => {
  h.post.mockImplementation(async () => {
    h.generation++;
    return { operation: receipt };
  });
  await expect(client().submit(command, controller.signal)).rejects.toThrow("session expired");
  expect(JSON.parse(saved!).intent).toEqual(command);
});
it("keeps recovery possible when clearing storage fails after server success", async () => {
  storage.write.mockImplementation((value) => {
    if (JSON.parse(value).intent === null) throw Error("Storage unavailable");
    saved = value;
  });
  const c = client();
  await expect(c.submit(command, controller.signal)).rejects.toThrow("Storage unavailable");
  expect(c.read()).toEqual(command);
  storage.write.mockImplementation((value) => {
    saved = value;
  });
  await c.submit(command, controller.signal);
  expect(h.post.mock.calls[1][1].data).toEqual(h.post.mock.calls[0][1].data);
  expect(c.read()).toBeNull();
});
