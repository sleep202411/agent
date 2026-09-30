import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchStudioMediaOptions,
  importStudioMedia,
  setStudioMediaLink,
  studioAssetNode,
} from "./studio-media-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = { projectId: null, storyProjectId: null };
const options = () => ({
  workspaceId: id(1),
  projects: [],
  items: [
    {
      id: id(2),
      kind: "video",
      name: "Scene",
      contentType: "video/mp4",
      createdAt: "2026-09-30T00:00:00Z",
    },
  ],
});
const node = () =>
  studioAssetNode.parse({
    id: id(3),
    parentId: null,
    name: "Scene",
    kind: "file",
    status: "active",
    effectivePermission: "manage",
    linkedStudio: null,
    media: { id: id(4) },
  });
const imported = () => ({
  ...node(),
  media: { id: id(2) },
  linkedStudio: { mediaAssetId: id(2), ...source },
});
const read = () => fetchStudioMediaOptions("crew", "1", 1, source, new AbortController().signal);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/members/me")
      ? { userId: "1", permissions: ["assets.view"] }
      : path.endsWith("/context")
        ? { capabilities: { upload: true } }
        : path.includes("/nodes/")
          ? { node: node(), path: [] }
          : options()
  );
  vi.mocked(api.post).mockResolvedValue({ items: [imported()] });
  vi.mocked(api.patch).mockResolvedValue({
    ...node(),
    linkedStudio: { mediaAssetId: id(2), ...source },
  });
});
it("reads scoped options without retaining preview URLs", async () => {
  expect(await read()).toEqual(options());
});
it("requires the matching member", async () => {
  vi.mocked(api.get).mockResolvedValue({ userId: "2", permissions: ["assets.view"] });
  await expect(read()).rejects.toThrow("account mismatch");
});
it("requires view permission", async () => {
  vi.mocked(api.get).mockResolvedValue({ userId: "1", permissions: [] });
  await expect(read()).rejects.toThrow("access");
});
it("rejects simultaneous canvas and story filters", async () => {
  await expect(
    fetchStudioMediaOptions(
      "crew",
      "1",
      1,
      { projectId: id(5), storyProjectId: id(6) },
      new AbortController().signal
    )
  ).rejects.toThrow("one Studio project");
  expect(api.get).not.toHaveBeenCalled();
});
it("imports selected media with explicit destination and source", async () => {
  expect(await importStudioMedia("crew", "1", 1, id(1), source, null, [id(2)])).toEqual([
    imported(),
  ]);
  expect(api.post).toHaveBeenCalledWith("/crews/crew/assets/link-studio-media", {
    service: "aurora",
    data: { ...source, parentId: null, mediaAssetIds: [id(2)] },
  });
});
it("accepts empty receipts when media already exists", async () => {
  vi.mocked(api.post).mockResolvedValue({ items: [] });
  await expect(importStudioMedia("crew", "1", 1, id(1), source, null, [id(2)])).resolves.toEqual(
    []
  );
});
it("rejects a changed workspace", async () => {
  await expect(importStudioMedia("crew", "1", 1, id(9), source, null, [id(2)])).rejects.toThrow(
    "workspace changed"
  );
  expect(api.post).not.toHaveBeenCalled();
});
it("rejects unavailable selected media", async () => {
  await expect(importStudioMedia("crew", "1", 1, id(1), source, null, [id(9)])).rejects.toThrow(
    "no longer available"
  );
});
it("enforces selection uniqueness and the 40 item limit", async () => {
  await expect(
    importStudioMedia("crew", "1", 1, id(1), source, null, [id(2), id(2)])
  ).rejects.toThrow();
  await expect(
    importStudioMedia(
      "crew",
      "1",
      1,
      id(1),
      source,
      null,
      Array.from({ length: 41 }, (_, n) => id(n + 1))
    )
  ).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("rejects imports into a file", async () => {
  await expect(importStudioMedia("crew", "1", 1, id(1), source, id(3), [id(2)])).rejects.toThrow(
    "destination folder"
  );
});
it("verifies imported media identities", async () => {
  vi.mocked(api.post).mockResolvedValue({ items: [{ ...imported(), media: { id: id(9) } }] });
  await expect(importStudioMedia("crew", "1", 1, id(1), source, null, [id(2)])).rejects.toThrow(
    "verified"
  );
});
it("binds a link without changing the file media", async () => {
  const result = await setStudioMediaLink("crew", "1", 1, node(), id(1), source, id(2));
  expect(result.media?.id).toBe(id(4));
  expect(result.linkedStudio?.mediaAssetId).toBe(id(2));
});
it("unlinks even without a linked workspace", async () => {
  vi.mocked(api.patch).mockResolvedValue(node());
  await setStudioMediaLink("crew", "1", 1, node(), null, source, null);
  expect(api.patch).toHaveBeenCalledWith(`/crews/crew/assets/${id(3)}/studio-link`, {
    service: "aurora",
    data: { ...source, mediaAssetId: null },
  });
});
it("rejects observed file changes", async () => {
  await expect(
    setStudioMediaLink("crew", "1", 1, { ...node(), media: { id: id(8) } }, id(1), source, id(2))
  ).rejects.toThrow("asset changed");
  expect(api.patch).not.toHaveBeenCalled();
});
it("rejects a link receipt that replaces file contents", async () => {
  vi.mocked(api.patch).mockResolvedValue(imported());
  await expect(setStudioMediaLink("crew", "1", 1, node(), id(1), source, id(2))).rejects.toThrow(
    "verified"
  );
});
it("rejects account changes during mutation without retry", async () => {
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation = 2;
    return { items: [] };
  });
  await expect(importStudioMedia("crew", "1", 1, id(1), source, null, [id(2)])).rejects.toThrow(
    "session"
  );
  expect(api.post).toHaveBeenCalledOnce();
});
