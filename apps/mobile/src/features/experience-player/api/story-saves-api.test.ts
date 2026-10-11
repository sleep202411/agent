import { beforeEach, expect, it, vi } from "vitest";

import { createStorySavesApi } from "./story-saves-api";

const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, put: h.put, delete: h.delete } }));
const save = {
  gameId: "film/1",
  chapterId: "chapter?2",
  contentVersion: "v1",
  state: { sceneId: "scene" },
  events: [],
  playback: null,
  revision: 3,
  updatedAt: "2026-10-05T00:00:00.000Z",
};
const input = {
  contentVersion: "v1",
  state: { sceneId: "scene" },
  events: [],
  expectedRevision: 3,
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue({ save, revision: 3 });
  h.put.mockResolvedValue({ saved: true, updatedAt: save.updatedAt, revision: 4 });
  h.delete.mockResolvedValue({ cleared: true, revision: 4 });
});
it("reads an owned chapter and encodes the game separately from query parameters", async () => {
  expect(await createStorySavesApi().read(save.gameId, save.chapterId)).toEqual({
    save,
    revision: 3,
  });
  expect(h.get).toHaveBeenCalledWith(
    "/story-saves/film%2F1/save",
    expect.objectContaining({
      service: "aurora",
      retry: false,
      params: { chapterId: save.chapterId },
    })
  );
});
it("preserves cleared-slot revisions and omits the single-chapter parameter", async () => {
  h.get.mockResolvedValue({ save: null, revision: 9 });
  expect(await createStorySavesApi().read("film")).toEqual({ save: null, revision: 9 });
  expect(h.get.mock.calls[0][1].params).toEqual({});
});
it("reads the latest chapter pointer without requiring journey history", async () => {
  h.get.mockResolvedValue(save);
  expect(await createStorySavesApi().latest(save.gameId)).toEqual(save);
  h.get.mockResolvedValue(null);
  expect(await createStorySavesApi().latest(save.gameId)).toBeNull();
});
it.each([
  { save: { ...save, gameId: "other" }, revision: 3 },
  { save: { ...save, chapterId: "other" }, revision: 3 },
  { save, revision: 4 },
  { save: null, revision: -1 },
  undefined,
])("rejects malformed or unrelated slot responses", async (value) => {
  h.get.mockResolvedValue(value);
  await expect(createStorySavesApi().read(save.gameId, save.chapterId)).rejects.toThrow();
});
it("conditionally saves and clears without automatic replay", async () => {
  const client = createStorySavesApi();
  await client.write(save.gameId, save.chapterId, input);
  expect(h.put.mock.calls[0][1]).toMatchObject({ data: input, retry: false });
  await client.clear(save.gameId, save.chapterId, 3);
  expect(h.delete.mock.calls[0][1]).toMatchObject({
    retry: false,
    params: { chapterId: save.chapterId, expectedRevision: 3 },
  });
});
it.each([3, 5, -1, 1.5])("rejects a mutation receipt with revision %s", async (revision) => {
  h.put.mockResolvedValue({ saved: true, updatedAt: save.updatedAt, revision });
  h.delete.mockResolvedValue({ cleared: true, revision });
  const client = createStorySavesApi();
  await expect(client.write(save.gameId, save.chapterId, input)).rejects.toThrow();
  await expect(client.clear(save.gameId, save.chapterId, 3)).rejects.toThrow();
});
it.each(["read", "latest", "write", "clear"] as const)(
  "rejects stale-account %s calls and responses",
  async (method) => {
    const client = createStorySavesApi();
    const invoke = () =>
      method === "read"
        ? client.read(save.gameId, save.chapterId)
        : method === "latest"
          ? client.latest(save.gameId)
          : method === "write"
            ? client.write(save.gameId, save.chapterId, input)
            : client.clear(save.gameId, save.chapterId, 3);
    const mock = method === "write" ? h.put : method === "clear" ? h.delete : h.get;
    mock.mockImplementation(async () => {
      h.generation++;
      return null;
    });
    await expect(invoke()).rejects.toThrow("session changed");
    await expect(invoke()).rejects.toThrow("session changed");
    expect(mock).toHaveBeenCalledOnce();
  }
);
it("rejects cancellation before and after transport", async () => {
  const controller = new AbortController();
  h.get.mockImplementation(async () => {
    controller.abort();
    return null;
  });
  const client = createStorySavesApi();
  await expect(client.latest("film", controller.signal)).rejects.toThrow();
  await expect(client.latest("film", controller.signal)).rejects.toThrow();
  expect(h.get).toHaveBeenCalledOnce();
});
it("preserves server conflicts and never treats them as empty saves", async () => {
  const conflict = Object.assign(new Error("Save has changed"), { status: 409 });
  h.get.mockRejectedValue(conflict);
  h.put.mockRejectedValue(conflict);
  const client = createStorySavesApi();
  await expect(client.read("film")).rejects.toBe(conflict);
  await expect(client.write("film", "", input)).rejects.toBe(conflict);
  expect(h.put).toHaveBeenCalledOnce();
});
it("rejects invalid revisions before any write", async () => {
  const client = createStorySavesApi();
  await expect(
    client.write("film", "", { ...input, expectedRevision: 2_147_483_647 })
  ).rejects.toThrow();
  await expect(client.clear("film", "", -1)).rejects.toThrow();
  expect(h.put).not.toHaveBeenCalled();
  expect(h.delete).not.toHaveBeenCalled();
});
