import { SYSTEM_MESSAGE_KINDS } from "@repo/shared/conversation";
import type { MessageKey } from "@/i18n";
import type { InboxItem } from "./inbox-api";

export function inboxTime(iso: string, locale: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const today =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return today
    ? date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

export function inboxPreview(
  item: Pick<InboxItem, "lastMessageType" | "lastMessagePreview">,
  t: (key: MessageKey) => string
): string {
  const raw = item.lastMessagePreview;
  // Only server-declared system messages can become activity labels. A user
  // typing a marker must still appear as ordinary text.
  if (item.lastMessageType === "system") {
    const kind = SYSTEM_MESSAGE_KINDS.find((value) => raw === `[system:${value}]`);
    return t(kind ? `inbox.activity.${kind}` : "inbox.preview.system");
  }
  if (item.lastMessageType === "text") return raw || t("inbox.preview.empty");
  return t(`inbox.preview.${item.lastMessageType}`);
}
