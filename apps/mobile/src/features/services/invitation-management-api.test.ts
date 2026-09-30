import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchManagedPositions,
  fetchManagedInvitations,
  lookupInvitee,
  createManagedInvitation,
  revokeManagedInvitation,
  type ManagedPosition,
  type ManagedInvitation,
} from "./invitation-management-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const position: ManagedPosition = {
  id: "position",
  crewId: "crew",
  taskId: "00000000-0000-4000-8000-000000000001",
  positionType: "director",
  status: "open",
  targetCount: 2,
  recruitedCount: 0,
};
const row: ManagedInvitation = {
  id: "00000000-0000-4000-8000-000000000002",
  positionId: "position",
  inviteeUserId: "creator",
  status: "pending",
  expiresAt: "2099-01-01T00:00:00Z",
  applicationId: null,
};
const member = { userId: "manager", permissions: ["openings.manage"] };
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.mocked(api.get).mockResolvedValue(member);
  vi.mocked(api.post).mockResolvedValue(row);
});
it("checks permission before reading positions", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce(member)
    .mockResolvedValueOnce({ items: [position], nextCursor: null });
  expect((await fetchManagedPositions("crew", "manager", 1, null, signal())).items).toEqual([
    position,
  ]);
});
it.each([
  { ...member, permissions: [] },
  { ...member, userId: "foreign" },
])("blocks unauthorized list %j", async (value) => {
  vi.mocked(api.get).mockResolvedValue(value);
  await expect(fetchManagedPositions("crew", "manager", 1, null, signal())).rejects.toThrow();
  expect(api.get).toHaveBeenCalledTimes(1);
});
it("stops after account changes during permission read", async () => {
  vi.mocked(api.get).mockImplementation(async () => {
    h.generation = 2;
    return member;
  });
  await expect(fetchManagedPositions("crew", "manager", 1, null, signal())).rejects.toThrow();
  expect(api.get).toHaveBeenCalledTimes(1);
});
it("rejects cross-Crew positions", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce(member)
    .mockResolvedValueOnce({ items: [{ ...position, crewId: "foreign" }], nextCursor: null });
  await expect(fetchManagedPositions("crew", "manager", 1, null, signal())).rejects.toThrow();
});
it("loads position-scoped invitation history", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce(member)
    .mockResolvedValueOnce({ items: [row], nextCursor: null });
  expect((await fetchManagedInvitations(position, "manager", 1, null, signal())).items).toEqual([
    row,
  ]);
});
it("rejects cross-position history", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce(member)
    .mockResolvedValueOnce({ items: [{ ...row, positionId: "foreign" }], nextCursor: null });
  await expect(fetchManagedInvitations(position, "manager", 1, null, signal())).rejects.toThrow();
});
it("normalizes email lookup", async () => {
  vi.mocked(api.get).mockResolvedValue({ userId: "creator", nickname: "Creator" });
  await lookupInvitee(" Creator@Example.com ", 1);
  expect(api.get).toHaveBeenCalledWith("/users/lookup", {
    service: "aurora",
    params: { email: "creator@example.com" },
  });
});
it("rejects malformed contact before request", async () => {
  await expect(lookupInvitee("name", 1)).rejects.toThrow();
  expect(api.get).not.toHaveBeenCalled();
});
it("creates for resolved recipient and expiry", async () => {
  expect(await createManagedInvitation(position, "manager", 1, "creator", 7)).toEqual(row);
  expect(api.post).toHaveBeenCalledWith("/crew-positions/position/invitations", {
    service: "aurora",
    data: { inviteeUserId: "creator", expiresInDays: 7 },
  });
});
it.each([0, 31, 1.5])("rejects invalid expiry %s", async (days) => {
  await expect(createManagedInvitation(position, "manager", 1, "creator", days)).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("blocks self-invitation", async () => {
  await expect(createManagedInvitation(position, "manager", 1, "manager", 7)).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it.each([{ taskId: null }, { status: "frozen" }, { recruitedCount: 2 }])(
  "blocks ineligible role %j",
  async (patch) => {
    await expect(
      createManagedInvitation(
        { ...position, ...patch } as ManagedPosition,
        "manager",
        1,
        "creator",
        7
      )
    ).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
  }
);
it("rejects mismatched create receipt", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...row, inviteeUserId: "foreign" });
  await expect(createManagedInvitation(position, "manager", 1, "creator", 7)).rejects.toThrow();
});
it("does not retry failed create automatically", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Network"));
  await expect(createManagedInvitation(position, "manager", 1, "creator", 7)).rejects.toThrow();
  expect(api.post).toHaveBeenCalledTimes(1);
});
it("revokes the selected invitation", async () => {
  vi.mocked(api.post).mockResolvedValue({ id: row.id, status: "revoked" });
  await revokeManagedInvitation(position, row, 1);
  expect(api.post).toHaveBeenCalledWith(`/crew-position-invitations/${row.id}/revoke`, {
    service: "aurora",
  });
});
it("blocks foreign revocation", async () => {
  await expect(
    revokeManagedInvitation(position, { ...row, positionId: "other" }, 1)
  ).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("rejects stale mutation session", async () => {
  h.generation = 2;
  await expect(createManagedInvitation(position, "manager", 1, "creator", 7)).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
