/**
 * In-app notifications (站内信) — shared wire types and channel helpers.
 *
 * Server emits notifications by writing a DB row + publishing to a
 * Redis pub/sub channel scoped to one user. Every tab the user has
 * open subscribes to that channel via the WS gateway and receives the
 * push in realtime. The DB row is the source of truth; the WS is the
 * latency optimization.
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
  // Episode
  "crew.episode.assigned",
  "crew.episode.unassigned",
  "crew.episode.submitted",
  "crew.episode.submission_approved",
  "crew.episode.submission_rejected",
  "crew.episode.approved",
  "crew.episode.revenue_set",
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

/** A notification record as it crosses the wire (REST GET + WS push). */
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

/** Per-user Redis pub/sub channel. */
export function notificationChannel(userId: string): string {
  return `notification:user:${userId}`;
}

export const NOTIFICATION_CHANNEL_PATTERN = "notification:user:*";
export const NOTIFICATION_CHANNEL_PREFIX = "notification:user:";

/** WS frame envelope — keeps the gateway / client agreement minimal. */
export type NotificationFrame =
  | { event: "notification"; data: NotificationDTO }
  | { event: "heartbeat"; data: { serverTime: number } }
  | { event: "terminate"; data: { reason: string; code: number } };
