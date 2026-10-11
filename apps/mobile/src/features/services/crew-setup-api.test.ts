import { beforeEach, expect, it, vi } from "vitest";
import { fetchCrewSetup } from "./crew-setup-api";
const h = vi.hoisted(() => ({
  generation: 1,
  get: vi.fn(),
  members: vi.fn(),
  invites: vi.fn(),
  episodes: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("./crew-members-api", () => ({ fetchCrewMemberPage: h.members }));
vi.mock("./crew-team-invitations-api", () => ({ fetchTeamInvitations: h.invites }));
vi.mock("./episode-management-api", () => ({ fetchCrewEpisodes: h.episodes }));
const access = [
  "members.view",
  "members.manage",
  "tasks.manage",
  "members.invite",
  "openings.manage",
];
const signal = () => new AbortController().signal;
const load = () => fetchCrewSetup("crew", "actor", 1, signal());
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue({ userId: "actor", permissions: access });
  h.members.mockResolvedValue({
    items: [{ id: "m", userId: "member" }],
    nextCursor: null,
    total: 1,
    canManageMembers: true,
  });
  h.invites.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
  h.episodes.mockResolvedValue([]);
});
it("loads every roster and invitation page before declaring vacancies", async () => {
  h.members
    .mockResolvedValueOnce({
      items: [{ id: "a", userId: "1" }],
      total: 2,
      nextCursor: "a",
      canManageMembers: true,
    })
    .mockResolvedValueOnce({
      items: [{ id: "b", userId: "2" }],
      total: 2,
      nextCursor: null,
      canManageMembers: true,
    });
  h.invites
    .mockResolvedValueOnce({ items: [{ id: "i1" }], total: 2, nextCursor: "i1" })
    .mockResolvedValueOnce({ items: [{ id: "i2" }], total: 2, nextCursor: null });
  const result = await load();
  expect(result.members).toHaveLength(2);
  expect(result.invitations).toHaveLength(2);
  expect(h.members.mock.calls[1]?.[3]).toBe("a");
  expect(h.invites.mock.calls[1]?.[3]).toBe("i1");
  expect(h.get).toHaveBeenCalledTimes(2);
  expect(result.canPublish).toBe(true);
});
it.each([
  { permissions: ["tasks.manage"] },
  { permissions: ["members.manage"] },
  { permissions: [] },
])("rejects insufficient setup permissions %j", async ({ permissions }) => {
  h.get.mockResolvedValue({ userId: "actor", permissions });
  await expect(load()).rejects.toThrow("management permissions");
  expect(h.members).not.toHaveBeenCalled();
});
it("does not read invitations without permission", async () => {
  h.get.mockResolvedValue({
    userId: "actor",
    permissions: ["members.view", "members.manage", "tasks.manage"],
  });
  expect((await load()).canInvite).toBe(false);
  expect(h.invites).not.toHaveBeenCalled();
});
it("rejects partial roster and invitations instead of showing false vacancy counts", async () => {
  h.members.mockResolvedValueOnce({
    items: [],
    nextCursor: null,
    total: 1,
    canManageMembers: true,
  });
  await expect(load()).rejects.toThrow("incomplete");
  h.invites.mockResolvedValueOnce({ items: [], nextCursor: null, total: 1 });
  await expect(load()).rejects.toThrow("incomplete");
});
it("rejects duplicate people across roster pages", async () => {
  h.members.mockResolvedValue({
    items: [{ id: "m", userId: "member" }],
    nextCursor: "m",
    total: 2,
    canManageMembers: true,
  });
  await expect(load()).rejects.toThrow("roster changed");
  expect(h.members).toHaveBeenCalledTimes(2);
});
it("propagates invitation failures rather than confirming a partial team", async () => {
  h.invites.mockRejectedValue(new Error("Invitations unavailable"));
  await expect(load()).rejects.toThrow("Invitations unavailable");
  expect(h.episodes).not.toHaveBeenCalled();
});
it("rejects permission loss at the final recheck", async () => {
  h.get
    .mockResolvedValueOnce({ userId: "actor", permissions: access })
    .mockResolvedValueOnce({ userId: "actor", permissions: ["members.manage"] });
  await expect(load()).rejects.toThrow("management permissions");
});
it("rejects cancellation and account changes during loading", async () => {
  h.episodes.mockImplementation(async () => {
    h.generation++;
    return [];
  });
  await expect(load()).rejects.toThrow("session expired");
  h.generation = 1;
  const controller = new AbortController();
  controller.abort();
  await expect(fetchCrewSetup("crew", "actor", 1, controller.signal)).rejects.toThrow(
    "session expired"
  );
});
