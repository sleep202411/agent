import { beforeEach, expect, it, vi } from "vitest";
import { fetchTaskUnread } from "./task-unread-api";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
const taskId = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("uses the official user-scoped unread endpoint without marking anything read", async () => {
  const signal = new AbortController().signal;
  h.get.mockResolvedValue([{ taskId, count: 3 }]);
  expect(await fetchTaskUnread(1, signal)).toEqual({ [taskId]: 3 });
  expect(h.get).toHaveBeenCalledWith("/notifications/unread-crew-tasks", {
    service: "aurora",
    signal,
    retry: false,
  });
});
it.each([
  [{ taskId, count: -1 }],
  [{ taskId, count: 1.5 }],
  [{ taskId: "wrong", count: 1 }],
  [
    { taskId, count: 1 },
    { taskId, count: 2 },
  ],
])("rejects malformed or duplicate counts: %j", async (...rows) => {
  h.get.mockResolvedValue(rows);
  await expect(fetchTaskUnread(1, new AbortController().signal)).rejects.toThrow();
});
it("rejects late data after account changes", async () => {
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return [{ taskId, count: 3 }];
  });
  await expect(fetchTaskUnread(1, new AbortController().signal)).rejects.toThrow("expired");
});
