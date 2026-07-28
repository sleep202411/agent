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
  IconBriefcase,
  IconLoader2,
  IconShoppingBag,
  IconSparkles,
  IconUsersGroup,
} from "@tabler/icons-react";
import { toast } from "sonner";
import type {
  ConversationDTO,
  ConversationParticipantRole,
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
import { cn } from "@/lib/utils";
import {
  isConversationAccessError,
  useConversation,
  useClearConversationAccessCache,
  useDeclineProposal,
  useMarkRead,
  useMessages,
  useSendText,
} from "@/app/(site)/creators/_hooks/use-conversations";
import { useAcceptProposal } from "@/app/(site)/creators/_hooks/use-orders";
import { SendProposalDialog } from "./send-proposal-dialog";

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
    <section className="flex h-full flex-col">
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
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {messages.isError ? (
          <div
            role="alert"
            className="mx-auto flex max-w-md items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
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
          <nav aria-label={tm("loadEarlier")} className="flex justify-center pb-2">
            <button
              type="button"
              onClick={loadEarlier}
              disabled={messages.isFetchingNextPage}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              {messages.isFetchingNextPage ? (
                <IconLoader2 className="inline size-3 animate-spin" />
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
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            {tm("noMessagesYet")}
          </div>
        ) : (
          items.map((m, i) => (
            <MessageRow
              key={m.id}
              message={m}
              viewerId={user?.id ?? null}
              participants={conversation.participants}
              myRole={myRole}
              conversationId={conversationId}
              contextType={conversation.contextType}
              displays={displays}
              prev={items[i - 1]}
              onOrderCreated={(orderId) => router.push(localizePath(`/orders/${orderId}`, locale))}
            />
          ))
        )}
      </div>

      <Composer
        key={conversationId}
        conversationId={conversationId}
        canSendProposal={myRole === "creator" && conversation.contextType === "service"}
      />
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
          ? localizePath(`/crews/${conversation.contextId}/workspace`, locale)
          : null;

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
            ? tm("crewMemberCount", { count: conversation.participants.length })
            : tm(`contextType.${conversation.contextType}`)}
          {contextHref ? (
            <>
              <span>·</span>
              <Link href={contextHref} className="text-primary hover:underline">
                {isCrew ? tm("openCrewWorkspace") : tm("openOrder")}
              </Link>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

// ─── Per-message row ────────────────────────────────────────

function MessageRow({
  message,
  viewerId,
  participants,
  myRole,
  conversationId,
  contextType,
  displays,
  prev,
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
  onOrderCreated: (orderId: string) => void;
}) {
  if (message.type === "system") {
    return <SystemRow message={message} displays={displays} />;
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
  // text (image/file deferred to v1.1 per Phase 1b decision)
  const isMine = !!viewerId && message.authorId === viewerId;
  const author = participants.find((p) => p.userId === message.authorId);
  const startsStreak = prev?.authorId !== message.authorId;

  return (
    <TextRow
      message={message}
      isMine={isMine}
      showAvatar={!isMine && startsStreak}
      // A two-party thread has exactly one "them", so the avatar says
      // everything. A crew chat does not — without a name the reader
      // has to match faces to guess who wrote what.
      showAuthorName={!isMine && startsStreak && contextType === "crew"}
      authorId={author?.userId ?? null}
      displays={displays}
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
}: {
  message: MessageDTO;
  isMine: boolean;
  showAvatar: boolean;
  showAuthorName: boolean;
  authorId: string | null;
  displays: DisplayMap;
}) {
  const tm = useTranslations("messages");
  const display = authorId ? displays.get(authorId) : undefined;

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
          {message.body}
        </div>
      </div>
    </div>
  );
}

function SystemRow({ message, displays }: { message: MessageDTO; displays: DisplayMap }) {
  const tm = useTranslations("messages");
  const payload = (message.payload ?? null) as MessagePayload | null;
  const system = payload?.kind === "system" ? payload.system : null;
  if (!system) return null;
  const kind = system.kind;
  const key = `system.${kind}` as const;
  // Server params surface as i18n interpolation variables. Cast to
  // string|number to satisfy the t() signature.
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(system.params)) {
    params[k] = v as string | number;
  }
  // Crew system messages name the member they are about, and the wire
  // carries an id (`userId`) because ids are what the server owns.
  // `{user}` is the display half of that, resolved from the thread's
  // one batched lookup — so the chip reads "Ada submitted…" instead of
  // leaking a raw id at the reader.
  const subjectId = systemSubjectId(system.params);
  if (subjectId) params.user = displayName(subjectId, displays, tm);
  return (
    <div className="flex justify-center py-1">
      <span className="rounded-full bg-secondary px-3 py-1 text-[11px] text-muted-foreground">
        {tm(key, { ...params, defaultValue: tm("system.fallback", { kind }) })}
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
function Composer({
  conversationId,
  canSendProposal,
}: {
  conversationId: string;
  canSendProposal: boolean;
}) {
  const tm = useTranslations("messages");
  const tc = useTranslations("common");
  const send = useSendText(conversationId);
  const [text, setText] = useState("");
  const textRef = useRef("");
  const [proposalOpen, setProposalOpen] = useState(false);
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

  useEffect(() => {
    if (sentFlash === 0) return;
    const timer = setTimeout(() => setSentFlash(0), SENT_FLASH_MS);
    return () => clearTimeout(timer);
  }, [sentFlash]);

  const editDraft = (value: string) => {
    textRef.current = value;
    setText(value);
    setFailure(null);
    clientKeyRef.current = null;
  };

  const submit = async () => {
    const draft = textRef.current;
    const body = draft.trim();
    if (!body || send.isPending) return;
    setFailure(null);
    clientKeyRef.current ??= newClientKey();
    const clientKey = clientKeyRef.current;
    try {
      await send.mutateAsync({ body, clientKey });
      // The textarea remains editable while the request is in flight.
      // Clear only the exact draft that completed; never erase text the
      // reader typed while waiting on the network.
      if (textRef.current === draft && clientKeyRef.current === clientKey) {
        textRef.current = "";
        setText("");
        clientKeyRef.current = null;
      }
      setSentFlash((n) => n + 1);
    } catch (err) {
      // The server's own words, verbatim — `ConversationApiError`
      // already lifts `message` out of the response body. The i18n
      // string is only for a failure with no message at all (a network
      // drop before any response).
      const message = err instanceof Error && err.message ? err.message : tm("sendFailed");
      if (textRef.current === draft && clientKeyRef.current === clientKey) {
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

  return (
    <footer className="shrink-0 space-y-1.5 border-t border-border bg-background/95 px-3 py-2.5">
      {canSendProposal ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            color="muted"
            size="sm"
            onClick={() => setProposalOpen(true)}
            className="gap-1 text-xs"
          >
            <IconSparkles className="size-3.5 text-primary" />
            {tm("openSendProposal")}
          </Button>
        </div>
      ) : null}
      {failure ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive"
        >
          <IconAlertTriangle className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words">
            <span className="font-semibold">{tm("sendFailedLabel")}</span> — {failure}
          </span>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={send.isPending || text.trim().length === 0}
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
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => editDraft(e.target.value.slice(0, 4000))}
          placeholder={tm("composerPlaceholder")}
          rows={1}
          className="min-h-[40px] max-h-32 flex-1 resize-none rounded-lg bg-card px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-primary"
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter newline (common chat convention).
            // Never intercept Enter while a CJK IME is confirming a
            // composition — that would send half-composed text.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          maxLength={4000}
        />
        <Button
          type="button"
          onClick={submit}
          disabled={send.isPending || text.trim().length === 0}
        >
          {send.isPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
          {tm("send")}
        </Button>
      </div>
      {/* One live region for both outcomes, so a screen reader hears
          the send resolve without the row jumping the layout. */}
      <p role="status" aria-live="polite" className="h-3 px-1 text-[10px] text-muted-foreground">
        {send.isPending ? tm("sending") : sentFlash > 0 ? tm("sent") : ""}
      </p>
      {canSendProposal ? (
        <SendProposalDialog
          open={proposalOpen}
          onOpenChange={setProposalOpen}
          conversationId={conversationId}
        />
      ) : null}
    </footer>
  );
}

// ─── Pure helpers ──────────────────────────────────────────

type DisplayMap = ReturnType<typeof useUserDisplays>;

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
