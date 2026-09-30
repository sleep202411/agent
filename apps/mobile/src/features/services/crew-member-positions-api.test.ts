import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { crewMember } from "./crew-members-api";
import { memberPositionsInput, updateCrewMemberPositions } from "./crew-member-positions-api";
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
const positions = [{ categoryKey: "director" as const, title: null }];
const write = () => updateCrewMemberPositions("crew", "1", 1, member, positions);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.page.mockResolvedValue({ items: [member], nextCursor: null, canManageMembers: true });
  vi.mocked(api.patch).mockResolvedValue({
    ...member,
    version: 2,
    positions: [{ id: "position", ...positions[0], isPrimary: true, sourcePositionId: null }],
  });
});
it("sends only positions and the captured version", async () => {
  await write();
  expect(api.patch).toHaveBeenCalledWith("/crews/crew/members/member", {
    service: "aurora",
    data: { positions, expectedVersion: 1 },
  });
});
it.each([
  { value: [{ categoryKey: null, title: null }] },
  { value: [{ categoryKey: "unknown", title: null }] },
  { value: Array.from({ length: 13 }, () => positions[0]) },
])("rejects invalid positions %j", ({ value }) => {
  expect(memberPositionsInput.safeParse(value).success).toBe(false);
});
it("accepts custom titles and trims them", () => {
  expect(memberPositionsInput.parse([{ categoryKey: null, title: " Artist " }])).toEqual([
    { categoryKey: null, title: "Artist" },
  ]);
});
it("allows clearing all positions", async () => {
  vi.mocked(api.patch).mockResolvedValue({ ...member, version: 2 });
  await updateCrewMemberPositions("crew", "1", 1, member, []);
  expect(api.patch).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ data: { positions: [], expectedVersion: 1 } })
  );
});
it.each([
  { ...member, version: 2 },
  { ...member, userId: "other" },
  { ...member, isOwner: true },
])("blocks observed member changes %j", async (fresh) => {
  h.page.mockResolvedValue({ items: [fresh], nextCursor: null, canManageMembers: true });
  await expect(write()).rejects.toThrow("changed");
  expect(api.patch).not.toHaveBeenCalled();
});
it("blocks revoked management permission", async () => {
  h.page.mockResolvedValue({ items: [member], nextCursor: null, canManageMembers: false });
  await expect(write()).rejects.toThrow("management");
  expect(api.patch).not.toHaveBeenCalled();
});
it("rejects receipt with wrong primary position", async () => {
  vi.mocked(api.patch).mockResolvedValue({
    ...member,
    version: 2,
    positions: [{ id: "position", ...positions[0], isPrimary: false, sourcePositionId: null }],
  });
  await expect(write()).rejects.toThrow("could not be verified");
});
it("does not retry server conflicts", async () => {
  vi.mocked(api.patch).mockRejectedValue(new Error("Version conflict"));
  await expect(write()).rejects.toThrow("Version conflict");
  expect(api.patch).toHaveBeenCalledTimes(1);
});
it("rejects an account change before writing", async () => {
  h.page.mockImplementation(async () => {
    h.generation++;
    return { items: [member], nextCursor: null, canManageMembers: true };
  });
  await expect(write()).rejects.toThrow("session expired");
  expect(api.patch).not.toHaveBeenCalled();
});

it("accepts twelve valid positions but rejects thirteen", () => {
  expect(
    memberPositionsInput.safeParse(Array.from({ length: 12 }, () => positions[0])).success
  ).toBe(true);
  expect(
    memberPositionsInput.safeParse(Array.from({ length: 13 }, () => positions[0])).success
  ).toBe(false);
});
it("accepts server-reordered secondary positions while preserving primary", async () => {
  const desired = [
    { categoryKey: "director" as const, title: null },
    { categoryKey: "producer" as const, title: null },
    { categoryKey: null, title: "Assistant" },
  ];
  const rows = desired.map((p, i) => ({
    id: String(i),
    ...p,
    isPrimary: i === 0,
    sourcePositionId: null,
  }));
  vi.mocked(api.patch).mockResolvedValue({
    ...member,
    version: 2,
    positions: [rows[0], rows[2], rows[1]],
  });
  await updateCrewMemberPositions("crew", "1", 1, member, desired);
});
