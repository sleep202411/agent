/**
 * In-app notifications (站内信) — shared wire types and channel helpers.
 *
 * Server emits notifications by writing a DB row + durable outbox entry.
 * The outbox publishes a `notification.created` frame to the authenticated
 * per-user Ably channel shared with conversation and crew-domain events.
 * The DB row is the source of truth; Ably is the latency optimization.
 *
 * Adding a notification type:
 *   1. Append to NOTIFICATION_TYPES.
 *   2. Define its meta shape (or just rely on the `Record<string, unknown>`
 *      default for one-offs).
 *   3. Have the producer call NotificationService.send().
 *   4. (Optional) Add a renderer hint in the web notification renderer.
 */

export const NOTIFICATION_TYPES = [
  // Crew
  "crew.application.submitted",
  "crew.application.approved",
  "crew.application.rejected",
  "crew.member.added",
  "crew.member.removed",
  "crew.invitation.received",
  "crew.invitation.accepted",
  "crew.agreement.sent",
  "crew.agreement.updated",
  "crew.chat.mentioned",
  // Production tasks + crew earnings
  "crew.task.assigned",
  "crew.task.commented",
  "crew.task.mentioned",
  "crew.task.updated",
  "crew.task.submitted",
  "crew.task.approved",
  "crew.task.revision_requested",
  "crew.earning.posted",
  "crew.earning.rejected",
  "crew.earning.reversed",
  "crew.payout.scheduled",
  "crew.payout.paid",
  "crew.payout.voided",
  "crew.withdrawal.processing",
  "crew.withdrawal.paid",
  "crew.withdrawal.rejected",
  // Sharing (studio team collaboration — workspace + project membership)
  "workspace.member.added",
  "workspace.member.removed",
  "workspace.invite.received",
  "project.member.added",
  "project.member.removed",
  "project.invite.received",
  "story-project.member.added",
  "story-project.member.removed",
  // System (placeholder — wire as needed)
  "system.account.notice",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Category prefix — used by inbox filter tabs ("All / Unread / Crew / Sharing / System"). */
export type NotificationCategory = "crew" | "sharing" | "system";

export const NOTIFICATION_FILTERS = ["all", "unread", "crew", "sharing", "system"] as const;
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

/** `/projects` and the legacy `/invite?code=...` remain web routes. */
export function isStudioNotificationPath(pathname: string): boolean {
  return (
    /^\/invite\/[^/]+\/?$/.test(pathname) ||
    ["/story-studio", "/canvas", "/project"].some(
      (root) => pathname === root || pathname.startsWith(`${root}/`)
    )
  );
}

/** Resolve stored links independently of the app displaying the notification. */
export function notificationTarget(notification: NotificationDTO): {
  surface: "web" | "studio";
  path: string;
} | null {
  const link = notification.meta?.deeplink;
  // Notification links are product-relative UI paths, never external URLs or scripts.
  if (typeof link !== "string" || !link.startsWith("/") || /^\/\/|[\\\\\u0000-\u0020]/.test(link)) {
    return null;
  }
  const path = link.replace(/^\/(en-US|zh-CN|zh-HK)(?=\/|[?#]|$)/, "") || "/";
  const pathname = path.split(/[?#]/, 1)[0]!;
  return { surface: isStudioNotificationPath(pathname) ? "studio" : "web", path };
}

export function notificationCategory(type: string): NotificationCategory {
  if (type.startsWith("crew.")) return "crew";
  if (
    type.startsWith("workspace.") ||
    type.startsWith("project.") ||
    type.startsWith("story-project.")
  ) {
    return "sharing";
  }
  return "system";
}

/** A notification record as it crosses the wire (REST GET + Ably frame). */
export interface NotificationDTO {
  id: string;
  type: string; // NotificationType, but typed as string for forward compat
  title: string;
  body: string;
  meta: NotificationMeta;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationMeta {
  /** Where the bell dropdown should navigate when the row is clicked. */
  deeplink?: string;
  /** Type-specific extra fields. */
  [k: string]: unknown;
}
