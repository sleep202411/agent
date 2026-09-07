"use client";

import { IconMessageCircle } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { InboxList } from "./inbox-list";

export function ChatInbox() {
  const t = useTranslations("messages");
  return (
    <div className="grid h-full min-h-0 grid-cols-1 grid-rows-1 bg-background text-foreground lg:grid-cols-[320px_1fr]">
      <div className="min-h-0 min-w-0 border-r border-border">
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
