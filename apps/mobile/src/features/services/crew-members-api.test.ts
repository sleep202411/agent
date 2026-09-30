import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchCrewMemberPage } from "./crew-members-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const member = {
  id: "member",
  crewId: "crew",
  userId: "1",
  status: "active",
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
  expect(await read()).toEqual(page);
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
