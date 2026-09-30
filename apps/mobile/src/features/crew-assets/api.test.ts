import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchCrewAssets, fetchCrewAssetContext, fetchCrewAssetAccess } from "./api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const signal = new AbortController().signal;
const node = {
  id,
  parentId: null,
  name: "Clip",
  kind: "file",
  status: "active",
  effectivePermission: "view",
  media: { id: other, kind: "video", contentType: "video/mp4", sizeBytes: 128 },
};
const page = { items: [node], source: "all", parentId: null, nextCursor: id };
beforeEach(() => vi.resetAllMocks());
it("loads the requested folder and passes cancellation and pagination", async () => {
  vi.mocked(api.get).mockResolvedValue({
    ...page,
    parentId: other,
    items: [{ ...node, parentId: other }],
  });
  expect(
    (await fetchCrewAssets("crew/a", { parentId: other }, id, signal)).items[0].media?.id
  ).toBe(other);
  expect(api.get).toHaveBeenCalledWith("/crews/crew%2Fa/assets", {
    service: "aurora",
    signal,
    params: { parentId: other, source: "all", sort: "modified", limit: 50, cursor: id },
  });
});
it("retains empty ACL-filtered pages and rejects a different folder/view", async () => {
  vi.mocked(api.get).mockResolvedValue({ ...page, items: [] });
  expect((await fetchCrewAssets("crew", {}, null, signal)).nextCursor).toBe(id);
  await expect(fetchCrewAssets("crew", { parentId: other }, null, signal)).rejects.toThrow(
    "view mismatch"
  );
  await expect(fetchCrewAssets("crew", { source: "favorites" }, null, signal)).rejects.toThrow(
    "view mismatch"
  );
});
it("rejects invalid input and missing effective permissions", async () => {
  await expect(fetchCrewAssets("crew", { parentId: "bad" }, null, signal)).rejects.toThrow();
  expect(api.get).not.toHaveBeenCalled();
  vi.mocked(api.get).mockResolvedValue({
    ...page,
    items: [{ ...node, effectivePermission: null }],
  });
  await expect(fetchCrewAssets("crew", {}, null, signal)).rejects.toThrow();
});
it("respects unavailable storage and upload capability independently", async () => {
  vi.mocked(api.get).mockResolvedValue({
    storageAvailable: false,
    maxUploadBytes: 1024,
    capabilities: { view: true, upload: false },
  });
  expect(await fetchCrewAssetContext("crew", signal)).toMatchObject({
    storageAvailable: false,
    capabilities: { upload: false },
  });
});
it("resolves original media access on demand with no persisted or raw content URL", async () => {
  vi.mocked(api.get).mockResolvedValue({
    assetId: id,
    variantKey: "original",
    url: "https://cdn.example/file?signature=temporary",
    expiresAt: null,
  });
  expect((await fetchCrewAssetAccess(id, signal)).url).toContain("signature=");
  expect(api.get).toHaveBeenCalledWith(`/media/assets/${id}/access`, {
    service: "aurora",
    signal,
    params: { variantKey: "original" },
  });
});
it.each([
  { assetId: other },
  { variantKey: "poster" },
  { url: "javascript:alert(1)" },
  { url: "https://user:secret@cdn.example/file" },
  { expiresAt: "2000-01-01T00:00:00Z" },
])("rejects mismatched, unsafe or expired media access: %j", async (bad) => {
  vi.mocked(api.get).mockResolvedValue({
    assetId: id,
    variantKey: "original",
    url: "https://cdn.example/file",
    expiresAt: null,
    ...bad,
  });
  await expect(fetchCrewAssetAccess(id, signal)).rejects.toThrow();
});
