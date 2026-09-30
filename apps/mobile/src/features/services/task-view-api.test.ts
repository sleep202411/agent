import { beforeEach, expect, it, vi } from "vitest";
import { fetchTaskViews, fetchTaskViewPage } from "./task-view-api";
import { api } from "@/lib/api-client";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const id = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002";
const view = { id, crewId: "crew", name: "Active", completedMode: "hidden", showSubIssues: false };
const row = { id: other, crewId: "crew", number: 2, title: "Shot" };
const signal = new AbortController().signal;
beforeEach(() => vi.resetAllMocks());
it("preserves server view order and saved visibility", async () => {
  vi.mocked(api.get).mockResolvedValue({ views: [view, { ...view, id: other, name: "Later" }] });
  expect(await fetchTaskViews("crew", signal)).toEqual([
    view,
    { ...view, id: other, name: "Later" },
  ]);
});
it.each([{ views: [view, view] }, { views: [{ ...view, crewId: "other" }] }])(
  "rejects foreign/duplicate views",
  async ({ views }) => {
    vi.mocked(api.get).mockResolvedValue({ views });
    await expect(fetchTaskViews("crew", signal)).rejects.toThrow("scope");
  }
);
it("uses saved-view endpoint with server filtering and cursor", async () => {
  vi.mocked(api.get).mockResolvedValue({ items: [row], nextCursor: null, total: 1 });
  await fetchTaskViewPage("crew", { viewId: id, query: " shot ", priority: "urgent" }, id, signal);
  expect(api.get).toHaveBeenCalledWith("/crews/crew/tasks", {
    service: "aurora",
    signal,
    params: { viewId: id, query: "shot", priority: "urgent", cursor: id, limit: 30 },
  });
});
it.each([
  { items: [{ ...row, crewId: "other" }], nextCursor: null, total: 1 },
  { items: [row, row], nextCursor: null, total: 2 },
  { items: [row], nextCursor: id, total: 2 },
])("rejects invalid page scope or cursor", async (page) => {
  vi.mocked(api.get).mockResolvedValue(page);
  await expect(fetchTaskViewPage("crew", { viewId: id }, null, signal)).rejects.toThrow(
    "pagination"
  );
});
it("rejects cursor echo", async () => {
  vi.mocked(api.get).mockResolvedValue({ items: [row], nextCursor: null, total: 1 });
  await expect(fetchTaskViewPage("crew", { viewId: id }, other, signal)).rejects.toThrow(
    "pagination"
  );
});
