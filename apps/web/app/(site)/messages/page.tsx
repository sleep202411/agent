"use client";

/**
 * /messages — inbox-only landing.
 *
 * On lg+ viewports we want a 2-pane "list + conversation" layout but
 * /messages itself has no selected conversation; show the inbox on
 * the left and a placeholder on the right pointing the user to
 * pick a thread. On smaller viewports, just the inbox.
 *
 * /messages/[id] reuses the same shell with the conversation view
 * filled in. Both routes live under (site) so the global nav + auth
 * boundary are inherited.
 */
import { IconMessageCircle } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { InboxList } from "./_components/inbox-list";

export default function MessagesIndexPage() {
  const t = useTranslations("messages");
  return (
    <div className="grid h-[calc(100dvh-64px)] grid-cols-1 bg-background text-foreground lg:grid-cols-[320px_1fr]">
      <div className="border-r border-border">
        <InboxList activeId={null} />
      </div>
      <div className="hidden items-center justify-center px-6 text-center lg:flex">
        <div className="space-y-2">
          <IconMessageCircle className="mx-auto size-10 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">{t("indexPickAConversation")}</p>
        </div>
      </div>
    </div>
  );
}
