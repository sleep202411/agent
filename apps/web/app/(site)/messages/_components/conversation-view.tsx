"use client";

/**
 * ConversationView — the message timeline + composer for one
 * conversation. Mounted twice:
 *
 *   - as the right pane of /messages (`surface="inbox"`),
 *   - embedded in the crew workspace's 群聊 tab
 *     (`surface="workspace"`), which supplies its own navigation.
 *
 * There is deliberately ONE chat implementation. The crew group chat is
 * the same Conversation row type reached through a different door, so
 * forking a second timeline / composer would have meant two send-state
 * machines and two system-message renderers to keep in step.
 *
 * Responds to incoming WS pushes (cache patched by
 * ConversationsProvider) by re-rendering from the React Query cache —
 * this component never opens a socket of its own.
 *
 * Per-message rendering branches on type:
 *   - text:     standard bubble (left=other, right=me)
 *   - proposal: ProposalCard with Accept/Decline buttons for buyer
 *               when status === 'open'
 *   - system:   centered chip with i18n template render
 *
 * Auto mark-as-read fires only while the newest message is actually
 * visible: the reader is at the bottom and the browser tab is visible.
 * Loading older pages preserves the scroll anchor instead of pulling
 * the reader back to the newest message.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconAt,
  IconBriefcase,
  IconFolderOpen,
  IconHash,
  IconLoader2,
  IconPaperclip,
  IconPlus,
  IconSend,
  IconShoppingBag,
  IconSparkles,
  IconUsersGroup,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import type {
  ConversationDTO,
  ConversationAttachmentPayload,
  ConversationMentionPayload,
  ConversationParticipantRole,
  ConversationTaskReferencePayload,
  MessageDTO,
  MessagePayload,
  ProposalPayload,
} from "@repo/shared/conversation";
import { ZERO_DECIMAL_CURRENCIES } from "@repo/shared/crew";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useCrewDetail } from "@/app/(site)/crews/_hooks/use-crew";
import { useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { CrewLogo } from "@/app/(site)/messages/_components/crew-logo";
import { UserAvatar } from "@/components/user-avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { uploadFileViaSignedUrl } from "@/src/lib/media-upload";
import {
  isConversationAccessError,
  isOptimisticConversationMessage,
  useConversation,
  useClearConversationAccessCache,
  useDeclineProposal,
  useMarkRead,
  useMessages,
  useSendAttachments,
  useSendText,
} from "@/app/(site)/creators/_hooks/use-conversations";
import {
  discardPendingCrewAssetUpload,
  useCrewAssetContext,
  useCrewAssets,
  type CrewAssetNodeDTO,
} from "@/app/(site)/crews/[id]/workspace/_hooks/use-crew-assets";
import { useCrewTaskOptions } from "@/app/(site)/crews/_hooks/use-tasks";
import type { CrewTaskOptionDTO } from "@/app/(site)/crews/_hooks/types";
import { useAcceptProposal } from "@/app/(site)/creators/_hooks/use-orders";
import { CrewChatContextPanel, type CrewChatContext } from "./crew-chat-context-panel";
import { SendProposalDialog } from "./send-proposal-dialog";
import { AttachmentKindIcon, AttachmentVisual, fileExtension } from "./attachment-visual";

/**
 * Where the view is mounted. `inbox` is the /messages route: the
 * conversation replaces the inbox on small screens, so it needs a back
 * arrow, and links out to the thread's context. `workspace` is the crew
 * tab, which is already inside the crew — a back arrow to /messages and
 * an "open crew" link that points at the page you are on would both be
 * noise.
 */
type ConversationSurface = "inbox" | "workspace";

interface ConversationViewProps {
  conversationId: string;
  surface?: ConversationSurface;
}

export function ConversationView({ conversationId, surface = "inbox" }: ConversationViewProps) {
  const tm = useTranslations("messages");
  const tc = useTranslations("common");
  const locale = useLocale() as Locale;
  const { user } = useCurrentUser();
  const router = useRouter();

  const [blockedAccess, setBlockedAccess] = useState<{
    conversationId: string;
    message: string;
  } | null>(null);
  const accessIsLatched = blockedAccess?.conversationId === conversationId;
  // Once access is known to be gone, leave both observers mounted but
  // disabled. The following commit can then remove their cache entries
  // without triggering a 404/refetch/remove loop.
  const conversationQuery = useConversation(conversationId, !accessIsLatched);
  const messages = useMessages(conversationId, !accessIsLatched);
  const clearAccessCache = useClearConversationAccessCache();
  const accessError = isConversationAccessError(conversationQuery.error)
    ? conversationQuery.error
    : isConversationAccessError(messages.error)
      ? messages.error
      : null;
  // Keep the boundary latched after clearing the errored React Query
  // entries. Otherwise removing those entries would also remove their
  // error, briefly resurrecting stale conversation data or the
  // composer before navigation/unmount finishes.
  const accessBlocked = accessIsLatched || accessError !== null;
  const conversation = accessBlocked ? undefined : conversationQuery.data;
  const convLoading = !accessBlocked && conversationQuery.isLoading;
  const items = useMemo(
    () => (accessBlocked ? [] : (messages.data?.items ?? [])),
    [accessBlocked, messages.data]
  );

  useEffect(() => {
    if (!accessError) return;
    let current = true;
    // Latch on the next microtask so this effect remains an external
    // query-state synchronization point rather than a cascading
    // synchronous render.
    queueMicrotask(() => {
      if (!current) return;
      setBlockedAccess({
        conversationId,
        message: accessError.message,
      });
    });
    return () => {
      current = false;
    };
  }, [accessError, conversationId]);

  useEffect(() => {
    if (!accessIsLatched) return;
    clearAccessCache(conversationId);
  }, [accessIsLatched, clearAccessCache, conversationId]);

  // ONE batched display lookup for the whole thread — every
  // participant, every message author, and every user a crew system
  // message is about. Resolving per row (which is what the bubbles used
  // to do) costs one request per distinct person: fine for a two-party
  // inquiry, wasteful the moment a twelve-person crew chat opens.
  const displayIds = useMemo(
    () => collectDisplayIds(conversation?.participants ?? [], items),
    [conversation?.participants, items]
  );
  const displays = useUserDisplays(displayIds);
  const [crewContextState, setCrewContextState] = useState<{
    conversationId: string;
    context: CrewChatContext;
  } | null>(null);
  const crewContext =
    crewContextState?.conversationId === conversationId ? crewContextState.context : null;
  const setCrewContext = (context: CrewChatContext | null) => {
    setCrewContextState(context ? { conversationId, context } : null);
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible"
  );
  const [windowFocused, setWindowFocused] = useState(
    () => typeof document === "undefined" || document.hasFocus()
  );
  const scrollSnapshotRef = useRef<{ height: number; top: number } | null>(null);
  const renderedConversationRef = useRef<string | null>(null);
  const previousItemCountRef = useRef(0);

  const updateBottomState = useCallback((next: boolean) => {
    atBottomRef.current = next;
    setAtBottom((current) => (current === next ? current : next));
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      setPageVisible(document.visibilityState === "visible");
    };
    const onFocus = () => setWindowFocused(true);
    const onBlur = () => setWindowFocused(false);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Apply scroll changes before paint. A prepend restores the same
  // visible content; a new tail follows only when the reader was already
  // at the bottom (or authored the new message themselves).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const isNewConversation = renderedConversationRef.current !== conversationId;
    if (isNewConversation) {
      renderedConversationRef.current = conversationId;
      previousItemCountRef.current = 0;
      scrollSnapshotRef.current = null;
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
      updateBottomState(true);
    } else if (scrollSnapshotRef.current) {
      const snapshot = scrollSnapshotRef.current;
      scrollSnapshotRef.current = null;
      el.scrollTop = snapshot.top + (el.scrollHeight - snapshot.height);
      updateBottomState(isTimelineAtBottom(el));
    } else {
      const latest = items[items.length - 1];
      const shouldFollow = atBottomRef.current || (!!user && latest?.authorId === user.id);
      if (shouldFollow && items.length !== previousItemCountRef.current) {
        el.scrollTo({
          top: el.scrollHeight,
          behavior: previousItemCountRef.current === 0 ? "auto" : "smooth",
        });
        updateBottomState(true);
      }
    }
    previousItemCountRef.current = items.length;
  }, [conversationId, items, updateBottomState, user]);

  // Mark-as-read only when the latest item is genuinely in view. A
  // hidden tab or somebody reading older history must keep its unread
  // badge until the reader comes back to the tail.
  const markRead = useMarkRead(conversationId);
  const lastSeenRef = useRef<string | null>(null);
  useEffect(() => {
    lastSeenRef.current = null;
  }, [conversationId]);
  useEffect(() => {
    if (
      accessBlocked ||
      messages.isFetching ||
      messages.isError ||
      !user ||
      !pageVisible ||
      !windowFocused ||
      !atBottom ||
      items.length === 0
    )
      return;
    const latest = items[items.length - 1];
    if (latest.id === lastSeenRef.current) return;
    lastSeenRef.current = latest.id;
    // Always advance to the newest visible message — even when it's
    // my own. The server's markRead is monotonic; pushing the
    // cursor past my own reply also clears any earlier unread tail
    // from the other side that I just scrolled past. Skipping the
    // call when the latest message is mine was the bug: replying to
    // an unread message left the badge stuck.
    markRead.mutate(
      { lastReadMessageId: latest.id },
      {
        onError: () => {
          if (lastSeenRef.current === latest.id) lastSeenRef.current = null;
        },
      }
    );
  }, [
    accessBlocked,
    messages.isFetching,
    messages.isError,
    items,
    user,
    pageVisible,
    windowFocused,
    atBottom,
    markRead,
  ]);

  if (accessBlocked) {
    return (
      <QueryFailure
        title={tm("conversationUnavailableTitle")}
        message={
          accessError?.message ??
          (accessIsLatched ? blockedAccess.message : tm("conversationUnavailableFallback"))
        }
        retryLabel={tc("retry")}
        isRetrying={!!conversationQuery.isFetching || !!messages.isFetching}
        onRetry={() =>
          setBlockedAccess((current) =>
            current?.conversationId === conversationId ? null : current
          )
        }
      />
    );
  }

  if (convLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!conversation) {
    return (
      <QueryFailure
        title={tm("conversationUnavailableTitle")}
        message={
          conversationQuery.error instanceof Error
            ? conversationQuery.error.message
            : tm("conversationUnavailableFallback")
        }
        retryLabel={tc("retry")}
        isRetrying={!!conversationQuery.isFetching}
        onRetry={() => void conversationQuery.refetch()}
      />
    );
  }

  const me = user ? conversation.participants.find((p) => p.userId === user.id) : undefined;
  const myRole = me?.role ?? null;

  const loadEarlier = () => {
    const el = scrollRef.current;
    if (el) {
      scrollSnapshotRef.current = { height: el.scrollHeight, top: el.scrollTop };
    }
    void Promise.resolve(messages.fetchNextPage()).finally(() => {
      // A failed or empty page causes no item render to consume the
      // snapshot. Clear it after React has had a frame to commit a
      // successful cache update.
      requestAnimationFrame(() => {
        scrollSnapshotRef.current = null;
      });
    });
  };

  return (
    <section className="flex h-full min-h-0 min-w-0 bg-[#0c0e11]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ConversationHeader
          conversation={conversation}
          viewerId={user?.id ?? null}
          surface={surface}
          displays={displays}
        />

        <div
          ref={scrollRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          onScroll={(event) => updateBottomState(isTimelineAtBottom(event.currentTarget))}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-5",
            conversation.contextType === "crew" ? "space-y-0" : "space-y-3"
          )}
        >
          {messages.isError ? (
            <div
              role="alert"
              className="mx-auto mb-3 flex max-w-md items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              <IconAlertTriangle className="mt-px size-4 shrink-0" />
              <span className="min-w-0 flex-1 break-words">
                <span className="font-semibold">{tm("messagesUnavailableTitle")}</span>
                {" — "}
                {messages.error instanceof Error
                  ? messages.error.message
                  : tm("messagesUnavailableFallback")}
              </span>
              <button
                type="button"
                onClick={() => void messages.refetch()}
                className="shrink-0 font-semibold underline underline-offset-2"
              >
                {tc("retry")}
              </button>
            </div>
          ) : null}

          {messages.hasNextPage ? (
            <nav aria-label={tm("loadEarlier")} className="flex justify-center pb-4">
              <button
                type="button"
                onClick={loadEarlier}
                disabled={messages.isFetchingNextPage}
                className="text-[10px] text-[#737983] hover:text-[#d9dce1]"
              >
                {messages.isFetchingNextPage ? (
                  <IconLoader2 className="mr-1 inline size-3 animate-spin" />
                ) : null}
                {tm("loadEarlier")}
              </button>
            </nav>
          ) : null}

          {messages.isLoading && items.length === 0 ? (
            <div className="flex h-32 items-center justify-center">
              <IconLoader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 && !messages.isError ? (
            <EmptyCrewTimeline
              isCrew={conversation.contextType === "crew"}
              crewChannel={conversation.crewChannel}
            />
          ) : (
            items.map((message, index) => (
              <MessageRow
                key={message.id}
                message={message}
                viewerId={user?.id ?? null}
                participants={conversation.participants}
                myRole={myRole}
                conversationId={conversationId}
                contextType={conversation.contextType}
                displays={displays}
                prev={items[index - 1]}
                onOpenContext={setCrewContext}
                onOrderCreated={(orderId) =>
                  router.push(localizePath(`/orders/${orderId}`, locale))
                }
              />
            ))
          )}
        </div>

        <Composer
          key={conversationId}
          conversationId={conversationId}
          contextType={conversation.contextType}
          contextId={conversation.contextId}
          crewChannel={conversation.crewChannel}
          participants={conversation.participants}
          displays={displays}
          viewerId={user?.id ?? null}
          canSendProposal={myRole === "creator" && conversation.contextType === "service"}
        />
      </div>
      {conversation.contextType === "crew" && conversation.crewChannel === "team" && crewContext ? (
        <CrewChatContextPanel
          crewId={conversation.contextId}
          context={crewContext}
          onClose={() => setCrewContext(null)}
        />
      ) : null}
    </section>
  );
}

function QueryFailure({
  title,
  message,
  retryLabel,
  isRetrying,
  onRetry,
}: {
  title: string;
  message: string;
  retryLabel: string;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <IconAlertTriangle className="size-6 text-destructive" />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="max-w-sm text-xs text-muted-foreground">{message}</p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        color="muted"
        onClick={onRetry}
        disabled={isRetrying}
      >
        {isRetrying ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
        {retryLabel}
      </Button>
    </div>
  );
}

function EmptyCrewTimeline({
  isCrew,
  crewChannel,
}: {
  isCrew: boolean;
  crewChannel: ConversationDTO["crewChannel"];
}) {
  const tm = useTranslations("messages");
  if (!isCrew) {
    return (
      <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
        {tm("noMessagesYet")}
      </div>
    );
  }
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center px-6 text-center">
      <span className="grid size-11 place-items-center rounded-xl bg-white/[0.045] text-[#858b95]">
        <IconHash className="size-5" />
      </span>
      <h2 className="mt-4 text-[13px] font-semibold text-[#eceef2]">
        {crewChannel === "community" ? tm("emptyCommunityChatTitle") : tm("emptyCrewChatTitle")}
      </h2>
      <p className="mt-1.5 text-[12px] leading-5 text-[#c2c6cd]">
        {crewChannel === "community"
          ? tm("emptyCommunityChatDescription")
          : tm("emptyCrewChatDescription")}
      </p>
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────

function ConversationHeader({
  conversation,
  viewerId,
  surface,
  displays,
}: {
  conversation: ConversationDTO;
  viewerId: string | null;
  surface: ConversationSurface;
  displays: DisplayMap;
}) {
  const tm = useTranslations("messages");
  const locale = useLocale() as Locale;

  // A crew thread is N-party: there is no counterparty to resolve, and
  // asking the user lookup for `contextId` would query a crew id as if
  // it were a user. Crew name + logo come from the crew itself (the
  // same cache entry the workspace already holds, so this is free
  // there); the member count is the participant list, which the server
  // keeps in sync with `crew_members`.
  const isCrew = conversation.contextType === "crew";
  const isCommunityChannel = isCrew && conversation.crewChannel === "community";
  const crew = useCrewDetail(isCrew ? conversation.contextId : "");

  const counterparty = isCrew
    ? undefined
    : viewerId
      ? conversation.participants.find((p) => p.userId !== viewerId)
      : conversation.participants[0];

  const name = isCrew
    ? (crew.data?.name ?? tm("crewChatFallbackName"))
    : counterparty
      ? displayName(counterparty.userId, displays, tm)
      : "—";

  const Icon = isCrew
    ? IconUsersGroup
    : conversation.contextType === "order"
      ? IconShoppingBag
      : IconBriefcase;

  // Both context links only make sense from the inbox — inside the crew
  // workspace the "open crew" link would point at the current page.
  const contextHref =
    surface !== "inbox"
      ? null
      : conversation.contextType === "order"
        ? localizePath(`/orders/${conversation.contextId}`, locale)
        : isCrew
          ? `${localizePath(`/crews/${conversation.contextId}/workspace`, locale)}${
              isCommunityChannel ? "?tab=chat&channel=community" : ""
            }`
          : null;

  if (surface === "workspace" && isCrew) {
    return (
      <header className="flex h-[58px] shrink-0 items-center gap-3 border-b border-white/[0.065] px-4">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white/[0.04] text-[#9298a2]">
          <IconHash className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-[#eceef2]">
            {isCommunityChannel ? tm("communityChannelName") : tm("crewChannelName")}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[12px] text-[#c2c6cd]">
            <span>
              {isCommunityChannel
                ? tm("communityParticipantCount", { count: conversation.participants.length })
                : tm("crewMemberCount", { count: conversation.participants.length })}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {isCommunityChannel
                ? tm("communityChannelDescription")
                : tm("crewChannelDescription")}
            </span>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
      {surface === "inbox" ? (
        <Link
          href={localizePath("/messages", locale)}
          className="rounded-md p-1 text-muted-foreground hover:bg-secondary lg:hidden"
          aria-label={tm("backToInbox")}
        >
          <IconArrowLeft className="size-4" />
        </Link>
      ) : null}
      {isCrew ? (
        <CrewLogo
          logo={crew.data?.logo}
          name={name}
          crewId={conversation.contextId}
          className="size-9"
        />
      ) : (
        <UserAvatar
          src={counterparty ? displays.get(counterparty.userId)?.avatar : undefined}
          name={name}
          seed={counterparty?.userId ?? "x"}
          className="size-9"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="line-clamp-1 text-sm font-medium text-foreground">{name}</div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Icon className="size-3" />
          {isCrew
            ? isCommunityChannel
              ? tm("communityParticipantCount", { count: conversation.participants.length })
              : tm("crewMemberCount", { count: conversation.participants.length })
            : tm(`contextType.${conversation.contextType}`)}
          {contextHref ? (
            <>
              <span>·</span>
              <Link href={contextHref} className="text-primary hover:underline">
                {isCrew
                  ? isCommunityChannel
                    ? tm("openCommunityChannel")
                    : tm("openCrewWorkspace")
                  : tm("openOrder")}
              </Link>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

// ─── Per-message row ────────────────────────────────────────

/**
 * Consecutive posts share an avatar lane only while they are part of the
 * same short burst. Author equality alone is not enough: otherwise one
 * person's first post of the afternoon stays visually attached to a post
 * from the morning, which makes the new message look as if it lost its
 * avatar.
 */
const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1_000;

export function startsNewMessageGroup(message: MessageDTO, prev?: MessageDTO): boolean {
  if (!prev || prev.authorId !== message.authorId || prev.type === "proposal") return true;
  const currentAt = Date.parse(message.createdAt);
  const previousAt = Date.parse(prev.createdAt);
  if (!Number.isFinite(currentAt) || !Number.isFinite(previousAt) || currentAt < previousAt) {
    return true;
  }
  return currentAt - previousAt > MESSAGE_GROUP_WINDOW_MS;
}

function MessageRow({
  message,
  viewerId,
  participants,
  myRole,
  conversationId,
  contextType,
  displays,
  prev,
  onOpenContext,
  onOrderCreated,
}: {
  message: MessageDTO;
  viewerId: string | null;
  participants: ConversationDTO["participants"];
  myRole: ConversationParticipantRole | null;
  conversationId: string;
  contextType: ConversationDTO["contextType"];
  displays: DisplayMap;
  prev?: MessageDTO;
  onOpenContext: (context: CrewChatContext) => void;
  onOrderCreated: (orderId: string) => void;
}) {
  if (message.type === "system") {
    return <SystemRow message={message} displays={displays} isCrew={contextType === "crew"} />;
  }
  if (message.type === "proposal") {
    return (
      <ProposalRow
        message={message}
        myRole={myRole}
        conversationId={conversationId}
        contextType={contextType}
        onOrderCreated={onOrderCreated}
      />
    );
  }
  const isMine = !!viewerId && message.authorId === viewerId;
  const author = participants.find((p) => p.userId === message.authorId);
  const startsStreak = startsNewMessageGroup(message, prev);
  const authoredProps = {
    message,
    isMine,
    showAvatar: contextType === "crew" ? startsStreak : !isMine && startsStreak,
    showAuthorName: startsStreak && contextType === "crew",
    authorId: author?.userId ?? null,
    displays,
    isCrew: contextType === "crew",
  };

  const payload = (message.payload ?? null) as MessagePayload | null;
  if ((message.type === "image" || message.type === "file") && payload?.kind === "attachments") {
    return (
      <AttachmentMessageRow
        {...authoredProps}
        attachments={payload.attachments}
        onOpenContext={(attachment) => onOpenContext({ kind: "asset", attachment })}
      />
    );
  }

  return (
    <TextRow
      {...authoredProps}
      // A two-party thread has exactly one "them", so the avatar says
      // everything. A crew chat does not — without a name the reader
      // has to match faces to guess who wrote what.
    />
  );
}

function TextRow({
  message,
  isMine,
  showAvatar,
  showAuthorName,
  authorId,
  displays,
  isCrew,
}: {
  message: MessageDTO;
  isMine: boolean;
  showAvatar: boolean;
  showAuthorName: boolean;
  authorId: string | null;
  displays: DisplayMap;
  isCrew: boolean;
}) {
  const tm = useTranslations("messages");
  const display = authorId ? displays.get(authorId) : undefined;
  const mentions = messageMentions(message);
  const tasks = messageTaskReferences(message);
  const isOptimistic = isOptimisticConversationMessage(message);

  if (isCrew) {
    return (
      <div className={cn("flex gap-3 px-2 py-1.5", showAvatar ? "mt-2" : "mt-0")}>
        {showAvatar ? (
          <UserAvatar
            src={display?.avatar}
            name={display?.nickname ?? ""}
            seed={authorId ?? "x"}
            className="mt-0.5 size-8 shrink-0"
          />
        ) : (
          <time className="w-8 shrink-0 pt-1.5 text-right text-[9px] text-[#565c66]">
            {formatMessageTime(message.createdAt)}
          </time>
        )}
        <div className="min-w-0 flex-1">
          {showAuthorName && authorId ? (
            <div className="flex items-baseline gap-2">
              <span className="text-[12px] font-semibold text-[#e5e7eb]">
                {displayName(authorId, displays, tm)}
              </span>
              <time className="text-[9px] text-[#666c77]">
                {formatMessageTime(message.createdAt)}
              </time>
              {isMine ? (
                <span className="text-[9px] font-medium text-[#676d78]">{tm("youLabel")}</span>
              ) : null}
            </div>
          ) : null}
          <div className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-[1.55] text-[#eef0f3]">
            <RichMessageBody body={message.body} mentions={mentions} tasks={tasks} />
            {isOptimistic ? (
              <span role="status" aria-label={tm("sending")} className="ml-1.5 inline-flex">
                <IconLoader2 className="size-3 animate-spin text-[#777d87]" />
              </span>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex items-end gap-2", isMine ? "flex-row-reverse" : "flex-row")}>
      {/* Reserve avatar lane on the other side, but only render when
          this is the first message in a streak from that author. */}
      {!isMine ? (
        showAvatar ? (
          <UserAvatar
            src={display?.avatar}
            name={display?.nickname ?? ""}
            seed={authorId ?? "x"}
            className="size-7"
          />
        ) : (
          <div className="size-7" />
        )
      ) : null}
      <div className="flex min-w-0 flex-col gap-0.5">
        {showAuthorName && authorId ? (
          <span className="px-1 text-[11px] text-muted-foreground">
            {displayName(authorId, displays, tm)}
          </span>
        ) : null}
        <div
          className={cn(
            "max-w-[min(70%,32rem)] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm",
            isMine ? "bg-primary text-primary-foreground" : "bg-card text-foreground"
          )}
        >
          <RichMessageBody body={message.body} mentions={mentions} tasks={tasks} />
          {isOptimistic ? (
            <span role="status" aria-label={tm("sending")} className="ml-1.5 inline-flex">
              <IconLoader2 className="size-3 animate-spin opacity-70" />
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AuthoredCardShell({
  message,
  isMine,
  showAvatar,
  showAuthorName,
  authorId,
  displays,
  isCrew,
  children,
}: {
  message: MessageDTO;
  isMine: boolean;
  showAvatar: boolean;
  showAuthorName: boolean;
  authorId: string | null;
  displays: DisplayMap;
  isCrew: boolean;
  children: React.ReactNode;
}) {
  const tm = useTranslations("messages");
  const display = authorId ? displays.get(authorId) : undefined;
  const mentions = messageMentions(message);
  const tasks = messageTaskReferences(message);

  if (isCrew) {
    return (
      <div className={cn("flex gap-3 px-2 py-1.5", showAvatar ? "mt-2" : "mt-0")}>
        {showAvatar ? (
          <UserAvatar
            src={display?.avatar}
            name={display?.nickname ?? ""}
            seed={authorId ?? "x"}
            className="mt-0.5 size-8 shrink-0"
          />
        ) : (
          <time className="w-8 shrink-0 pt-1.5 text-right text-[9px] text-[#565c66]">
            {formatMessageTime(message.createdAt)}
          </time>
        )}
        <div className="min-w-0 flex-1">
          {showAuthorName && authorId ? (
            <div className="flex items-baseline gap-2">
              <span className="text-[12px] font-semibold text-[#e5e7eb]">
                {displayName(authorId, displays, tm)}
              </span>
              <time className="text-[9px] text-[#666c77]">
                {formatMessageTime(message.createdAt)}
              </time>
              {isMine ? (
                <span className="text-[9px] font-medium text-[#676d78]">{tm("youLabel")}</span>
              ) : null}
            </div>
          ) : null}
          {message.body ? (
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-[1.55] text-[#eef0f3]">
              <RichMessageBody body={message.body} mentions={mentions} tasks={tasks} />
            </p>
          ) : null}
          <div className="mt-1.5 max-w-[820px]">{children}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex items-end gap-2", isMine ? "flex-row-reverse" : "flex-row")}>
      {!isMine ? (
        showAvatar ? (
          <UserAvatar
            src={display?.avatar}
            name={display?.nickname ?? ""}
            seed={authorId ?? "x"}
            className="size-7"
          />
        ) : (
          <div className="size-7" />
        )
      ) : null}
      <div className="flex min-w-0 max-w-[min(78%,34rem)] flex-col gap-1">
        {showAuthorName && authorId ? (
          <span className="px-1 text-[11px] text-muted-foreground">
            {displayName(authorId, displays, tm)}
          </span>
        ) : null}
        {message.body ? (
          <p
            className={cn(
              "whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm",
              isMine ? "bg-primary text-primary-foreground" : "bg-card text-foreground"
            )}
          >
            <RichMessageBody body={message.body} mentions={mentions} tasks={tasks} />
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

function AttachmentMessageRow({
  attachments,
  onOpenContext,
  ...shell
}: {
  attachments: ConversationAttachmentPayload[];
  onOpenContext: (attachment: ConversationAttachmentPayload) => void;
  message: MessageDTO;
  isMine: boolean;
  showAvatar: boolean;
  showAuthorName: boolean;
  authorId: string | null;
  displays: DisplayMap;
  isCrew: boolean;
}) {
  const tm = useTranslations("messages");
  return (
    <AuthoredCardShell {...shell}>
      <div
        className={cn(
          "grid max-w-[560px] gap-1.5",
          attachments.length > 1 ? "grid-cols-2" : "grid-cols-1"
        )}
      >
        {attachments.map((attachment) => {
          const href = `/aurora/media/assets/${encodeURIComponent(
            attachment.mediaAssetId
          )}/content`;
          const isPreviewable =
            attachment.mediaKind === "image" || attachment.mediaKind === "video";
          const extension = fileExtension(attachment.name);
          return (
            <a
              key={attachment.assetNodeId}
              href={href}
              onClick={(event) => {
                event.preventDefault();
                onOpenContext(attachment);
              }}
              className={cn(
                "group min-w-0 overflow-hidden rounded-lg bg-white/[0.045] transition-colors hover:bg-white/[0.07]",
                isPreviewable ? "block" : "flex items-center gap-3 p-2.5"
              )}
            >
              {isPreviewable ? (
                <>
                  <AttachmentVisual
                    name={attachment.name}
                    mediaKind={attachment.mediaKind}
                    src={href}
                    className={cn(
                      "w-full",
                      attachments.length === 1 ? "aspect-[16/10] max-h-72" : "aspect-square"
                    )}
                  />
                  <span className="flex min-w-0 items-center gap-2 px-2.5 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium text-[#e5e7eb]">
                        {attachment.name}
                      </span>
                      <span className="mt-0.5 block text-[9px] text-[#727985]">
                        {attachment.sizeBytes == null
                          ? tm(`mediaKind.${attachment.mediaKind}`)
                          : formatBytes(attachment.sizeBytes)}
                        <span aria-hidden="true"> · </span>
                        {tm("savedToCrewAssets")}
                      </span>
                    </span>
                    <span className="text-[10px] font-medium text-[#858b95] transition-colors group-hover:text-white">
                      {tm("preview")}
                    </span>
                  </span>
                </>
              ) : (
                <span className="flex size-11 shrink-0 flex-col items-center justify-center rounded-md bg-white/[0.055]">
                  <AttachmentKindIcon
                    kind={attachment.mediaKind}
                    className="size-4 text-[#858b95]"
                  />
                  {extension ? (
                    <span className="mt-0.5 max-w-9 truncate text-[7px] font-semibold uppercase tracking-[0.06em] text-[#656c77]">
                      {extension}
                    </span>
                  ) : null}
                </span>
              )}
              {!isPreviewable ? (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-medium text-[#e5e7eb]">
                    {attachment.name}
                  </span>
                  <span className="mt-0.5 block text-[9px] text-[#727985]">
                    {tm(`mediaKind.${attachment.mediaKind}`)}
                    {attachment.sizeBytes == null ? null : (
                      <>
                        <span aria-hidden="true"> · </span>
                        {formatBytes(attachment.sizeBytes)}
                      </>
                    )}
                  </span>
                  <span className="mt-1 block text-[8px] text-[#5f6671]">
                    {tm("savedToCrewAssets")}
                  </span>
                </span>
              ) : null}
              {!isPreviewable ? (
                <span className="text-[10px] font-medium text-[#858b95] transition-colors group-hover:text-white">
                  {tm("preview")}
                </span>
              ) : null}
            </a>
          );
        })}
      </div>
    </AuthoredCardShell>
  );
}

function SystemRow({
  message,
  displays,
  isCrew,
}: {
  message: MessageDTO;
  displays: DisplayMap;
  isCrew: boolean;
}) {
  const tm = useTranslations("messages");
  const presentation = systemMessagePresentation(message, displays, tm);
  if (!presentation) return null;

  if (isCrew) {
    return <CrewSystemEventLine message={message} presentation={presentation} />;
  }

  return (
    <div className="flex min-w-0 flex-col items-center gap-2 py-1">
      <span className="rounded-full bg-secondary px-3 py-1 text-[11px] text-muted-foreground">
        {presentation.label}
      </span>
      {presentation.reason && (
        <p className="w-full max-w-xl whitespace-pre-wrap break-words rounded-lg bg-secondary px-4 py-3 text-sm text-foreground [overflow-wrap:anywhere]">
          {presentation.reason}
        </p>
      )}
    </div>
  );
}

type SystemMessagePresentation = {
  label: string;
  reason?: string;
};

function systemMessagePresentation(
  message: MessageDTO,
  displays: DisplayMap,
  tm: ReturnType<typeof useTranslations>
): SystemMessagePresentation | null {
  const payload = (message.payload ?? null) as MessagePayload | null;
  const system = payload?.kind === "system" ? payload.system : null;
  if (!system) return null;
  const kind = system.kind;
  const key = `system.${kind}` as const;
  // Server params surface as i18n interpolation variables. Cast to
  // string|number to satisfy the t() signature.
  const params: Record<string, string | number> = {};
  for (const [paramKey, value] of Object.entries(system.params)) {
    params[paramKey] = value as string | number;
  }
  // Crew system messages name the member they are about, and the wire
  // carries an id (`userId`) because ids are what the server owns.
  // `{user}` is the display half of that, resolved from the thread's
  // one batched lookup, so membership announcements never leak raw ids.
  const subjectId = systemSubjectId(system.params);
  if (subjectId) params.user = displayName(subjectId, displays, tm);

  return {
    reason:
      kind === "order.revision_requested" && typeof system.params.reason === "string"
        ? system.params.reason
        : undefined,
    label: tm(key, {
      ...params,
      defaultValue: tm("system.fallback", { kind }),
    }),
  };
}

/**
 * A true crew-system announcement is ambient context, not a participant
 * speaking, so it stays visually quieter than member-authored messages.
 * Routine task lifecycle changes never reach this renderer: they live in
 * task activity and targeted notifications instead of the chat timeline.
 */
function CrewSystemEventLine({
  message,
  presentation,
}: {
  message: MessageDTO;
  presentation: SystemMessagePresentation;
}) {
  return (
    <div className="ml-11 mt-0.5 mr-2">
      <span className="flex min-h-7 min-w-0 items-center gap-2 rounded px-2 text-[11px] text-[#9298a2] transition-colors hover:bg-white/[0.025] hover:text-[#c4c8cf]">
        <span className="size-1.5 shrink-0 rounded-full bg-primary/70" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{presentation.label}</span>
        <time className="shrink-0 text-[9px] text-[#5f6570]">
          {formatMessageTime(message.createdAt)}
        </time>
      </span>
    </div>
  );
}

function ProposalRow({
  message,
  myRole,
  conversationId,
  contextType,
  onOrderCreated,
}: {
  message: MessageDTO;
  myRole: ConversationParticipantRole | null;
  conversationId: string;
  contextType: ConversationDTO["contextType"];
  onOrderCreated: (orderId: string) => void;
}) {
  const payload = (message.payload ?? null) as MessagePayload | null;
  if (!payload || payload.kind !== "proposal") return null;
  const p = payload.proposal;
  return (
    <ProposalCard
      proposal={p}
      note={message.body}
      messageId={message.id}
      conversationId={conversationId}
      myRole={myRole}
      contextType={contextType}
      onOrderCreated={onOrderCreated}
    />
  );
}

function ProposalCard({
  proposal,
  note,
  messageId,
  conversationId,
  myRole,
  contextType,
  onOrderCreated,
}: {
  proposal: ProposalPayload;
  note: string;
  messageId: string;
  conversationId: string;
  myRole: ConversationParticipantRole | null;
  contextType: ConversationDTO["contextType"];
  onOrderCreated: (orderId: string) => void;
}) {
  const tm = useTranslations("messages");
  const accept = useAcceptProposal();
  const decline = useDeclineProposal(conversationId);
  const isOpen = proposal.status === "open";
  // Gate the action set on TWO things: my role + proposal status +
  // the conv still being a service inquiry. After accept evolves it
  // to order-context, every stale "open" proposal in the timeline
  // (siblings of the accepted one) becomes read-only; we never let
  // the buyer re-accept once an order exists.
  const canAct = myRole === "buyer" && isOpen && contextType === "service";
  const [declineOpen, setDeclineOpen] = useState(false);

  const priceLabel = formatPrice(proposal.price, proposal.currency);

  const handleAccept = async () => {
    try {
      const order = await accept.mutateAsync({ conversationId, messageId });
      toast.success(tm("proposalAcceptedToast"));
      onOrderCreated(order.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tm("proposalAcceptFailed"));
    }
  };

  const handleDecline = async () => {
    try {
      await decline.mutateAsync({ messageId });
      toast.success(tm("proposalDeclinedToast"));
      setDeclineOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tm("proposalDeclineFailed"));
    }
  };

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl bg-card p-4 ring-1 ring-primary/30">
      <header className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
          {tm("proposalLabel")}
        </span>
        <StatusChip status={proposal.status} />
      </header>
      {note ? (
        <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
          {note}
        </p>
      ) : null}
      <div className="mt-3 space-y-2 text-xs">
        <Row label={tm("proposalTierLabel")}>{tm(`proposalTier.${proposal.packageTier}`)}</Row>
        <Row label={tm("proposalPrice")}>
          <span className="text-lg font-bold tabular-nums text-foreground">{priceLabel}</span>
        </Row>
        <Row label={tm("proposalDelivery")}>
          {tm("nDays", { days: String(proposal.deliveryDays) })}
        </Row>
        <Row label={tm("proposalRevisions")}>
          {proposal.revisions === -1
            ? tm("revisionsUnlimited")
            : tm("revisionsCount", { count: String(proposal.revisions) })}
        </Row>
        {proposal.scope.length > 0 ? (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              {tm("proposalScope")}
            </div>
            <ul className="space-y-1">
              {proposal.scope.map((b, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/70" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {canAct ? (
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            color="muted"
            size="sm"
            onClick={() => setDeclineOpen(true)}
            disabled={accept.isPending || decline.isPending}
          >
            {tm("proposalDecline")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleAccept}
            disabled={accept.isPending || decline.isPending}
          >
            {accept.isPending ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
            {tm("proposalAccept")}
          </Button>
        </div>
      ) : null}

      {/* Decline confirmation — platform AlertDialog instead of
          window.confirm so the irreversible action carries
          explicit copy + matches the rest of the product. */}
      <AlertDialog
        open={declineOpen}
        onOpenChange={(o) => {
          if (!o && !decline.isPending) setDeclineOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tm("proposalDeclineTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tm("proposalDeclineBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={decline.isPending}>
              {tm("proposalDeclineCancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              color="destructive"
              disabled={decline.isPending}
              onClick={(e) => {
                e.preventDefault();
                void handleDecline();
              }}
            >
              {decline.isPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {tm("proposalDeclineConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatusChip({ status }: { status: ProposalPayload["status"] }) {
  const tm = useTranslations("messages");
  const tone =
    status === "accepted"
      ? "bg-emerald-500/15 text-emerald-300"
      : status === "declined" || status === "cancelled"
        ? "bg-zinc-500/15 text-zinc-300"
        : "bg-primary/15 text-primary";
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        tone
      )}
    >
      {tm(`proposalStatus.${status}`)}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-foreground">{children}</span>
    </div>
  );
}

// ─── Composer ──────────────────────────────────────────────

/** How long the "Sent" acknowledgement stays up before fading out. */
const SENT_FLASH_MS = 2_000;

/**
 * The composer is the one place doc §9's "明确的进行中、成功和失败状态"
 * has to be visible, and the failure half has to carry the server's own
 * words: "you are no longer a member of this crew" is the difference
 * between the reader rejoining and the reader retyping the message
 * forever. A toast was not enough — it disappears, and the reader is
 * left with a full textarea and no idea whether the message went out.
 *
 * So the state lives inline and next to the input:
 *   sending → spinner + "Sending…"
 *   sent    → "Sent", auto-clearing
 *   failed  → the server's message + Retry, and the draft is KEPT so
 *             retrying (or editing and resending) never costs typing.
 */
type ComposerAttachment =
  | {
      source: "asset";
      key: string;
      name: string;
      node: CrewAssetNodeDTO;
      mediaKind: ConversationAttachmentPayload["mediaKind"];
      contentType: string;
      sizeBytes: number | null;
      previewUrl: string | null;
    }
  | {
      source: "upload";
      key: string;
      name: string;
      mediaAssetId: string;
      mediaKind: ConversationAttachmentPayload["mediaKind"];
      contentType: string;
      sizeBytes: number;
      previewUrl: string | null;
    };

function releaseComposerPreviews(items: ComposerAttachment[]) {
  if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  for (const item of items) {
    if (item.source === "upload" && item.previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(item.previewUrl);
    }
  }
}

function Composer({
  conversationId,
  contextType,
  contextId,
  crewChannel,
  participants,
  displays,
  viewerId,
  canSendProposal,
}: {
  conversationId: string;
  contextType: ConversationDTO["contextType"];
  contextId: string;
  crewChannel: ConversationDTO["crewChannel"];
  participants: ConversationDTO["participants"];
  displays: DisplayMap;
  viewerId: string | null;
  canSendProposal: boolean;
}) {
  const tm = useTranslations("messages");
  const tc = useTranslations("common");
  const sendText = useSendText(conversationId, viewerId);
  const sendAttachments = useSendAttachments(conversationId);
  const isCrew = contextType === "crew" && crewChannel === "team";
  const crewId = isCrew ? contextId : "";
  const assetContext = useCrewAssetContext(crewId, isCrew);
  const [text, setText] = useState("");
  const textRef = useRef("");
  const [proposalOpen, setProposalOpen] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [taskSearch, setTaskSearch] = useState<{ start: number; query: string } | null>(null);
  const [taskIndex, setTaskIndex] = useState(0);
  const tasks = useCrewTaskOptions(
    crewId,
    {
      query: taskSearch?.query.trim() || undefined,
      limit: 8,
    },
    isCrew && taskSearch !== null
  );
  const assets = useCrewAssets(
    crewId,
    { source: "recent", sort: "modified", kind: "file" },
    isCrew && assetPickerOpen
  );
  const taskReferencesRef = useRef<ConversationTaskReferencePayload[]>([]);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const [mentions, setMentions] = useState<ConversationMentionPayload[]>([]);
  const mentionsRef = useRef<ConversationMentionPayload[]>([]);
  const [mentionSearch, setMentionSearch] = useState<{
    start: number;
    query: string;
  } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [uploadProgress, setUploadProgress] = useState<
    Record<string, { name: string; progress: number }>
  >({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const mountedRef = useRef(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Bumped on each successful send; the effect zeroes it after the
  // flash. A counter rather than a timestamp so two sends inside the
  // same millisecond still each get their own acknowledgement.
  const [sentFlash, setSentFlash] = useState(0);
  // Idempotency token for the message currently in the box. Held
  // across retries so a resend after a timeout collapses onto the row
  // the first attempt may already have created; discarded the moment
  // the draft changes, because an edited draft is a DIFFERENT message
  // and reusing the key would make the server hand back the old one.
  const clientKeyRef = useRef<string | null>(null);
  const draftVersionRef = useRef(0);
  const isSending = sendText.isPending || sendAttachments.isPending;
  const isUploading = Object.keys(uploadProgress).length > 0;
  const canUpload =
    assetContext.data?.storageAvailable === true && assetContext.data.capabilities.upload;
  const uploadAvailabilityMessage = assetContext.isLoading
    ? tm("crewFileUploadChecking")
    : assetContext.error
      ? assetContext.error.message
      : !canUpload
        ? tm("crewFileUploadUnavailable")
        : null;
  const mentionCandidates = useMemo(() => {
    const query = mentionSearch?.query.trim().toLocaleLowerCase() ?? "";
    return participants
      .filter((participant) => participant.userId !== viewerId)
      .map((participant) => {
        const display = displays.get(participant.userId);
        return {
          userId: participant.userId,
          label: display?.nickname?.trim() || tm("unknownUser", { userId: participant.userId }),
          avatar: display?.avatar,
        };
      })
      .filter((candidate) => !query || candidate.label.toLocaleLowerCase().includes(query))
      .slice(0, 8);
  }, [displays, mentionSearch?.query, participants, tm, viewerId]);
  const hasMentionableMembers = participants.some((participant) => participant.userId !== viewerId);
  const taskCandidates = (tasks.data ?? []).slice(0, 8);

  useEffect(() => {
    if (sentFlash === 0) return;
    const timer = setTimeout(() => setSentFlash(0), SENT_FLASH_MS);
    return () => clearTimeout(timer);
  }, [sentFlash]);

  const discardUploads = useCallback(
    (items: ComposerAttachment[]) => {
      if (!crewId) return;
      for (const item of items) {
        if (item.source !== "upload") continue;
        void discardPendingCrewAssetUpload(crewId, item.mediaAssetId).catch(() => {
          // Best-effort composer cleanup must not block navigation. The server
          // endpoint is idempotent and refuses to delete a claimed asset.
        });
      }
    },
    [crewId]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      discardUploads(attachmentsRef.current);
      releaseComposerPreviews(attachmentsRef.current);
    };
  }, [discardUploads]);

  const editDraft = (value: string, caret = value.length) => {
    draftVersionRef.current += 1;
    textRef.current = value;
    setText(value);
    const retainedMentions = mentionsRef.current.filter((mention) =>
      value.includes(`@${mention.label}`)
    );
    mentionsRef.current = retainedMentions;
    setMentions(retainedMentions);
    const retainedTasks = taskReferencesRef.current.filter((task) =>
      value.includes(`#${task.label}`)
    );
    taskReferencesRef.current = retainedTasks;
    const nextMentionSearch = isCrew ? findMentionSearch(value, caret) : null;
    const nextTaskSearch = isCrew ? findTaskSearch(value, caret) : null;
    setMentionSearch(nextTaskSearch ? null : nextMentionSearch);
    setTaskSearch(nextMentionSearch ? null : nextTaskSearch);
    setMentionIndex(0);
    setTaskIndex(0);
    setFailure(null);
    clientKeyRef.current = null;
  };

  const insertMention = (candidate: { userId: string; label: string }) => {
    const active = mentionSearch;
    if (!active) return;
    const before = textRef.current.slice(0, active.start);
    const caret = textareaRef.current?.selectionStart ?? textRef.current.length;
    const after = textRef.current.slice(caret);
    const inserted = `@${candidate.label} `;
    const next = `${before}${inserted}${after}`;
    const nextMentions = [
      ...mentionsRef.current.filter((mention) => mention.userId !== candidate.userId),
      { userId: candidate.userId, label: candidate.label },
    ];
    draftVersionRef.current += 1;
    textRef.current = next;
    setText(next);
    mentionsRef.current = nextMentions;
    setMentions(nextMentions);
    setMentionSearch(null);
    setTaskSearch(null);
    setMentionIndex(0);
    setFailure(null);
    clientKeyRef.current = null;
    const nextCaret = before.length + inserted.length;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const insertTask = (task: CrewTaskOptionDTO) => {
    const active = taskSearch;
    if (!active) return;
    const before = textRef.current.slice(0, active.start);
    const caret = textareaRef.current?.selectionStart ?? textRef.current.length;
    const after = textRef.current.slice(caret);
    const label = `TASK-${task.number} ${task.title}`;
    const inserted = `#${label} `;
    const next = `${before}${inserted}${after}`;
    const reference: ConversationTaskReferencePayload = {
      taskId: task.id,
      crewId,
      number: task.number,
      label,
    };
    const nextReferences = [
      ...taskReferencesRef.current.filter((candidate) => candidate.taskId !== task.id),
      reference,
    ];
    draftVersionRef.current += 1;
    textRef.current = next;
    setText(next);
    taskReferencesRef.current = nextReferences;
    setTaskSearch(null);
    setMentionSearch(null);
    setTaskIndex(0);
    setFailure(null);
    clientKeyRef.current = null;
    const nextCaret = before.length + inserted.length;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const replaceAttachments = (next: ComposerAttachment[]) => {
    const nextKeys = new Set(next.map((item) => item.key));
    releaseComposerPreviews(attachmentsRef.current.filter((item) => !nextKeys.has(item.key)));
    draftVersionRef.current += 1;
    attachmentsRef.current = next;
    setAttachments(next);
    setFailure(null);
    clientKeyRef.current = null;
  };

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const requestedFiles = files;
    if (fileInputRef.current) fileInputRef.current.value = "";
    const context = assetContext.data;
    if (!context?.storageAvailable || !context.capabilities.upload) {
      toast.error(tm("crewFileUploadUnavailable"));
      return;
    }
    const remaining = 10 - attachmentsRef.current.length;
    const selected = requestedFiles.slice(0, remaining);
    if (selected.length < requestedFiles.length) {
      toast.error(tm("attachmentLimit", { count: 10 }));
    }
    for (const file of selected) {
      if (file.size > context.maxUploadBytes) {
        toast.error(
          tm("fileTooLarge", {
            name: file.name,
            size: formatBytes(context.maxUploadBytes),
          })
        );
        continue;
      }
      const progressKey = `${file.name}:${file.size}:${file.lastModified}`;
      setUploadProgress((current) => ({
        ...current,
        [progressKey]: { name: file.name, progress: 0 },
      }));
      try {
        const result = await uploadFileViaSignedUrl(file, {
          kind: "crew_asset_file",
          scope: { crewId },
          onProgress: (progress) =>
            setUploadProgress((current) => ({
              ...current,
              [progressKey]: { name: file.name, progress },
            })),
        });
        const mediaKind = mediaKindFromFile(file);
        const attachment: ComposerAttachment = {
          source: "upload",
          key: `upload:${result.mediaAssetId}`,
          name: file.name,
          mediaAssetId: result.mediaAssetId,
          mediaKind,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          previewUrl:
            mediaKind === "image" || mediaKind === "video"
              ? createLocalAttachmentPreview(file, result.url)
              : null,
        };
        if (!mountedRef.current) {
          discardUploads([attachment]);
          releaseComposerPreviews([attachment]);
          continue;
        }
        replaceAttachments([...attachmentsRef.current, attachment]);
      } catch (error) {
        toast.error(
          `${file.name}: ${
            error instanceof Error && error.message ? error.message : tm("crewFileUploadFailed")
          }`
        );
      } finally {
        setUploadProgress((current) => {
          const next = { ...current };
          delete next[progressKey];
          return next;
        });
      }
    }
  };

  const submit = async () => {
    const draft = textRef.current;
    const body = draft.trim();
    const attachmentSnapshot = attachmentsRef.current;
    const mentionSnapshot = mentionsRef.current.filter((mention) =>
      body.includes(`@${mention.label}`)
    );
    const taskSnapshot = taskReferencesRef.current.filter((task) =>
      body.includes(`#${task.label}`)
    );
    if (isSending || isUploading || (!body && attachmentSnapshot.length === 0)) return;
    setFailure(null);
    clientKeyRef.current ??= newClientKey();
    const clientKey = clientKeyRef.current;
    const signature = draftSignature(draft, taskSnapshot, attachmentSnapshot, mentionSnapshot);
    const draftVersion = draftVersionRef.current;
    let clearedOptimistically = false;
    try {
      if (attachmentSnapshot.length > 0) {
        await sendAttachments.mutateAsync({
          attachments: attachmentSnapshot.map((item) =>
            item.source === "asset"
              ? { source: "asset" as const, assetNodeId: item.node.id }
              : {
                  source: "upload" as const,
                  mediaAssetId: item.mediaAssetId,
                  name: item.name,
                }
          ),
          body: body || undefined,
          clientKey,
          mentions: mentionSnapshot,
          tasks: taskSnapshot,
        });
      } else {
        const send = sendText.mutateAsync({
          body,
          clientKey,
          mentions: mentionSnapshot,
          tasks: taskSnapshot,
        });
        // Text sends render optimistically, so the composer should feel ready
        // for the next thought immediately instead of waiting for HTTP + WS.
        if (
          draftSignature(
            textRef.current,
            taskReferencesRef.current,
            attachmentsRef.current,
            mentionsRef.current
          ) === signature &&
          clientKeyRef.current === clientKey
        ) {
          textRef.current = "";
          setText("");
          mentionsRef.current = [];
          setMentions([]);
          setMentionSearch(null);
          taskReferencesRef.current = [];
          setTaskSearch(null);
          clientKeyRef.current = null;
          clearedOptimistically = true;
        }
        await send;
      }
      // The textarea remains editable while the request is in flight.
      // Clear only the exact draft that completed; never erase text the
      // reader typed while waiting on the network.
      if (
        draftSignature(
          textRef.current,
          taskReferencesRef.current,
          attachmentsRef.current,
          mentionsRef.current
        ) === signature &&
        clientKeyRef.current === clientKey
      ) {
        textRef.current = "";
        setText("");
        taskReferencesRef.current = [];
        setTaskSearch(null);
        releaseComposerPreviews(attachmentSnapshot);
        attachmentsRef.current = [];
        setAttachments([]);
        mentionsRef.current = [];
        setMentions([]);
        setMentionSearch(null);
        clientKeyRef.current = null;
      }
      setSentFlash((n) => n + 1);
    } catch (err) {
      // The server's own words, verbatim — `ConversationApiError`
      // already lifts `message` out of the response body. The i18n
      // string is only for a failure with no message at all (a network
      // drop before any response).
      const message = err instanceof Error && err.message ? err.message : tm("sendFailed");
      if (
        clearedOptimistically &&
        draftVersionRef.current === draftVersion &&
        textRef.current === "" &&
        taskReferencesRef.current.length === 0 &&
        attachmentsRef.current.length === 0
      ) {
        textRef.current = draft;
        setText(draft);
        mentionsRef.current = mentionSnapshot;
        setMentions(mentionSnapshot);
        taskReferencesRef.current = taskSnapshot;
        clientKeyRef.current = clientKey;
        setFailure(message);
      } else if (
        draftSignature(
          textRef.current,
          taskReferencesRef.current,
          attachmentsRef.current,
          mentionsRef.current
        ) === signature &&
        clientKeyRef.current === clientKey
      ) {
        setFailure(message);
      } else {
        // The failed request belongs to an older draft. Showing its
        // Retry control beside newly typed text would resend the wrong
        // content, so keep the current draft and report the old failure
        // non-destructively.
        toast.error(message);
      }
    }
  };

  const canSubmit =
    !isSending && !isUploading && (text.trim().length > 0 || attachments.length > 0);

  const startMention = () => {
    const field = textareaRef.current;
    const caret = field?.selectionStart ?? textRef.current.length;
    const needsSpace = caret > 0 && !/\s/.test(textRef.current[caret - 1] ?? "");
    const inserted = `${needsSpace ? " " : ""}@`;
    const next = `${textRef.current.slice(0, caret)}${inserted}${textRef.current.slice(caret)}`;
    const nextCaret = caret + inserted.length;
    editDraft(next, nextCaret);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const addExistingAsset = (node: CrewAssetNodeDTO) => {
    const key = `asset:${node.id}`;
    if (attachmentsRef.current.some((attachment) => attachment.key === key)) {
      setAssetPickerOpen(false);
      return;
    }
    if (attachmentsRef.current.length >= 10) {
      toast.error(tm("attachmentLimit", { count: 10 }));
      return;
    }
    replaceAttachments([
      ...attachmentsRef.current,
      {
        source: "asset",
        key,
        name: node.name,
        node,
        mediaKind: node.media?.kind ?? "other",
        contentType: node.media?.contentType ?? "application/octet-stream",
        sizeBytes: node.media?.sizeBytes ?? null,
        previewUrl: node.media?.previewUrl ?? null,
      },
    ]);
    setAssetPickerOpen(false);
  };

  const removeAttachment = (item: ComposerAttachment) => {
    if (item.source === "upload") discardUploads([item]);
    replaceAttachments(attachmentsRef.current.filter((candidate) => candidate.key !== item.key));
  };

  return (
    <footer
      className="relative shrink-0 bg-[#0c0e11] px-3 pb-3 pt-1.5"
      onDragEnter={(event) => {
        if (!isCrew || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setIsDraggingFiles(true);
      }}
      onDragOver={(event) => {
        if (!isCrew || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!isCrew) return;
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setIsDraggingFiles(false);
      }}
      onDrop={(event) => {
        if (!isCrew) return;
        event.preventDefault();
        dragDepthRef.current = 0;
        setIsDraggingFiles(false);
        void addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {isCrew ? (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => void addFiles(Array.from(event.target.files ?? []))}
        />
      ) : null}

      {taskSearch && isCrew ? (
        <div
          role="listbox"
          aria-label={tm("taskReferencePicker")}
          className="absolute inset-x-5 bottom-[calc(100%-8px)] z-20 max-h-64 overflow-y-auto rounded-lg border border-white/[0.08] bg-[#15181d] p-1.5 shadow-2xl"
        >
          <p className="px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.14em] text-[#666c76]">
            {tm("taskReferencePicker")}
          </p>
          {tasks.isLoading ? (
            <div className="grid h-16 place-items-center">
              <IconLoader2 className="size-4 animate-spin text-[#777d87]" />
            </div>
          ) : tasks.error ? (
            <button
              type="button"
              onClick={() => void tasks.refetch()}
              className="w-full rounded-md px-2 py-2 text-left text-[10px] text-destructive hover:bg-white/[0.045]"
            >
              {tasks.error.message}
            </button>
          ) : taskCandidates.length === 0 ? (
            <p className="px-2 py-3 text-[10px] text-[#777d87]">{tm("taskReferenceEmpty")}</p>
          ) : (
            taskCandidates.map((task, index) => (
              <button
                key={task.id}
                type="button"
                role="option"
                aria-selected={index === taskIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertTask(task)}
                className={cn(
                  "flex w-full min-w-0 items-baseline gap-2 rounded-md px-2 py-1.5 text-left",
                  index === taskIndex
                    ? "bg-white/[0.075] text-white"
                    : "text-[#a8adb5] hover:bg-white/[0.045]"
                )}
              >
                <span className="shrink-0 text-[9px] tabular-nums text-[#707782]">
                  TASK-{task.number}
                </span>
                <span className="truncate text-[10px] font-medium">{task.title}</span>
              </button>
            ))
          )}
        </div>
      ) : null}

      {mentionSearch && isCrew && mentionCandidates.length > 0 ? (
        <div
          role="listbox"
          aria-label={tm("mentionMembers")}
          className="absolute inset-x-5 bottom-[calc(100%-8px)] z-20 max-h-64 overflow-y-auto rounded-lg border border-white/[0.08] bg-[#15181d] p-1.5 shadow-2xl"
        >
          <p className="px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.14em] text-[#666c76]">
            {tm("crewMembersLabel")}
          </p>
          {mentionCandidates.map((candidate, index) => (
            <button
              key={candidate.userId}
              type="button"
              role="option"
              aria-selected={index === mentionIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertMention(candidate)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left",
                index === mentionIndex
                  ? "bg-white/[0.075] text-white"
                  : "text-[#a8adb5] hover:bg-white/[0.045]"
              )}
            >
              <UserAvatar
                src={candidate.avatar}
                name={candidate.label}
                seed={candidate.userId}
                className="size-7"
              />
              <span className="min-w-0 flex-1 truncate text-[10px] font-medium">
                {candidate.label}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {failure ? (
        <div
          role="alert"
          className="mb-1.5 flex items-start gap-2 rounded-lg bg-destructive/10 px-2.5 py-2 text-[10px] text-destructive"
        >
          <IconAlertTriangle className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words">
            <span className="font-semibold">{tm("sendFailedLabel")}</span> — {failure}
          </span>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="shrink-0 font-semibold underline underline-offset-2 disabled:opacity-50"
          >
            {tc("retry")}
          </button>
          <button
            type="button"
            onClick={() => setFailure(null)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {tm("dismissSendError")}
          </button>
        </div>
      ) : null}

      <div
        className={cn(
          "relative overflow-hidden rounded-xl border bg-[#121418] transition-colors",
          isDraggingFiles ? "border-primary bg-primary/[0.04]" : "border-white/[0.075]"
        )}
      >
        {isDraggingFiles ? (
          <div className="absolute inset-0 z-10 grid place-items-center bg-[#111318]/95">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-[#e7e9ed]">
              <IconPaperclip className="size-4 text-primary" />
              {tm("dropFilesHere")}
            </div>
          </div>
        ) : null}

        {attachments.length > 0 || isUploading ? (
          <div className="border-b border-white/[0.055] px-2.5 py-2">
            {attachments.length > 0 ? (
              <div className="flex gap-1.5 overflow-x-auto">
                {attachments.map((item) => {
                  const isVisualAttachment =
                    item.mediaKind === "image" || item.mediaKind === "video";
                  return (
                    <span
                      key={item.key}
                      className={cn(
                        "shrink-0 overflow-hidden rounded-md bg-white/[0.045] text-[9px] text-[#d3d6db]",
                        isVisualAttachment
                          ? "group relative block size-14"
                          : "inline-flex max-w-60 items-center gap-2 p-1"
                      )}
                    >
                      <AttachmentVisual
                        name={item.name}
                        mediaKind={item.mediaKind}
                        src={item.previewUrl}
                        compact
                        className={cn(
                          "shrink-0 rounded",
                          isVisualAttachment ? "size-full" : "size-9"
                        )}
                      />
                      {!isVisualAttachment ? (
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{item.name}</span>
                          <span className="mt-0.5 block text-[8px] text-[#707783]">
                            {item.sizeBytes == null
                              ? tm("attachment")
                              : formatBytes(item.sizeBytes)}
                          </span>
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => removeAttachment(item)}
                        aria-label={tm("removeAttachment", { name: item.name })}
                        className={cn(
                          "shrink-0 transition-colors hover:text-white",
                          isVisualAttachment
                            ? "absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-black/70 text-white/75 opacity-80 shadow-sm hover:bg-black/90 group-hover:opacity-100"
                            : "text-[#747a84]"
                        )}
                      >
                        <IconX className="size-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : null}
            {Object.entries(uploadProgress).map(([key, upload]) => (
              <div key={key} className="mt-1.5 flex items-center gap-2 text-[9px] text-[#777d87]">
                <IconLoader2 className="size-3 animate-spin" />
                <span className="min-w-0 flex-1 truncate">{upload.name}</span>
                <div className="h-1 w-20 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${upload.progress}%` }}
                  />
                </div>
                <span className="w-7 text-right tabular-nums">{upload.progress}%</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-1.5 px-2 py-2">
          {isCrew ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!canUpload || isUploading || attachments.length >= 10}
              aria-label={tm("attachFiles")}
              className="mb-0.5 grid size-7 shrink-0 place-items-center rounded-md text-[#777d87] transition-colors hover:bg-white/[0.055] hover:text-white disabled:opacity-35"
            >
              <IconPlus className="size-4" />
            </button>
          ) : null}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) =>
              editDraft(
                event.target.value.slice(0, 4000),
                Math.min(event.currentTarget.selectionStart, 4000)
              )
            }
            onClick={(event) => {
              const value = event.currentTarget.value;
              const caret = event.currentTarget.selectionStart;
              const nextMentionSearch = isCrew ? findMentionSearch(value, caret) : null;
              const nextTaskSearch = isCrew ? findTaskSearch(value, caret) : null;
              setMentionSearch(nextTaskSearch ? null : nextMentionSearch);
              setTaskSearch(nextMentionSearch ? null : nextTaskSearch);
            }}
            onPaste={(event) => {
              if (!isCrew) return;
              const files = Array.from(event.clipboardData.files);
              if (files.length === 0) return;
              event.preventDefault();
              void addFiles(files);
            }}
            placeholder={isCrew ? tm("crewComposerPlaceholder") : tm("composerPlaceholder")}
            rows={1}
            className="min-h-[40px] max-h-32 flex-1 resize-none bg-transparent px-1.5 py-2 text-[12px] leading-6 text-[#e1e3e7] outline-none placeholder:text-[#626874]"
            onKeyDown={(event) => {
              if (taskSearch && !event.nativeEvent.isComposing) {
                if (
                  taskCandidates.length > 0 &&
                  (event.key === "ArrowDown" || event.key === "ArrowUp")
                ) {
                  event.preventDefault();
                  const direction = event.key === "ArrowDown" ? 1 : -1;
                  setTaskIndex(
                    (current) =>
                      (current + direction + taskCandidates.length) % taskCandidates.length
                  );
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setTaskSearch(null);
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  const candidate = taskCandidates[taskIndex] ?? taskCandidates[0];
                  if (candidate) insertTask(candidate);
                  return;
                }
              }
              if (mentionSearch && mentionCandidates.length > 0 && !event.nativeEvent.isComposing) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const direction = event.key === "ArrowDown" ? 1 : -1;
                  setMentionIndex(
                    (current) =>
                      (current + direction + mentionCandidates.length) % mentionCandidates.length
                  );
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setMentionSearch(null);
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  insertMention(mentionCandidates[mentionIndex] ?? mentionCandidates[0]);
                  return;
                }
              }
              // Enter sends; Shift+Enter newline. Never intercept Enter
              // while a CJK IME is confirming a composition.
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            maxLength={4000}
          />
          {isCrew && hasMentionableMembers ? (
            <button
              type="button"
              onClick={startMention}
              aria-label={tm("mentionMembers")}
              className="mb-0.5 grid size-7 shrink-0 place-items-center rounded-md text-[#777d87] transition-colors hover:bg-white/[0.055] hover:text-white"
            >
              <IconAt className="size-4" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="mb-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-primary text-white transition-colors hover:bg-primary/90 disabled:bg-white/[0.055] disabled:text-[#555b65]"
          >
            {isSending ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconSend className="size-4" />
            )}
            <span className="sr-only">{tm("send")}</span>
          </button>
        </div>

        {canSendProposal || isCrew ? (
          <div className="flex min-h-8 flex-wrap items-center gap-1 border-t border-white/[0.05] px-2 py-1">
            {canSendProposal ? (
              <ComposerAction
                icon={<IconSparkles className="size-3.5 text-primary" />}
                label={tm("openSendProposal")}
                onClick={() => setProposalOpen(true)}
              />
            ) : null}
            {isCrew ? (
              <>
                <ComposerAction
                  icon={
                    assetContext.isLoading ? (
                      <IconLoader2 className="size-3.5 animate-spin" />
                    ) : (
                      <IconPaperclip className="size-3.5" />
                    )
                  }
                  label={tm("uploadFromDevice")}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!canUpload || isUploading || attachments.length >= 10}
                  title={uploadAvailabilityMessage ?? undefined}
                />
                <ComposerAction
                  icon={<IconFolderOpen className="size-3.5" />}
                  label={tm("chooseFromAssets")}
                  onClick={() => setAssetPickerOpen(true)}
                  disabled={attachments.length >= 10}
                />
                {uploadAvailabilityMessage && !assetContext.isLoading ? (
                  <span
                    className="inline-flex max-w-56 items-center gap-1 truncate px-1 text-[8px] text-amber-400/75"
                    title={uploadAvailabilityMessage}
                  >
                    <IconAlertTriangle className="size-3 shrink-0" />
                    <span className="truncate">{uploadAvailabilityMessage}</span>
                  </span>
                ) : null}
              </>
            ) : null}
            <div className="ml-auto flex items-center gap-2 px-1 text-[8px] text-[#555b65]">
              {mentions.length > 0 ? (
                <span>{tm("mentionCount", { count: mentions.length })}</span>
              ) : null}
              <span>
                {isUploading
                  ? tm("uploadingFiles")
                  : isSending
                    ? tm("sending")
                    : sentFlash > 0
                      ? tm("sent")
                      : tm("sendShortcut")}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {/* One live region for both outcomes, so a screen reader hears
          the send resolve without the row jumping the layout. */}
      <p role="status" aria-live="polite" className="sr-only">
        {isUploading
          ? tm("uploadingFiles")
          : isSending
            ? tm("sending")
            : sentFlash > 0
              ? tm("sent")
              : ""}
      </p>
      {canSendProposal ? (
        <SendProposalDialog
          open={proposalOpen}
          onOpenChange={setProposalOpen}
          conversationId={conversationId}
        />
      ) : null}
      {isCrew ? (
        <AssetPickerDialog
          open={assetPickerOpen}
          onOpenChange={setAssetPickerOpen}
          items={assets.data?.items ?? []}
          isLoading={assets.isLoading}
          error={assets.error}
          onRetry={() => void assets.refetch()}
          onSelect={addExistingAsset}
        />
      ) : null}
    </footer>
  );
}

function ComposerAction({
  icon,
  label,
  onClick,
  disabled,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px] text-[#808691] transition-colors hover:bg-white/[0.055] hover:text-[#dfe2e7] disabled:opacity-35"
    >
      {icon}
      {label}
    </button>
  );
}

function AssetPickerDialog({
  open,
  onOpenChange,
  items,
  isLoading,
  error,
  onRetry,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CrewAssetNodeDTO[];
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  onSelect: (asset: CrewAssetNodeDTO) => void;
}) {
  const tm = useTranslations("messages");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{tm("assetPickerTitle")}</DialogTitle>
          <DialogDescription>{tm("assetPickerDescription")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex h-28 items-center justify-center">
              <IconLoader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="space-y-3 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
              <p>{error.message}</p>
              <button
                type="button"
                onClick={onRetry}
                className="font-semibold underline underline-offset-2"
              >
                {tm("retryAssetPicker")}
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-28 flex-col items-center justify-center gap-2 text-center">
              <IconFolderOpen className="size-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">{tm("assetPickerEmpty")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {items.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => onSelect(asset)}
                  className="min-w-0 overflow-hidden rounded-lg bg-white/[0.035] text-left transition-colors hover:bg-white/[0.065]"
                >
                  <AttachmentVisual
                    name={asset.name}
                    mediaKind={asset.media?.kind ?? "other"}
                    src={asset.media?.previewUrl}
                    className="aspect-[16/9] w-full"
                  />
                  <div className="p-2">
                    <p className="truncate text-[10px] font-medium text-[#e1e3e7]">{asset.name}</p>
                    <p className="mt-0.5 text-[8px] text-[#6e747e]">
                      {asset.media?.sizeBytes == null
                        ? tm("attachment")
                        : formatBytes(asset.media.sizeBytes)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

// ─── Pure helpers ──────────────────────────────────────────

type DisplayMap = ReturnType<typeof useUserDisplays>;

function RichMessageBody({
  body,
  mentions,
  tasks,
}: {
  body: string;
  mentions: ConversationMentionPayload[];
  tasks: ConversationTaskReferencePayload[];
}) {
  const locale = useLocale() as Locale;
  const taskByToken = new Map(tasks.map((task) => [`#${task.label}`, task]));
  const mentionTokens = new Set(mentions.map((mention) => `@${mention.label}`));
  const tokens = [...new Set([...mentionTokens, ...taskByToken.keys()])].sort(
    (a, b) => b.length - a.length
  );
  if (tokens.length === 0) return body;
  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "g");
  return body.split(pattern).map((part, index) => {
    const task = taskByToken.get(part);
    if (task) {
      return (
        <Link
          key={`${part}:${index}`}
          href={localizePath(
            `/crews/${task.crewId}/workspace?tab=tasks&task=${task.taskId}`,
            locale
          )}
          className="font-medium text-[#c9d4e8] underline decoration-white/20 underline-offset-2 transition-colors hover:text-white hover:decoration-white/55"
        >
          {part}
        </Link>
      );
    }
    return mentionTokens.has(part) ? (
      <span
        key={`${part}:${index}`}
        className="rounded bg-primary/[0.15] px-0.5 font-medium text-[#ff666a]"
      >
        {part}
      </span>
    ) : (
      <span key={`text:${index}`}>{part}</span>
    );
  });
}

function messageMentions(message: MessageDTO): ConversationMentionPayload[] {
  const payload = message.payload;
  if (payload?.kind === "text" || payload?.kind === "attachments") {
    return payload.mentions ?? [];
  }
  return [];
}

function messageTaskReferences(message: MessageDTO): ConversationTaskReferencePayload[] {
  const payload = message.payload;
  if (payload?.kind === "text" || payload?.kind === "attachments") {
    return payload.tasks ?? [];
  }
  return [];
}

function findMentionSearch(value: string, caret: number): { start: number; query: string } | null {
  const prefix = value.slice(0, caret);
  const match = prefix.match(/(?:^|\s)@([^@\s]*)$/u);
  if (!match) return null;
  const at = prefix.lastIndexOf("@");
  if (at < 0) return null;
  return { start: at, query: match[1] ?? "" };
}

function findTaskSearch(value: string, caret: number): { start: number; query: string } | null {
  const prefix = value.slice(0, caret);
  const match = prefix.match(/(?:^|\s)#([^#\s]*)$/u);
  if (!match) return null;
  const hash = prefix.lastIndexOf("#");
  if (hash < 0) return null;
  return { start: hash, query: match[1] ?? "" };
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function mediaKindFromFile(file: File): ConversationAttachmentPayload["mediaKind"] {
  const contentType = file.type.toLowerCase();
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  if (
    contentType.startsWith("text/") ||
    contentType === "application/pdf" ||
    contentType.includes("document") ||
    contentType.includes("spreadsheet") ||
    contentType.includes("presentation")
  ) {
    return "document";
  }
  return "other";
}

function createLocalAttachmentPreview(file: File, fallbackUrl: string): string | null {
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    return URL.createObjectURL(file);
  }
  return fallbackUrl || null;
}

function draftSignature(
  text: string,
  tasks: ConversationTaskReferencePayload[],
  attachments: ComposerAttachment[],
  mentions: ConversationMentionPayload[]
): string {
  return JSON.stringify([
    text,
    tasks.map((task) => [task.taskId, task.label]),
    attachments.map((attachment) => attachment.key),
    mentions.map((mention) => [mention.userId, mention.label]),
  ]);
}

/** Small tolerance absorbs sub-pixel layout and mobile browser rounding. */
function isTimelineAtBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 48;
}

/** One-per-composed-message idempotency token for `POST /messages`.
 *  `crypto.randomUUID` needs a secure context, which every real
 *  deployment is; the fallback keeps a plain-http dev origin working
 *  rather than throwing inside a send. Server caps the field at 64. */
function newClientKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/** Nickname if we have one, otherwise a localized "User {id}". Never a
 *  bare id — an id on screen is a leak, not a name. */
function displayName(
  userId: string,
  displays: DisplayMap,
  tm: ReturnType<typeof useTranslations>
): string {
  return displays.get(userId)?.nickname?.trim() || tm("unknownUser", { userId });
}

/** The member a crew system message is about, if it names one. */
function systemSubjectId(params: Record<string, string | number>): string | null {
  const raw = params.userId;
  if (raw === undefined || raw === null || raw === "") return null;
  return String(raw);
}

/**
 * Every user whose name or face the thread will need: participants (the
 * header's counterparty, plus every crew member who might post),
 * message authors, and the subject of a crew system message.
 */
function collectDisplayIds(
  participants: readonly ConversationDTO["participants"][number][],
  messages: readonly MessageDTO[]
): string[] {
  const ids = new Set<string>();
  for (const p of participants) ids.add(p.userId);
  for (const m of messages) {
    if (m.authorId) ids.add(m.authorId);
    const payload = m.payload;
    if (payload?.kind === "system") {
      const subject = systemSubjectId(payload.system.params);
      if (subject) ids.add(subject);
    }
  }
  return [...ids];
}

function formatPrice(amount: number, currency: string): string {
  const isZero = ZERO_DECIMAL_CURRENCIES.has(
    currency as Parameters<typeof ZERO_DECIMAL_CURRENCIES.has>[0]
  );
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: isZero ? 0 : 2,
  }).format(amount);
}
