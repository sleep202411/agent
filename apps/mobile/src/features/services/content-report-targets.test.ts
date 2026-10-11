import { expect, it, vi, beforeEach } from "vitest";
import { fetchReportTargets } from "./content-report-targets";
const h = vi.hoisted(() => ({ get: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = "11111111-1111-4111-8111-111111111111",
  row = { id, title: "Film", roomNumber: "123" };
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue({ items: [row], nextCursor: null });
});
it("searches the official endpoint by query and locale with pagination", async () => {
  await fetchReportTargets(" 123 ", "zh-CN", id, 1, new AbortController().signal);
  expect(h.get).toHaveBeenCalledWith(
    "/ip-commerce/ips",
    expect.objectContaining({
      retry: false,
      params: { q: "123", locale: "zh-CN", limit: 20, cursor: id },
    })
  );
});
it("rejects stale sessions and nonadvancing pagination", async () => {
  await expect(
    fetchReportTargets("", "en-US", null, 2, new AbortController().signal)
  ).rejects.toThrow("expired");
  expect(h.get).not.toHaveBeenCalled();
  h.get.mockResolvedValue({ items: [row], nextCursor: id });
  await expect(
    fetchReportTargets("", "en-US", id, 1, new AbortController().signal)
  ).rejects.toThrow("pagination");
});
