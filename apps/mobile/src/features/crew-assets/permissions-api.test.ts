import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchAssetPermissions,
  fetchAssetPermissionMembers,
  fetchAssetPermissionEvents,
  saveAssetPermissions,
} from "./permissions-api";
const h = vi.hoisted(() => ({ generation: 1, globalManage: true }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), put: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const snapshot = () => ({
  accessMode: "inherit" as const,
  permissionVersion: 3,
  effectivePermission: "manage" as const,
  canManage: true,
  grants: [],
});
const signal = () => new AbortController().signal;
const member = (userId: string) => ({ id: userId, crewId: "crew", userId, status: "active" });
const event = () => ({
  id: id(2),
  crewId: "crew",
  nodeId: id(1),
  actorUserId: "1",
  action: "permissions_updated",
  previousMode: "inherit",
  nextMode: "restricted",
  previousVersion: 2,
  nextVersion: 3,
  previousGrants: [],
  nextGrants: [],
  createdAt: "2026-09-30T00:00:00Z",
});
const get = async (path: string) =>
  path.endsWith("members/me")
    ? { userId: "1", permissions: ["assets.view", ...(h.globalManage ? ["assets.manage"] : [])] }
    : path.endsWith("/members")
      ? { items: [member("1"), member("2")], nextCursor: null }
      : path.endsWith("/events")
        ? [event()]
        : snapshot();
const save = (grants = [{ userId: "2", permission: "view" as const }]) =>
  saveAssetPermissions("crew", "1", 1, id(1), snapshot(), { accessMode: "restricted", grants });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.globalManage = true;
  vi.mocked(api.get).mockImplementation(get);
  vi.mocked(api.put).mockImplementation(async (_path, options) => ({
    ...snapshot(),
    ...(options?.data as object),
    permissionVersion: 4,
  }));
});
it("saves with the captured version", async () => {
  await save();
  expect(api.put).toHaveBeenCalledWith(`/crews/crew/assets/${id(1)}/permissions`, {
    service: "aurora",
    data: {
      accessMode: "restricted",
      expectedVersion: 3,
      grants: [{ userId: "2", permission: "view" }],
    },
  });
});
it("retains a delegated manager's own access", async () => {
  h.globalManage = false;
  expect((await save()).grants).toContainEqual({ userId: "1", permission: "manage" });
});
it("clears explicit grants for inherited access", async () => {
  await saveAssetPermissions("crew", "1", 1, id(1), snapshot(), {
    accessMode: "inherit",
    grants: [],
  });
  expect(api.put).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ data: { accessMode: "inherit", grants: [], expectedVersion: 3 } })
  );
});
it("rejects inherited explicit grants without a request", async () => {
  await expect(
    saveAssetPermissions("crew", "1", 1, id(1), snapshot(), {
      accessMode: "inherit",
      grants: [{ userId: "2", permission: "view" }],
    })
  ).rejects.toThrow("Inherited");
  expect(api.get).not.toHaveBeenCalled();
});
it("rejects duplicate grant recipients", async () => {
  await expect(
    save([
      { userId: "2", permission: "view" },
      { userId: "2", permission: "view" },
    ])
  ).rejects.toThrow();
  expect(api.put).not.toHaveBeenCalled();
});
it("rejects inactive recipients", async () => {
  await expect(save([{ userId: "3", permission: "view" }])).rejects.toThrow("active Crew");
  expect(api.put).not.toHaveBeenCalled();
});
it.each(["mismatch", "revoked", "conflict"])("blocks writes on %s", async (kind) => {
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (kind === "mismatch" && path.endsWith("members/me"))
      return { userId: "9", permissions: ["assets.view"] };
    if (path.endsWith("/permissions"))
      return {
        ...snapshot(),
        ...(kind === "revoked"
          ? { canManage: false, effectivePermission: "view" }
          : { permissionVersion: 4 }),
      };
    return get(path);
  });
  await expect(save()).rejects.toThrow();
  expect(api.put).not.toHaveBeenCalled();
});
it("does not write after an account switch during membership pagination", async () => {
  vi.mocked(api.get).mockImplementation(async (path) => {
    const value = await get(path);
    if (path.endsWith("/members")) h.generation++;
    return value;
  });
  await expect(save()).rejects.toThrow("session expired");
  expect(api.put).not.toHaveBeenCalled();
});
it("rejects a late write receipt after account change", async () => {
  vi.mocked(api.put).mockImplementation(async () => {
    h.generation++;
    return {
      ...snapshot(),
      accessMode: "restricted",
      permissionVersion: 4,
      grants: [{ userId: "2", permission: "view" }],
    };
  });
  await expect(save()).rejects.toThrow("session expired");
});
it.each([
  { permissionVersion: 3 },
  { grants: [] },
  { grants: [{ userId: "2", permission: "manage" }] },
])("rejects inconsistent receipts %j", async (patch) => {
  vi.mocked(api.put).mockResolvedValue({
    ...snapshot(),
    accessMode: "restricted",
    permissionVersion: 4,
    grants: [{ userId: "2", permission: "view" }],
    ...patch,
  });
  await expect(save()).rejects.toThrow("could not be verified");
  expect(api.put).toHaveBeenCalledTimes(1);
});
it("propagates server conflicts without retry", async () => {
  vi.mocked(api.put).mockRejectedValue(new Error("CREW_ASSET_PERMISSION_VERSION_CONFLICT"));
  await expect(save()).rejects.toThrow("VERSION_CONFLICT");
  expect(api.put).toHaveBeenCalledTimes(1);
});
it("loads all member pages including empty intermediate pages", async () => {
  let page = 0;
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/members")
      ? [
          { items: [member("1")], nextCursor: "a" },
          { items: [], nextCursor: "b" },
          { items: [member("2")], nextCursor: null },
        ][page++]
      : get(path)
  );
  expect(await fetchAssetPermissionMembers("crew", "1", 1, signal())).toEqual(["1", "2"]);
});
it("rejects cursor loops", async () => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/members") ? { items: [], nextCursor: "a" } : get(path)
  );
  await expect(fetchAssetPermissionMembers("crew", "1", 1, signal())).rejects.toThrow("pagination");
});
it("rejects cross-Crew members", async () => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/members")
      ? { items: [{ ...member("2"), crewId: "other" }], nextCursor: null }
      : get(path)
  );
  await expect(fetchAssetPermissionMembers("crew", "1", 1, signal())).rejects.toThrow(
    "scope mismatch"
  );
});
it("loads scoped history", async () => {
  expect(await fetchAssetPermissionEvents("crew", "1", 1, id(1), signal())).toEqual([event()]);
});
it("rejects cross-asset history", async () => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/events") ? [{ ...event(), nodeId: id(3) }] : get(path)
  );
  await expect(fetchAssetPermissionEvents("crew", "1", 1, id(1), signal())).rejects.toThrow(
    "scope mismatch"
  );
});
it("does not request history for viewers", async () => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/permissions")
      ? { ...snapshot(), canManage: false, effectivePermission: "view" }
      : get(path)
  );
  await expect(fetchAssetPermissionEvents("crew", "1", 1, id(1), signal())).rejects.toThrow(
    "manage permission"
  );
  expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining("/events"), expect.anything());
});
it("rejects cancelled reads before network access", async () => {
  const c = new AbortController();
  c.abort();
  await expect(fetchAssetPermissions("crew", "1", 1, id(1), c.signal)).rejects.toThrow("cancelled");
  expect(api.get).not.toHaveBeenCalled();
});
