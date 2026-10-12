import type { MessageKey } from "@/i18n";
import type { NativeMessage } from "./conversation-api";
import type { UserDisplay } from "./user-displays";
import { inboxPreview } from "./inbox-preview";

export function activitySubject(message: NativeMessage): string | undefined {
  if (message.type !== "system" || message.payload?.kind !== "system") return;
  if (!["crew.member.joined", "crew.member.left"].includes(message.payload.system.kind)) return;
  const raw = message.payload.system.params.userId;
  if (typeof raw === "number" && (!Number.isSafeInteger(raw) || raw <= 0)) return;
  const id = typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
  return /^\d{1,18}$/.test(id) ? id : undefined;
}
export function conversationDisplayIds(
  participants: readonly string[],
  messages: readonly NativeMessage[]
) {
  return [
    ...participants,
    ...messages.flatMap((message) => {
      const subject = activitySubject(message);
      return [...(message.authorId ? [message.authorId] : []), ...(subject ? [subject] : [])];
    }),
  ];
}
export function conversationActivity(
  message: NativeMessage,
  displays: Map<string, UserDisplay> | undefined,
  t: (key: MessageKey) => string
) {
  if (message.type !== "system" || message.payload?.kind !== "system") return message.body;
  const kind = message.payload.system.kind;
  if (kind === "crew.member.joined" || kind === "crew.member.left") {
    const id = activitySubject(message);
    const name = (id ? displays?.get(id)?.nickname.trim() : undefined) || t("thread.member");
    return t(kind === "crew.member.joined" ? "thread.memberJoined" : "thread.memberLeft").replace(
      "{user}",
      () => name
    );
  }
  const label = inboxPreview(
    { lastMessageType: "system", lastMessagePreview: `[system:${kind}]` },
    t
  );
  const reason = message.payload.system.params.reason;
  // Revision instructions are user-authored plain text, not translation parameters or markup.
  return kind === "order.revision_requested" && typeof reason === "string" && reason
    ? `${label}\n\n${reason}`
    : label;
}
