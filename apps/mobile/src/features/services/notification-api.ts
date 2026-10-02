import { z } from "zod";
import { NOTIFICATION_FILTERS, notificationCategory } from "@repo/shared/notifications";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { notificationReadConfirmed } from "./notification-read-events";
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];
const id = z.string().min(1).max(256);
const date = z.string().datetime({ offset: true });
const item = z.object({
  id,
  type: z.string().min(1),
  title: z.string(),
  body: z.string(),
  meta: z.record(z.string(), z.unknown()),
  readAt: date.nullable(),
  createdAt: date,
});
const page = z.object({ items: z.array(item), nextCursor: id.nullable() });
export type NotificationItem = z.infer<typeof item>;
function current(generation: number, signal: AbortSignal) {
  if (signal.aborted || generation !== getAuthGeneration())
    throw new Error("Notification session expired");
}
export async function fetchNotifications(
  filter: NotificationFilter,
  cursor: string | null,
  generation: number,
  signal: AbortSignal
) {
  current(generation, signal);
  z.enum(NOTIFICATION_FILTERS).parse(filter);
  if (cursor !== null) id.parse(cursor);
  const result = page.parse(
    await api.get("/notifications", {
      service: "aurora",
      signal,
      retry: false,
      params: { limit: 30, filter, ...(cursor ? { cursor } : {}) },
    })
  );
  current(generation, signal);
  if (
    new Set(result.items.map((row) => row.id)).size !== result.items.length ||
    result.items.some((row) =>
      filter === "unread"
        ? row.readAt !== null
        : filter !== "all" && notificationCategory(row.type) !== filter
    )
  )
    throw new Error("Invalid notification page");
  return result;
}
export async function readNotification(
  notificationId: string,
  generation: number,
  signal: AbortSignal
) {
  current(generation, signal);
  id.parse(notificationId);
  const result = item.parse(
    await api.post(`/notifications/${encodeURIComponent(notificationId)}/read`, {
      service: "aurora",
      signal,
      retry: false,
    })
  );
  current(generation, signal);
  if (result.id !== notificationId || !result.readAt)
    throw new Error("Notification read receipt mismatch");
  notificationReadConfirmed(generation);
  return result;
}
export async function readAllNotifications(generation: number, signal: AbortSignal) {
  current(generation, signal);
  const result = z
    .object({ count: z.number().int().nonnegative().safe() })
    .parse(await api.post("/notifications/read-all", { service: "aurora", signal, retry: false }));
  current(generation, signal);
  notificationReadConfirmed(generation);
  return result;
}
