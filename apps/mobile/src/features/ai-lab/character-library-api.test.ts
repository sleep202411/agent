import { beforeEach, it, expect, vi } from "vitest";
import {
  loadCharacterLibrary,
  loadLibraryCharacter,
  prepareLibraryCommand,
  submitLibraryCommand,
  characterLibraryBox,
} from "./character-library-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  workspaces: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, post: h.post, patch: h.patch, delete: h.delete },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/features/agent/api/studio-projects-api", () => ({
  loadAgentWorkspaces: h.workspaces,
  canCreateStudioProject: (w: { role: string }) => ["editor", "admin", "owner"].includes(w.role),
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(ns + user + id) ?? null,
    write: (v: string) => h.records.set(ns + user + id, v),
  }),
}));
const id = "11111111-1111-4111-8111-111111111111",
  workspaceId = "22222222-2222-4222-8222-222222222222",
  key = "33333333-3333-4333-8333-333333333333";
const character = {
  id,
  workspaceId,
  kind: "virtual" as const,
  name: "Hero",
  description: null,
  coverAssetId: null,
  status: "active" as const,
  createdByUserId: "actor",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  mediaCounts: { image: 0, video: 0, audio: 0 },
};
const detail = { ...character, media: [] };
const signal = () => new AbortController().signal;
const command = () =>
  prepareLibraryCommand({
    action: "create",
    clientKey: key,
    workspaceId,
    fields: { name: "Hero", description: "" },
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.records.clear();
  h.workspaces.mockResolvedValue([{ id: workspaceId, role: "editor" }]);
  h.get.mockResolvedValue(detail);
  h.post.mockResolvedValue(detail);
  h.patch.mockResolvedValue(detail);
  h.delete.mockResolvedValue({ removed: true });
});
it("validates workspace-scoped lists, duplicates and selected detail identity", async () => {
  h.get.mockResolvedValueOnce({ items: [character] });
  expect(await loadCharacterLibrary(workspaceId, 1, signal())).toEqual([character]);
  for (const items of [[{ ...character, workspaceId: id }], [character, character]]) {
    h.get.mockResolvedValueOnce({ items });
    await expect(loadCharacterLibrary(workspaceId, 1, signal())).rejects.toThrow("workspace");
  }
  h.get.mockResolvedValueOnce({ ...detail, id: key });
  await expect(loadLibraryCharacter(workspaceId, id, 1, signal())).rejects.toThrow("selection");
});
it("trims and bounds fields, checks fresh permission and persists before virtual creation", async () => {
  expect(
    prepareLibraryCommand({
      ...command(),
      action: "create",
      fields: { name: " Hero ", description: "  " },
    }).action
  ).toBe("create");
  expect(() =>
    prepareLibraryCommand({
      ...command(),
      action: "create",
      fields: { name: " ", description: "" },
    })
  ).toThrow();
  expect(() =>
    prepareLibraryCommand({
      ...command(),
      action: "create",
      fields: { name: "Hero", description: "x".repeat(201) },
    })
  ).toThrow();
  h.workspaces.mockResolvedValueOnce([{ id: workspaceId, role: "viewer" }]);
  await expect(submitLibraryCommand(command(), "actor", 1, signal())).rejects.toThrow("editor");
  expect(h.post).not.toHaveBeenCalled();
  h.post.mockImplementation(async (path, { data, retry }) => {
    expect(path).toBe("/characters");
    expect(data).toEqual({ workspaceId, kind: "virtual", name: "Hero", description: "" });
    expect(retry).toBe(false);
    expect(characterLibraryBox("actor", 1, workspaceId).read()).toEqual(command());
    return detail;
  });
  await submitLibraryCommand(command(), "actor", 1, signal());
  expect(characterLibraryBox("actor", 1, workspaceId).read()).toBeNull();
});
it("checks the original snapshot before edits and validates the returned fields", async () => {
  const edit = prepareLibraryCommand({
    action: "edit",
    clientKey: key,
    workspaceId,
    before: character,
    fields: { name: "New Hero", description: "New" },
  });
  h.get.mockResolvedValueOnce({ ...detail, updatedAt: "changed" });
  await expect(submitLibraryCommand(edit, "actor", 1, signal())).rejects.toThrow("changed");
  expect(h.patch).not.toHaveBeenCalled();
  h.patch.mockResolvedValueOnce({ ...detail, name: "New Hero", description: "New" });
  await submitLibraryCommand(edit, "actor", 1, signal());
  expect(h.patch).toHaveBeenCalledWith(
    `/characters/${id}`,
    expect.objectContaining({ data: { name: "New Hero", description: "New" }, retry: false })
  );
  h.patch.mockResolvedValueOnce(detail);
  await expect(submitLibraryCommand(edit, "actor", 1, signal())).rejects.toThrow("receipt");
  expect(characterLibraryBox("actor", 1, workspaceId).read()).not.toBeNull();
});
it("retains lost create results across restart without guessing from a matching name", async () => {
  h.post.mockRejectedValueOnce(Error("Lost receipt"));
  await expect(submitLibraryCommand(command(), "actor", 1, signal())).rejects.toThrow("Lost");
  expect(characterLibraryBox("another", 1, workspaceId).read()).toBeNull();
  expect(characterLibraryBox("actor", 1, workspaceId).read()).toEqual(command());
  await expect(submitLibraryCommand(command(), "actor", 1, signal())).rejects.toThrow("original");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("checks removal authority and never replays a lost likeness revocation as tombstone deletion", async () => {
  const before = { ...character, kind: "real_person" as const };
  h.get.mockResolvedValue({ ...before, media: [] });
  const remove = prepareLibraryCommand({ action: "remove", clientKey: key, workspaceId, before });
  await expect(submitLibraryCommand(remove, "other", 1, signal())).rejects.toThrow("creator");
  expect(h.delete).not.toHaveBeenCalled();
  h.delete.mockRejectedValueOnce(Error("Lost revoke receipt"));
  await expect(submitLibraryCommand(remove, "actor", 1, signal())).rejects.toThrow("Lost");
  h.get.mockResolvedValue({ ...before, status: "revoked", media: [] });
  await expect(submitLibraryCommand(remove, "actor", 1, signal())).rejects.toThrow("original");
  expect(h.delete).toHaveBeenCalledTimes(1);
});
it("keeps malformed removal and late-account receipts pending", async () => {
  const remove = prepareLibraryCommand({
    action: "remove",
    clientKey: key,
    workspaceId,
    before: character,
  });
  h.delete.mockResolvedValueOnce({ ok: true });
  await expect(submitLibraryCommand(remove, "actor", 1, signal())).rejects.toThrow();
  expect(characterLibraryBox("actor", 1, workspaceId).read()).not.toBeNull();
  h.records.clear();
  h.post.mockImplementation(async () => {
    h.generation = 2;
    return detail;
  });
  await expect(submitLibraryCommand(command(), "actor", 1, signal())).rejects.toThrow();
  h.generation = 1;
  expect(characterLibraryBox("actor", 1, workspaceId).read()).not.toBeNull();
});
