"use client";

/**
 * /messages/[id] — inbox + selected conversation view.
 *
 * Mobile: the inbox is hidden, the conversation fills the screen,
 * and ConversationView's back button returns to /messages. Desktop:
 * inbox on the left, conversation on the right.
 */
import { useParams } from "next/navigation";
import { useTranslations } from "@/src/i18n/i18n";
import { InboxList } from "../_components/inbox-list";
import { ConversationView } from "../_components/conversation-view";

export default function ConversationPage() {
  const t = useTranslations("messages");
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  return (
    <div className="grid h-full min-h-0 grid-cols-1 grid-rows-1 bg-background text-foreground lg:grid-cols-[320px_1fr]">
      <div className="hidden min-h-0 min-w-0 border-r border-border lg:block">
        <InboxList activeId={id} />
      </div>
      <div className="min-h-0 min-w-0">
        {id ? (
          <ConversationView conversationId={id} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t("conversationNotFound")}
          </div>
        )}
      </div>
    </div>
  );
}
