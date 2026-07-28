export { NotificationProvider } from "./provider";
export { notificationHref } from "./deeplink";
export {
  notificationKeys,
  useUnreadCount,
  useRecentNotifications,
  useNotificationFeed,
  useMarkRead,
  useMarkAllRead,
} from "./hooks";
export {
  listNotifications,
  fetchUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  NotificationApiError,
  type ListResult,
} from "./api";
export type { NotificationDTO } from "@repo/shared/notifications";
