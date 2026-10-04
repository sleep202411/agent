import { beforeEach, expect, it, vi } from "vitest";
import { fetchContentReports } from "./content-reports-api";
const h = vi.hoisted(() => ({ get: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = "11111111-1111-4111-8111-111111111111";
const row = {
  id,
  targetType: "ip",
  targetId: id,
  reason: "privacy",
  status: "actioned",
  createdAt: "2026-10-04T00:00:00Z",
  description: "Private details",
  resolutionNote: "Removed",
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue({ items: [row], nextCursor: null });
});
it("uses the official paginated view and omits private fields from outcomes", async () => {
  const page = await fetchContentReports(1, "responses", id, signal());
  expect(page.items[0]?.description).toBeUndefined();
  expect(page.items[0]?.resolutionNote).toBe("Removed");
  expect(h.get).toHaveBeenCalledWith(
    "/ip-commerce/me/reports",
    expect.objectContaining({ retry: false, params: { view: "responses", limit: 20, cursor: id } })
  );
  expect((await fetchContentReports(1, "initiated", null, signal())).items[0]?.description).toBe(
    "Private details"
  );
});
it.each(["submitted", "triaged"])("rejects unfinished %s outcomes", async (status) => {
  h.get.mockResolvedValue({ items: [{ ...row, status }], nextCursor: null });
  await expect(fetchContentReports(1, "responses", null, signal())).rejects.toThrow("scope");
});
it("rejects duplicates and repeated cursors", async () => {
  h.get.mockResolvedValue({ items: [row, row], nextCursor: null });
  await expect(fetchContentReports(1, "initiated", null, signal())).rejects.toThrow("pagination");
  h.get.mockResolvedValue({ items: [], nextCursor: id });
  await expect(fetchContentReports(1, "initiated", id, signal())).rejects.toThrow("pagination");
});
it("rejects stale sessions before or during reads", async () => {
  await expect(fetchContentReports(2, "initiated", null, signal())).rejects.toThrow("expired");
  expect(h.get).not.toHaveBeenCalled();
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return { items: [row], nextCursor: null };
  });
  await expect(fetchContentReports(1, "initiated", null, signal())).rejects.toThrow("expired");
});
