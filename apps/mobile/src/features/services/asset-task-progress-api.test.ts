import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchAssetTaskProgress, summarizeAssetTasks } from "./asset-task-progress-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const task = (n: number, status = "submitted") => ({
  id: id(n),
  crewId: "crew",
  parentId: null,
  status,
  assetCategory: "characters" as const,
});
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("loads all production pages before returning 12 approved of 24", async () => {
  const rows = Array.from({ length: 24 }, (_, i) => task(i, i < 12 ? "approved" : "submitted"));
  vi.mocked(api.get)
    .mockResolvedValueOnce({ items: rows.slice(0, 12), total: 24, nextCursor: id(11) })
    .mockResolvedValueOnce({ items: rows.slice(12), total: 24, nextCursor: null });
  expect((await fetchAssetTaskProgress("crew", 1, signal())).characters).toEqual({
    approved: 12,
    total: 24,
  });
  expect(api.get).toHaveBeenLastCalledWith(
    "/crews/crew/tasks",
    expect.objectContaining({ params: { viewId: "production", limit: 100, cursor: id(11) } })
  );
});
it("excludes containers and cancellations and inherits a parent's category", () => {
  const rows = [
    task(1, "approved"),
    { ...task(2, "approved"), parentId: id(1), assetCategory: "other" as const },
    task(3, "cancelled"),
  ];
  expect(summarizeAssetTasks(rows).characters).toEqual({ approved: 1, total: 1 });
});
it.each([
  { items: [{ ...task(1), crewId: "another" }], total: 1, nextCursor: null },
  { items: [task(1)], total: 2, nextCursor: null },
  { items: [{ ...task(1), assetCategory: undefined }], total: 1, nextCursor: null },
  { items: [task(1), task(1)], total: 2, nextCursor: null },
])("rejects cross-crew, incomplete, old-server and duplicate responses", async (page) => {
  vi.mocked(api.get).mockResolvedValue(page);
  await expect(fetchAssetTaskProgress("crew", 1, signal())).rejects.toThrow();
});
it("rejects repeated cursors instead of looping", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ items: [task(1)], total: 3, nextCursor: id(1) })
    .mockResolvedValueOnce({ items: [task(2)], total: 3, nextCursor: id(1) });
  await expect(fetchAssetTaskProgress("crew", 1, signal())).rejects.toThrow("pagination");
  expect(api.get).toHaveBeenCalledTimes(2);
});
it("stops pagination if the account changes during a request", async () => {
  vi.mocked(api.get).mockImplementationOnce(async () => {
    h.generation = 2;
    return { items: [task(1)], total: 2, nextCursor: id(1) };
  });
  await expect(fetchAssetTaskProgress("crew", 1, signal())).rejects.toThrow("expired");
  expect(api.get).toHaveBeenCalledTimes(1);
});
it("does not request with an aborted signal or stale generation", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(fetchAssetTaskProgress("crew", 1, controller.signal)).rejects.toThrow();
  await expect(fetchAssetTaskProgress("crew", 0, signal())).rejects.toThrow();
  expect(api.get).not.toHaveBeenCalled();
});
it("propagates server permission errors without returning cached counts", async () => {
  vi.mocked(api.get).mockRejectedValue(new Error("Not a Crew member"));
  await expect(fetchAssetTaskProgress("crew", 1, signal())).rejects.toThrow("Not a Crew member");
});

it("rejects a changing task total instead of publishing mixed-page counts", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ items: [task(1)], total: 2, nextCursor: id(1) })
    .mockResolvedValueOnce({ items: [task(2)], total: 3, nextCursor: null });
  await expect(fetchAssetTaskProgress("crew", 1, signal())).rejects.toThrow("changed");
});
it("does not continue when the cursor contradicts the reported total", async () => {
  vi.mocked(api.get).mockResolvedValue({ items: [task(1)], total: 1, nextCursor: id(1) });
  await expect(fetchAssetTaskProgress("crew", 1, signal())).rejects.toThrow("pagination");
  expect(api.get).toHaveBeenCalledTimes(1);
});
