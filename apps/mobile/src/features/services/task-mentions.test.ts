import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchMentionMembers } from "./task-mentions";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
it("uses Crew-scoped paginated active members and forwards cancellation", async () => {
  const signal = new AbortController().signal;
  const member = { id: "member", crewId: "crew", userId: "2", status: "active" };
  vi.mocked(api.get).mockResolvedValue({ items: [member], nextCursor: "next" });
  expect(await fetchMentionMembers("crew", "cursor", signal)).toEqual({
    items: [member],
    nextCursor: "next",
  });
  expect(api.get).toHaveBeenCalledWith("/crews/crew/members", {
    service: "aurora",
    signal,
    params: { limit: 50, cursor: "cursor" },
  });
  for (const item of [
    { ...member, crewId: "other" },
    { ...member, status: "removed" },
  ]) {
    vi.mocked(api.get).mockResolvedValue({ items: [item], nextCursor: null });
    await expect(fetchMentionMembers("crew", null, signal)).rejects.toThrow();
  }
});
