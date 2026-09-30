import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { crewMember } from "./crew-members-api";
import { memberPolicyKeys, updateCrewMemberAccess } from "./crew-member-access-api";
const h = vi.hoisted(() => ({ generation: 1, page: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { patch: vi.fn() } }));
vi.mock("./crew-members-api", async (original) => ({
  ...(await original<typeof import("./crew-members-api")>()),
  fetchCrewMemberPage: h.page,
}));
const member = crewMember.parse({
  id: "member",
  crewId: "crew",
  userId: "2",
  status: "active",
  isOwner: false,
  version: 1,
  joinedAt: "2026-09-30T00:00:00Z",
  positions: [],
  policyKeys: [],
});
const policyKeys = ["admin" as const, "finance" as const];
const write = () => updateCrewMemberAccess("crew", "1", 1, member, policyKeys);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.page.mockResolvedValue({ items: [member], nextCursor: null, canManagePermissions: true });
  vi.mocked(api.patch).mockResolvedValue({
    ...member,
    version: 2,
    policyKeys: ["finance", "admin"],
  });
});
it("sends only policies and the captured version", async () => {
  await write();
  expect(api.patch).toHaveBeenCalledWith("/crews/crew/members/member", {
    service: "aurora",
    data: { policyKeys, expectedVersion: 1 },
  });
});

it.each([{ version: 2 }, { userId: "changed" }, { isOwner: true }])(
  "rejects changed members %j",
  async (change) => {
    h.page.mockResolvedValue({
      items: [{ ...member, ...change }],
      nextCursor: null,
      canManagePermissions: true,
    });
    await expect(write()).rejects.toThrow("changed");
    expect(api.patch).not.toHaveBeenCalled();
  }
);
it("requires permission management, not ordinary member management", async () => {
  h.page.mockResolvedValue({
    items: [member],
    nextCursor: null,
    canManageMembers: true,
    canManagePermissions: false,
  });
  await expect(write()).rejects.toThrow("permission");
  expect(api.patch).not.toHaveBeenCalled();
});
it("protects the owner before fetching", async () => {
  await expect(
    updateCrewMemberAccess("crew", "1", 1, { ...member, isOwner: true }, [])
  ).rejects.toThrow("owner");
  expect(h.page).not.toHaveBeenCalled();
  expect(api.patch).not.toHaveBeenCalled();
});
it("allows removing both additive policies", async () => {
  vi.mocked(api.patch).mockResolvedValue({ ...member, version: 2 });
  await updateCrewMemberAccess("crew", "1", 1, member, []);
  expect(api.patch).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ data: { policyKeys: [], expectedVersion: 1 } })
  );
});
it("finds members beyond the first page", async () => {
  h.page.mockResolvedValueOnce({ items: [], nextCursor: "next", canManagePermissions: true });
  await write();
  expect(h.page).toHaveBeenCalledTimes(2);
});
it("rejects a pagination loop", async () => {
  h.page.mockResolvedValue({ items: [], nextCursor: "next", canManagePermissions: true });
  await expect(write()).rejects.toThrow("advance");
  expect(api.patch).not.toHaveBeenCalled();
});
it("rejects a removed member", async () => {
  h.page.mockResolvedValue({ items: [], nextCursor: null, canManagePermissions: true });
  await expect(write()).rejects.toThrow("no longer active");
  expect(api.patch).not.toHaveBeenCalled();
});
it.each([
  { version: 1 },
  { policyKeys: [] },
  { crewId: "other" },
  { userId: "other" },
  { isOwner: true },
])("rejects incorrect receipts %j", async (change) => {
  vi.mocked(api.patch).mockResolvedValue({ ...member, version: 2, policyKeys, ...change });
  await expect(write()).rejects.toThrow("could not be verified");
});
it("does not retry conflicts", async () => {
  vi.mocked(api.patch).mockRejectedValue(new Error("Version conflict"));
  await expect(write()).rejects.toThrow("Version conflict");
  expect(api.patch).toHaveBeenCalledTimes(1);
});
it("rejects account changes before writes", async () => {
  h.page.mockImplementation(async () => {
    h.generation++;
    return { items: [member], nextCursor: null, canManagePermissions: true };
  });
  await expect(write()).rejects.toThrow("expired");
  expect(api.patch).not.toHaveBeenCalled();
});
it("rejects account changes during writes", async () => {
  vi.mocked(api.patch).mockImplementation(async () => {
    h.generation++;
    return { ...member, version: 2, policyKeys };
  });
  await expect(write()).rejects.toThrow("expired");
});

it.each([{ value: ["owner"] }, { value: ["admin", "admin"] }])(
  "rejects invalid policies %j",
  ({ value }) => {
    expect(memberPolicyKeys.safeParse(value).success).toBe(false);
  }
);
it("rejects a cross-Crew snapshot before fetching", async () => {
  await expect(updateCrewMemberAccess("other", "1", 1, member, [])).rejects.toThrow("scope");
  expect(h.page).not.toHaveBeenCalled();
});
