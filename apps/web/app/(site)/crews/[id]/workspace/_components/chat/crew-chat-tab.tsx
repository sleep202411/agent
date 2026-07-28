"use client";

/**
 * 群聊 — the crew workspace's default tab.
 *
 * Resolves the crew's one Conversation, then hands off to the shared
 * `ConversationView`. There is no second chat implementation here on
 * purpose: same timeline, same composer, same send-state machine, same
 * system-message renderer as /messages, reached through a different
 * door. The only difference is `surface="workspace"`, which drops the
 * back-to-inbox arrow and the "open crew" link (we are already in the
 * crew).
 *
 * No WebSocket is opened here either. `ConversationsProvider` holds the
 * one socket for the whole tab (components/providers.tsx) and patches
 * the React Query cache; this view just reads that cache. Per-component
 * sockets were the bug the chat module already paid for once — see
 * `src/lib/conversations/ws-client.ts`.
 *
 * Sizing: the parent gives this a bounded box (the workspace switches
 * to a fixed-height app shell on this tab) and `ConversationView` is
 * `flex h-full flex-col` with a `min-h-0 flex-1` scroller, so the
 * composer stays pinned to the bottom of the pane on desktop and
 * mobile alike (doc §9).
 */

import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { ConversationView } from "@/app/(site)/messages/_components/conversation-view";
import { useCrewConversation } from "@/app/(site)/crews/[id]/workspace/_hooks/use-crew-conversation";

export function CrewChatTab({ crewId }: { crewId: string }) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const conversation = useCrewConversation(crewId);

  if (conversation.isPending) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl bg-card/40">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (conversation.error || !conversation.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl bg-card/40 px-6 text-center">
        <IconAlertTriangle className="size-6 text-destructive" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{t("chatUnavailableTitle")}</p>
          {/* The server's own words. "无法打开群聊" tells the reader
              nothing; "You are no longer a member of this crew" tells
              them exactly what to do next. */}
          <p className="max-w-sm text-xs text-muted-foreground">{conversation.error?.message}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          color="muted"
          onClick={() => void conversation.refetch()}
          disabled={conversation.isFetching}
        >
          {conversation.isFetching ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
          {tc("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden rounded-xl bg-card/40">
      <ConversationView conversationId={conversation.data.id} surface="workspace" />
    </div>
  );
}
