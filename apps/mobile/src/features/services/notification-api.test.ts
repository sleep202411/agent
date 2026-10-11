import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchNotifications,
  readNotification,
  readAllNotifications,
  fetchNotificationUnreadCount,
} from "./notification-api";
const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const row = {
  id: "short-id",
  type: "crew.task.assigned",
  title: "Task assigned",
  body: "Review script",
  meta: { taskId: "t" },
  createdAt: "2026-10-01T01:00:00Z",
  readAt: null,
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("fetches the official filtered cursor page", async () => {
  h.get.mockResolvedValue({ items: [row], nextCursor: "next" });
  expect((await fetchNotifications("crew", "previous", 1, signal())).items).toEqual([row]);
  expect(h.get).toHaveBeenCalledWith(
    "/notifications",
    expect.objectContaining({
      service: "aurora",
      retry: false,
      params: { filter: "crew", limit: 30, cursor: "previous" },
    })
  );
});
it.each(["unread", "sharing"] as const)("rejects records inconsistent with %s", async (filter) => {
  h.get.mockResolvedValue({ items: [{ ...row, readAt: row.createdAt }], nextCursor: null });
  await expect(fetchNotifications(filter, null, 1, signal())).rejects.toThrow("Invalid");
});
it("rejects duplicate records", async () => {
  h.get.mockResolvedValue({ items: [row, row], nextCursor: null });
  await expect(fetchNotifications("all", null, 1, signal())).rejects.toThrow("Invalid");
});
it("validates identity and confirmed read receipts", async () => {
  h.post.mockResolvedValue({ ...row, readAt: row.createdAt });
  expect((await readNotification(row.id, 1, signal())).readAt).toBe(row.createdAt);
  h.post.mockResolvedValue({ ...row, id: "wrong", readAt: row.createdAt });
  await expect(readNotification(row.id, 1, signal())).rejects.toThrow("receipt");
  h.post.mockResolvedValue(row);
  await expect(readNotification(row.id, 1, signal())).rejects.toThrow("receipt");
});
it("supports mark all and rejects malformed counts", async () => {
  h.post.mockResolvedValue({ count: 5 });
  expect(await readAllNotifications(1, signal())).toEqual({ count: 5 });
  h.post.mockResolvedValue({ count: -1 });
  await expect(readAllNotifications(1, signal())).rejects.toThrow();
});
it("rejects stale sessions before writes and late feed results", async () => {
  h.generation = 2;
  await expect(readAllNotifications(1, signal())).rejects.toThrow("expired");
  expect(h.post).not.toHaveBeenCalled();
  h.generation = 1;
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return { items: [row], nextCursor: null };
  });
  await expect(fetchNotifications("all", null, 1, signal())).rejects.toThrow("expired");
});

it("loads the account-wide unread count without a filter", async () => {
  h.get.mockResolvedValue({ count: 35 });
  expect(await fetchNotificationUnreadCount(1, signal())).toBe(35);
  expect(h.get).toHaveBeenCalledWith(
    "/notifications/unread-count",
    expect.objectContaining({ service: "aurora", retry: false })
  );
});
it.each([-1, 1.5, "2", Number.MAX_SAFE_INTEGER + 1])(
  "rejects an invalid unread count %s",
  async (count) => {
    h.get.mockResolvedValue({ count });
    await expect(fetchNotificationUnreadCount(1, signal())).rejects.toThrow();
  }
);
it("rejects an unread count from a replaced account", async () => {
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return { count: 4 };
  });
  await expect(fetchNotificationUnreadCount(1, signal())).rejects.toThrow("expired");
});
