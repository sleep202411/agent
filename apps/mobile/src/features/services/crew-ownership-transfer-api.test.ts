import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { crewMember } from "./crew-members-api";
import { transferCrewOwnership } from "./crew-ownership-transfer-api";
const h = vi.hoisted(() => ({ generation: 1, page: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("./crew-members-api", async (original) => ({
  ...(await original<typeof import("./crew-members-api")>()),
  fetchCrewMemberPage: h.page,
}));
const member = crewMember.parse({
  id: "member",
  crewId: "crew",
  userId: "recipient",
  status: "active",
  isOwner: false,
  version: 3,
  joinedAt: "2026-09-30T00:00:00Z",
  positions: [],
  policyKeys: [],
});
const before = { id: "crew", ownerUserId: "actor", version: 8 };
const write = (leave = false) => transferCrewOwnership("crew", "actor", 1, member, leave);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.page.mockResolvedValue({ items: [member], nextCursor: null, canTransferOwnership: true });
  vi.mocked(api.get).mockResolvedValue(before);
  vi.mocked(api.post).mockResolvedValue({ ...before, ownerUserId: "recipient", version: 9 });
});
it.each([false, true])(
  "transfers with an explicit leave choice and fresh Crew version: %s",
  async (leave) => {
    await write(leave);
    expect(api.post).toHaveBeenCalledWith("/crews/crew/transfer-owner", {
      service: "aurora",
      data: { toUserId: "recipient", removeOldOwner: leave, expectedVersion: 8 },
    });
  }
);
it.each([{ isOwner: true }, { userId: "actor" }, { crewId: "other" }])(
  "rejects an invalid target before reading %j",
  async (change) => {
    await expect(
      transferCrewOwnership("crew", "actor", 1, { ...member, ...change }, false)
    ).rejects.toThrow();
    expect(h.page).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  }
);
it.each([{ version: 4 }, { isOwner: true }, { userId: "other" }])(
  "rejects changed target membership %j",
  async (change) => {
    h.page.mockResolvedValue({
      items: [{ ...member, ...change }],
      nextCursor: null,
      canTransferOwnership: true,
    });
    await expect(write()).rejects.toThrow("changed");
    expect(api.post).not.toHaveBeenCalled();
  }
);
it("requires the specific transfer permission", async () => {
  h.page.mockResolvedValue({
    items: [member],
    nextCursor: null,
    canManageMembers: true,
    canTransferOwnership: false,
  });
  await expect(write()).rejects.toThrow("permission");
  expect(api.post).not.toHaveBeenCalled();
});
it("finds the recipient on a later page", async () => {
  h.page.mockResolvedValueOnce({ items: [], nextCursor: "next", canTransferOwnership: true });
  await write();
  expect(h.page).toHaveBeenCalledTimes(2);
});
it("rejects missing members", async () => {
  h.page.mockResolvedValue({ items: [], nextCursor: null, canTransferOwnership: true });
  await expect(write()).rejects.toThrow("no longer active");
  expect(api.post).not.toHaveBeenCalled();
});
it("rejects pagination loops", async () => {
  h.page.mockResolvedValue({ items: [], nextCursor: "next", canTransferOwnership: true });
  await expect(write()).rejects.toThrow("advance");
  expect(api.post).not.toHaveBeenCalled();
});
it.each([{ id: "other" }, { ownerUserId: "other" }])(
  "rejects changed Crew ownership %j",
  async (change) => {
    vi.mocked(api.get).mockResolvedValue({ ...before, ...change });
    await expect(write()).rejects.toThrow("ownership changed");
    expect(api.post).not.toHaveBeenCalled();
  }
);
it.each([{ id: "other" }, { ownerUserId: "actor" }, { version: 8 }])(
  "rejects wrong receipts %j",
  async (change) => {
    vi.mocked(api.post).mockResolvedValue({
      ...before,
      ownerUserId: "recipient",
      version: 9,
      ...change,
    });
    await expect(write()).rejects.toThrow("could not be verified");
  }
);
it("does not retry an uncertain transfer", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Connection lost"));
  await expect(write()).rejects.toThrow("Connection lost");
  expect(api.post).toHaveBeenCalledTimes(1);
});
it("blocks account changes during the Crew read", async () => {
  vi.mocked(api.get).mockImplementation(async () => {
    h.generation++;
    return before;
  });
  await expect(write()).rejects.toThrow("expired");
  expect(api.post).not.toHaveBeenCalled();
});
it("rejects a receipt after account changes", async () => {
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation++;
    return { ...before, ownerUserId: "recipient", version: 9 };
  });
  await expect(write()).rejects.toThrow("expired");
});
