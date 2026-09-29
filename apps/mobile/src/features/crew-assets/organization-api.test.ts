import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  assetName,
  createOrganizationFolder,
  eligibleMoveFolders,
  fetchOrganizationNode,
  organizationNode,
  setOrganizationFavorite,
  updateOrganizationNode,
  type OrganizationFolder,
} from "./organization-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = () =>
  organizationNode.parse({
    id: id(1),
    parentId: null,
    name: "Art",
    kind: "folder",
    status: "active",
    effectivePermission: "manage",
    media: null,
    linkedStudio: null,
    updatedAt: "2026-09-30T00:00:00Z",
    favorite: false,
  });
const folder = (n: number, parentId: string | null = null): OrganizationFolder => ({
  id: id(n),
  parentId,
  name: String(n),
  effectivePermission: "upload",
});
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("members/me")
      ? { userId: "1", permissions: ["assets.view"] }
      : path.endsWith("context")
        ? { capabilities: { upload: true } }
        : path.endsWith("folders")
          ? [folder(1), folder(2)]
          : { node: row(), path: [] }
  );
  vi.mocked(api.post).mockResolvedValue({ ...row(), id: id(3), name: "New" });
  vi.mocked(api.patch).mockResolvedValue({
    ...row(),
    name: "New",
    updatedAt: "2026-09-30T00:00:01Z",
  });
  vi.mocked(api.put).mockResolvedValue({ favorite: true });
});
it.each(["", ".", "..", "a/b", "x".repeat(257)])("rejects invalid name %s", (name) => {
  expect(assetName.safeParse(name).success).toBe(false);
});
it("trims names", () => {
  expect(assetName.parse(" Art ")).toBe("Art");
});
it("loads scoped node details", async () => {
  expect(await fetchOrganizationNode("crew", "1", 1, id(1), new AbortController().signal)).toEqual(
    row()
  );
});
it("rejects account mismatch", async () => {
  vi.mocked(api.get).mockResolvedValue({ userId: "2", permissions: ["assets.view"] });
  await expect(createOrganizationFolder("crew", "1", 1, "New", null)).rejects.toThrow(
    "account mismatch"
  );
  expect(api.post).not.toHaveBeenCalled();
});
it("creates a root folder after permission checks", async () => {
  await createOrganizationFolder("crew", "1", 1, " New ", null);
  expect(api.post).toHaveBeenCalledWith("/crews/crew/assets/folders", {
    service: "aurora",
    data: { name: "New", parentId: null },
  });
});
it("rejects root creation without upload permission", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ userId: "1", permissions: ["assets.view"] })
    .mockResolvedValueOnce({ capabilities: { upload: false } });
  await expect(createOrganizationFolder("crew", "1", 1, "New", null)).rejects.toThrow(
    "Root asset upload"
  );
  expect(api.post).not.toHaveBeenCalled();
});
it("sends changed rename and captured timestamp only", async () => {
  await updateOrganizationNode("crew", "1", 1, row(), { name: "New", parentId: null });
  expect(api.patch).toHaveBeenCalledWith(`/crews/crew/assets/${id(1)}`, {
    service: "aurora",
    data: { name: "New", expectedUpdatedAt: row().updatedAt },
  });
});
it("skips no-op changes", async () => {
  await updateOrganizationNode("crew", "1", 1, row(), { name: "Art", parentId: null });
  expect(api.patch).not.toHaveBeenCalled();
});
it("rejects stale captured timestamps", async () => {
  await expect(
    updateOrganizationNode(
      "crew",
      "1",
      1,
      { ...row(), updatedAt: "2026-09-29T00:00:00Z" },
      { name: "New", parentId: null }
    )
  ).rejects.toThrow("changed");
  expect(api.patch).not.toHaveBeenCalled();
});
it("rejects self moves", async () => {
  await expect(
    updateOrganizationNode("crew", "1", 1, row(), { name: "Art", parentId: id(1) })
  ).rejects.toThrow("contain itself");
});
it("excludes descendants, cycles, missing ancestors and view-only destinations", () => {
  const rows = [
    folder(1),
    folder(2, id(1)),
    folder(3, id(2)),
    folder(4),
    folder(5, id(6)),
    folder(6, id(5)),
    folder(7, id(9)),
    { ...folder(8), effectivePermission: "view" as const },
  ];
  expect(eligibleMoveFolders(rows, id(1)).map((r) => r.id)).toEqual([id(4)]);
});
it("rejects moving a folder under its descendant", async () => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("members/me")
      ? { userId: "1", permissions: ["assets.view"] }
      : path.endsWith("folders")
        ? [folder(1), folder(2, id(1))]
        : { node: row() }
  );
  await expect(
    updateOrganizationNode("crew", "1", 1, row(), { name: "Art", parentId: id(2) })
  ).rejects.toThrow("outside this folder");
  expect(api.patch).not.toHaveBeenCalled();
});
it("rejects stale update receipts", async () => {
  vi.mocked(api.patch).mockResolvedValue({ ...row(), name: "New" });
  await expect(
    updateOrganizationNode("crew", "1", 1, row(), { name: "New", parentId: null })
  ).rejects.toThrow("verified");
});
it("sets account-scoped favorite explicitly", async () => {
  expect(await setOrganizationFavorite("crew", "1", 1, id(1), true)).toBe(true);
  expect(api.put).toHaveBeenCalledWith(`/crews/crew/assets/${id(1)}/favorite`, {
    service: "aurora",
    data: { favorite: true },
  });
});
it("rejects mismatched favorite receipts", async () => {
  await expect(setOrganizationFavorite("crew", "1", 1, id(1), false)).rejects.toThrow("verified");
});
it("rejects account changes during writes", async () => {
  vi.mocked(api.put).mockImplementation(async () => {
    h.generation = 2;
    return { favorite: true };
  });
  await expect(setOrganizationFavorite("crew", "1", 1, id(1), true)).rejects.toThrow("session");
  expect(api.put).toHaveBeenCalledOnce();
});
