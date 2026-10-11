import { beforeEach, expect, it, vi } from "vitest";
import { fetchMyAgreements } from "./my-agreements-api";
const h = vi.hoisted(() => ({ get: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const row = {
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "crew",
  title: "Production agreement",
  status: "sent",
  updatedAt: "2026-10-04T00:00:00Z",
  crew: { name: "River Crew" },
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue({ items: [row], nextCursor: null });
});
it("uses the official account-scoped inbox and cursor", async () => {
  const page = await fetchMyAgreements(1, "active", "cursor", signal());
  expect(page.items[0]).toEqual(row);
  expect(h.get).toHaveBeenCalledWith(
    "/me/crew-agreements",
    expect.objectContaining({
      retry: false,
      params: { view: "active", limit: 30, cursor: "cursor" },
    })
  );
});
it.each(["signed", "attention"] as const)("rejects a sent agreement in %s", async (view) => {
  await expect(fetchMyAgreements(1, view, null, signal())).rejects.toThrow("scope");
});
it("allows empty permission-filtered pages with a next cursor", async () => {
  h.get.mockResolvedValue({ items: [], nextCursor: "next" });
  expect(await fetchMyAgreements(1, "all", null, signal())).toEqual({
    items: [],
    nextCursor: "next",
  });
});
it("rejects duplicated records and looping cursors", async () => {
  h.get.mockResolvedValue({ items: [row, row], nextCursor: null });
  await expect(fetchMyAgreements(1, "all", null, signal())).rejects.toThrow("pagination");
  h.get.mockResolvedValue({ items: [], nextCursor: "cursor" });
  await expect(fetchMyAgreements(1, "all", "cursor", signal())).rejects.toThrow("pagination");
});
it("rejects account changes before and during reads", async () => {
  await expect(fetchMyAgreements(2, "all", null, signal())).rejects.toThrow("expired");
  expect(h.get).not.toHaveBeenCalled();
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return { items: [row], nextCursor: null };
  });
  await expect(fetchMyAgreements(1, "all", null, signal())).rejects.toThrow("expired");
});
it("rejects aborted responses", async () => {
  const c = new AbortController();
  h.get.mockImplementation(async () => {
    c.abort();
    return { items: [row], nextCursor: null };
  });
  await expect(fetchMyAgreements(1, "all", null, c.signal)).rejects.toThrow("expired");
});
