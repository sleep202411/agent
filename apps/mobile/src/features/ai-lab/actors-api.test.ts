import { beforeEach, expect, it, vi } from "vitest";
import { listAiActors, unlockAiActor, requestActorUse, type ActorProjectScope } from "./actors-api";
const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const clientKey = "44444444-4444-4444-8444-444444444444";
const mediaAssetId = "55555555-5555-4555-8555-555555555555";
const url = `/aurora/media/assets/${mediaAssetId}/content`;
const scope = { kind: "platform" as const, workspaceId, projectId, generation: 1 };
const intent = { actorId, clientKey };
const project = { id: projectId, workspaceId, status: "active", role: "editor" };
const receipt = { actorId, nodeId: clientKey, name: "Actor", mediaAssetId, url };
const row = { id: actorId, name: "Actor", photoUrl: url, unlocked: false };
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue({ project });
  h.post.mockResolvedValue(receipt);
});
it("reads a bounded workspace page without losing its continuation", async () => {
  h.get.mockResolvedValue({ items: [row], hasMore: true });
  expect(await listAiActors(workspaceId, 2, 1, signal())).toEqual({ items: [row], hasMore: true });
  expect(h.get).toHaveBeenCalledWith(
    "/ai-actors",
    expect.objectContaining({ params: { workspaceId, page: 2 }, retry: false })
  );
});
it.each([0, -1, 1.5, 100001])("rejects invalid page %s before dispatch", async (page) => {
  await expect(listAiActors(workspaceId, page, 1, signal())).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
});
it("rejects duplicate actor identities", async () => {
  h.get.mockResolvedValue({ items: [row, row], hasMore: false });
  await expect(listAiActors(workspaceId, 1, 1, signal())).rejects.toThrow("Duplicate");
});
it.each([
  "https://other.example/photo",
  "//other.example/photo",
  "/aurora/media/assets/not-an-id/content",
])("rejects non-contract photo path %s", async (photoUrl) => {
  h.get.mockResolvedValue({ items: [{ ...row, photoUrl }], hasMore: false });
  await expect(listAiActors(workspaceId, 1, 1, signal())).rejects.toThrow();
});
it("keeps unlock separate from canvas use", async () => {
  h.post.mockResolvedValue({ actorId, workspaceId });
  expect(await unlockAiActor(workspaceId, actorId, 1, signal())).toEqual({ actorId, workspaceId });
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.post).toHaveBeenCalledWith(
    `/ai-actors/${actorId}/unlock`,
    expect.objectContaining({ data: { workspaceId }, retry: false })
  );
});
it("rejects a mismatched unlock receipt", async () => {
  h.post.mockResolvedValue({ actorId, workspaceId: projectId });
  await expect(unlockAiActor(workspaceId, actorId, 1, signal())).rejects.toThrow("receipt");
});
it("reuses the caller request identity after an uncertain use response", async () => {
  h.post.mockRejectedValueOnce(Error("reply lost"));
  await expect(requestActorUse(scope, intent, signal())).rejects.toThrow("reply lost");
  expect(await requestActorUse(scope, intent, signal())).toEqual(receipt);
  expect(h.post.mock.calls.map((call) => call[1].data)).toEqual([
    { projectId, requestId: clientKey },
    { projectId, requestId: clientKey },
  ]);
});
it.each([
  { role: "viewer" },
  { role: undefined },
  { workspaceId: projectId },
  { id: workspaceId },
  { status: "archived" },
])("rejects invalid fresh project access %j", async (patch) => {
  h.get.mockResolvedValue({ project: { ...project, ...patch } });
  await expect(requestActorUse(scope, intent, signal())).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("never routes Story project identities through the platform actor endpoint", async () => {
  await expect(
    requestActorUse({ ...scope, kind: "story" } as unknown as ActorProjectScope, intent, signal())
  ).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
});
it.each([{ actorId: projectId }, { nodeId: projectId }, { mediaAssetId: projectId }])(
  "rejects a mismatched use receipt %j",
  async (patch) => {
    h.post.mockResolvedValue({ ...receipt, ...patch });
    await expect(requestActorUse(scope, intent, signal())).rejects.toThrow("receipt");
  }
);
it("rejects a changed session before mutation", async () => {
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return { project };
  });
  await expect(requestActorUse(scope, intent, signal())).rejects.toThrow("session");
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects a late use receipt after logout", async () => {
  h.post.mockImplementation(async () => {
    h.generation = 2;
    return receipt;
  });
  await expect(requestActorUse(scope, intent, signal())).rejects.toThrow("session");
});
it("does not dispatch an aborted action", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(requestActorUse(scope, intent, controller.signal)).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
});
it("preserves the server's photo-change error for explicit recovery", async () => {
  const error = Object.assign(Error("The actor photo changed. Start a new use."), {
    code: "AI_ACTOR_PHOTO_CHANGED",
  });
  h.post.mockRejectedValue(error);
  await expect(requestActorUse(scope, intent, signal())).rejects.toBe(error);
});
