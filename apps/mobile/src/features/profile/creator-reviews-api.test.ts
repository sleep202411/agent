import { expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchCreatorReviews } from "./creator-reviews-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const summary = {
  creator: { count: 0, average: null },
  manager: { count: 0, average: null },
  total: 0,
  average: null,
  histogram: [0, 0, 0, 0, 0],
};
it("uses the public official endpoint with scoped pagination and cancellation", async () => {
  const page = { items: [], summary, nextCursor: null };
  vi.mocked(api.get).mockResolvedValue(page);
  const signal = new AbortController().signal;
  expect(await fetchCreatorReviews("creator/id", "cursor", signal)).toEqual(page);
  expect(api.get).toHaveBeenLastCalledWith("/creator-profiles/creator%2Fid/reviews", {
    service: "aurora",
    credentials: "omit",
    retry: false,
    signal,
    params: { limit: 20, cursor: "cursor" },
  });
});
it("rejects incomplete summaries and invalid scores instead of showing a false rating", async () => {
  for (const summaryValue of [
    undefined,
    { ...summary, average: 6 },
    { ...summary, histogram: [] },
  ]) {
    vi.mocked(api.get).mockResolvedValue({ items: [], summary: summaryValue, nextCursor: null });
    await expect(fetchCreatorReviews("a", null, new AbortController().signal)).rejects.toThrow();
  }
});
it("preserves actionable upstream errors", async () => {
  vi.mocked(api.get).mockRejectedValue(new Error("Public review cursor not found."));
  await expect(fetchCreatorReviews("a", "cursor", new AbortController().signal)).rejects.toThrow(
    "Public review cursor not found."
  );
});
