"use client";

/**
 * Crew chat timeline — shared by the private team channel and public community channel.
 *
 * Resolves the crew's one Conversation, then hands off to the shared
 * `ConversationView`. There is no second chat implementation here on
 * purpose: same timeline, same composer, same send-state machine, same
 * system-message renderer as /messages, reached through a different
 * door. The only difference is `surface="workspace"`, which drops the
 * back-to-inbox arrow and the "open crew" link (we are already in the
 * crew).
 *
 * `ConversationsProvider` owns one per-user Ably connection for inbox and
 * invalidation frames. This surface additionally joins the crew's one
 * `@ably/chat` Room for room continuity, history and presence.
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
import { useCrewCommunityConversation } from "@/app/(site)/crews/[id]/workspace/_hooks/use-crew-community-conversation";
import { CrewChatRoom } from "@/src/lib/conversations/crew-chat-room";

export function CrewChatTab({
  crewId,
  channel = "team",
}: {
  crewId: string;
  channel?: "team" | "community";
}) {
  return channel === "community" ? (
    <CommunityConversation crewId={crewId} />
  ) : (
    <TeamConversation crewId={crewId} />
  );
}

function TeamConversation({ crewId }: { crewId: string }) {
  return <ResolvedConversation conversation={useCrewConversation(crewId)} />;
}

function CommunityConversation({ crewId }: { crewId: string }) {
  return <ResolvedConversation conversation={useCrewCommunityConversation(crewId)} />;
}

function ResolvedConversation({
  conversation,
}: {
  conversation: ReturnType<typeof useCrewConversation>;
}) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");

  const content = (() => {
    if (conversation.isPending) {
      return (
        <div className="flex h-full items-center justify-center bg-card/40">
          <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (conversation.error || !conversation.data) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-card/40 px-6 text-center">
          <IconAlertTriangle className="size-6 text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">{t("chatUnavailableTitle")}</p>
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
      <CrewChatRoom conversationId={conversation.data.id}>
        <ConversationView conversationId={conversation.data.id} surface="workspace" />
      </CrewChatRoom>
    );
  })();

  return <div className="h-full min-h-0 min-w-0 overflow-hidden bg-[#090a0c]">{content}</div>;
}
