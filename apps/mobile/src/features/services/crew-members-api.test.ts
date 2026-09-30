import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchCrewMemberPage, removeCrewMember } from "./crew-members-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), delete: vi.fn() } }));
const member = {
  id: "member",
  crewId: "crew",
  userId: "1",
  status: "active" as const,
  isOwner: true,
  version: 1,
  joinedAt: "2026-09-30T00:00:00Z",
  positions: [],
  policyKeys: [],
};
const page = { items: [member], nextCursor: null, total: 1 };
const read = (cursor: string | null = null) =>
  fetchCrewMemberPage("crew", "1", 1, cursor, new AbortController().signal);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/me") ? { userId: "1", permissions: ["members.view"] } : page
  );
});
it("loads member-scoped pages", async () => {
  expect(await read()).toEqual({
    ...page,
    canManageMembers: false,
    canManagePermissions: false,
    canTransferOwnership: false,
  });
  expect(api.get).toHaveBeenLastCalledWith(
    "/crews/crew/members",
    expect.objectContaining({ params: { limit: 50 } })
  );
});
it("sends pagination cursor", async () => {
  await read("previous");
  expect(api.get).toHaveBeenLastCalledWith(
    "/crews/crew/members",
    expect.objectContaining({ params: { limit: 50, cursor: "previous" } })
  );
});
it.each([
  { userId: "2", permissions: ["members.view"] },
  { userId: "1", permissions: [] },
])("rejects invalid membership %j", async (access) => {
  vi.mocked(api.get).mockResolvedValue(access);
  await expect(read()).rejects.toThrow();
  expect(api.get).toHaveBeenCalledTimes(1);
});
it.each([
  { ...page, items: [{ ...member, crewId: "other" }] },
  { ...page, items: [member, member] },
  { ...page, items: [{ ...member, status: "removed" }] },
  { ...page, items: [{ ...member, policyKeys: ["unknown"] }] },
])("rejects invalid roster data %j", async (value) => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ userId: "1", permissions: ["members.view"] })
    .mockResolvedValueOnce(value);
  await expect(read()).rejects.toThrow();
});
it("rejects a repeated cursor", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ userId: "1", permissions: ["members.view"] })
    .mockResolvedValueOnce({ ...page, nextCursor: "previous" });
  await expect(read("previous")).rejects.toThrow("could not be verified");
});
it("rejects an account change during a read", async () => {
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path.endsWith("/me")) return { userId: "1", permissions: ["members.view"] };
    h.generation++;
    return page;
  });
  await expect(read()).rejects.toThrow("session expired");
});
it("rejects cancelled reads before network access", async () => {
  const c = new AbortController();
  c.abort();
  await expect(fetchCrewMemberPage("crew", "1", 1, null, c.signal)).rejects.toThrow("cancelled");
  expect(api.get).not.toHaveBeenCalled();
});

const target = { ...member, isOwner: false };
const remove = () => removeCrewMember("crew", "1", 1, target);
it("removes a freshly verified non-owner by membership ID", async () => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/me")
      ? { userId: "1", permissions: ["members.view", "members.manage"] }
      : { ...page, items: [target] }
  );
  await remove();
  expect(api.delete).toHaveBeenCalledWith("/crews/crew/members/member", { service: "aurora" });
});
it("finds a removal target beyond the first page", async () => {
  let n = 0;
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/me")
      ? { userId: "1", permissions: ["members.view", "members.manage"] }
      : n++
        ? { ...page, items: [target] }
        : { items: [], nextCursor: "next", total: 1 }
  );
  await remove();
  expect(api.delete).toHaveBeenCalledTimes(1);
});
it.each([
  { ...target, version: 2 },
  { ...target, userId: "other" },
  { ...target, isOwner: true },
])("blocks removal after member changes %j", async (fresh) => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/me")
      ? { userId: "1", permissions: ["members.view", "members.manage"] }
      : { ...page, items: [fresh] }
  );
  await expect(remove()).rejects.toThrow("changed");
  expect(api.delete).not.toHaveBeenCalled();
});
it("blocks owner removal before making requests", async () => {
  await expect(removeCrewMember("crew", "1", 1, member)).rejects.toThrow("Transfer ownership");
  expect(api.get).not.toHaveBeenCalled();
});
it("blocks removal without management permission", async () => {
  await expect(remove()).rejects.toThrow("management permission");
  expect(api.delete).not.toHaveBeenCalled();
});
it("does not treat a missing member as successful removal", async () => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/me")
      ? { userId: "1", permissions: ["members.view", "members.manage"] }
      : { items: [], nextCursor: null, total: 0 }
  );
  await expect(remove()).rejects.toThrow("no longer active");
  expect(api.delete).not.toHaveBeenCalled();
});
it("does not retry a failed removal", async () => {
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/me")
      ? { userId: "1", permissions: ["members.view", "members.manage"] }
      : { ...page, items: [target] }
  );
  vi.mocked(api.delete).mockRejectedValue(new Error("Already removed"));
  await expect(remove()).rejects.toThrow("Already removed");
  expect(api.delete).toHaveBeenCalledTimes(1);
});

it.each(["members.manage", "members.permissions.manage"])(
  "keeps member and permission management separate: %s",
  async (permission) => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ userId: "1", permissions: ["members.view", permission] })
      .mockResolvedValueOnce(page);
    const result = await read();
    expect(result.canManageMembers).toBe(permission === "members.manage");
    expect(result.canManagePermissions).toBe(permission === "members.permissions.manage");
  }
);

it("exposes transfer only for ownership.transfer", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ userId: "1", permissions: ["members.view", "ownership.transfer"] })
    .mockResolvedValueOnce(page);
  expect((await read()).canTransferOwnership).toBe(true);
});
