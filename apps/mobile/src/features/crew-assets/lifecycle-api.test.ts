import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchAssetTrash,
  permanentlyDeleteOrganizationAsset,
  restoreOrganizationAsset,
  trashOrganizationAsset,
  trashedAsset,
} from "./lifecycle-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = () =>
  trashedAsset.parse({
    id: id(1),
    parentId: null,
    name: "Art",
    kind: "folder",
    status: "trashed",
    effectivePermission: "manage",
    media: null,
    linkedStudio: null,
    updatedAt: "2026-09-30T00:00:00Z",
    trashedAt: "2026-09-30T00:00:00Z",
    favorite: false,
  });
const active = () => ({ ...row(), status: "active" as const });
const page = () => ({ items: [row()], source: "trash", parentId: null, nextCursor: null });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("members/me")
      ? { userId: "1", permissions: ["assets.view"] }
      : path.includes("/nodes/")
        ? { node: active() }
        : page()
  );
  vi.mocked(api.post).mockResolvedValue(active());
  vi.mocked(api.delete).mockResolvedValue(undefined);
});
it("reads trash with explicit pagination", async () => {
  expect(await fetchAssetTrash("crew", "1", 1, null, new AbortController().signal)).toEqual(page());
});
it("rejects wrong-account membership", async () => {
  vi.mocked(api.get).mockResolvedValue({ userId: "2", permissions: ["assets.view"] });
  await expect(fetchAssetTrash("crew", "1", 1, null, new AbortController().signal)).rejects.toThrow(
    "account mismatch"
  );
});
it("trashes only after a fresh node read", async () => {
  await trashOrganizationAsset("crew", "1", 1, active());
  expect(api.delete).toHaveBeenCalledWith(`/crews/crew/assets/${id(1)}`, { service: "aurora" });
});
it("rejects changed active snapshots", async () => {
  await expect(
    trashOrganizationAsset("crew", "1", 1, { ...active(), name: "Old" })
  ).rejects.toThrow("changed");
  expect(api.delete).not.toHaveBeenCalled();
});
it("restores a trashed asset", async () => {
  expect(await restoreOrganizationAsset("crew", "1", 1, row())).toMatchObject({
    status: "active",
    id: id(1),
  });
});
it("requires manage permission for permanent deletion", async () => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("members/me")
      ? { userId: "1", permissions: ["assets.view"] }
      : { ...page(), items: [{ ...row(), effectivePermission: "edit" }] }
  );
  await expect(permanentlyDeleteOrganizationAsset("crew", "1", 1, row())).rejects.toThrow(
    "manage permission"
  );
  expect(api.delete).not.toHaveBeenCalled();
});
it("permanently deletes the captured trash item", async () => {
  await permanentlyDeleteOrganizationAsset("crew", "1", 1, row());
  expect(api.delete).toHaveBeenCalledWith(`/crews/crew/assets/${id(1)}/permanent`, {
    service: "aurora",
  });
});
it("does not treat missing trash entries as success", async () => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("members/me")
      ? { userId: "1", permissions: ["assets.view"] }
      : { ...page(), items: [] }
  );
  await expect(restoreOrganizationAsset("crew", "1", 1, row())).rejects.toThrow("no longer");
  expect(api.post).not.toHaveBeenCalled();
});
it("rejects changed trash timestamps", async () => {
  await expect(
    restoreOrganizationAsset("crew", "1", 1, { ...row(), trashedAt: "2026-09-29T00:00:00Z" })
  ).rejects.toThrow("changed");
});
it("continues through empty ACL-filtered pages", async () => {
  let count = 0;
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("members/me")
      ? { userId: "1", permissions: ["assets.view"] }
      : ++count === 1
        ? { ...page(), items: [], nextCursor: id(9) }
        : page()
  );
  await restoreOrganizationAsset("crew", "1", 1, row());
  expect(count).toBe(2);
});
it("rejects pagination loops during fresh lookup", async () => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("members/me")
      ? { userId: "1", permissions: ["assets.view"] }
      : { ...page(), items: [], nextCursor: id(9) }
  );
  await expect(restoreOrganizationAsset("crew", "1", 1, row())).rejects.toThrow("pagination");
});
it("rejects mismatched restore receipts", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...active(), id: id(8) });
  await expect(restoreOrganizationAsset("crew", "1", 1, row())).rejects.toThrow("verified");
});
it("preserves server conflicts without retry", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Restore ancestor first"));
  await expect(restoreOrganizationAsset("crew", "1", 1, row())).rejects.toThrow("ancestor");
  expect(api.post).toHaveBeenCalledOnce();
});
it("rejects account changes during deletion", async () => {
  vi.mocked(api.delete).mockImplementation(async () => {
    h.generation = 2;
  });
  await expect(permanentlyDeleteOrganizationAsset("crew", "1", 1, row())).rejects.toThrow(
    "session"
  );
  expect(api.delete).toHaveBeenCalledOnce();
});
