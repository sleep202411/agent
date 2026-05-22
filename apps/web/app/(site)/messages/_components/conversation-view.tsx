"use client";

/**
 * ConversationView — right pane of /messages. Renders the message
 * timeline + composer for the selected conversation. Responds to
 * incoming WS pushes (cache patched by ConversationsProvider) by
 * re-rendering from the React Query cache.
 *
 * Per-message rendering branches on type:
 *   - text:     standard bubble (left=other, right=me)
 *   - proposal: ProposalCard with Accept/Decline buttons for buyer
 *               when status === 'open'
 *   - system:   centered chip with i18n template render
 *
 * Auto mark-as-read fires when the timeline is scrolled to bottom
 * — implemented as: whenever the most-recent message becomes
 * visible (here approximated by render + non-empty timeline), we
 * call markRead with the newest message id.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconArrowLeft,
  IconBriefcase,
  IconLoader2,
  IconShoppingBag,
  IconSparkles,
} from "@tabler/icons-react";
import { toast } from "sonner";
import type {
  ConversationDTO,
  MessageDTO,
  MessagePayload,
  ProposalPayload,
} from "@repo/shared/conversation";
import { ZERO_DECIMAL_CURRENCIES } from "@repo/shared/crew";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
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
  useConversation,
  useDeclineProposal,
  useMarkRead,
  useMessages,
  useSendText,
} from "@/app/(site)/creators/_hooks/use-conversations";
import { useAcceptProposal } from "@/app/(site)/creators/_hooks/use-orders";
import { SendProposalDialog } from "./send-proposal-dialog";

interface ConversationViewProps {
  conversationId: string;
}

export function ConversationView({ conversationId }: ConversationViewProps) {
  const tm = useTranslations("messages");
  const locale = useLocale() as Locale;
  const { user } = useCurrentUser();
  const router = useRouter();

  const { data: conversation, isLoading: convLoading } = useConversation(conversationId);
  const messages = useMessages(conversationId);
  const items = useMemo(() => messages.data?.items ?? [], [messages.data]);

  // Mark-as-read fires when the bottom of the list is rendered + a
  // newer message has arrived than the cursor. Cheap to call; the
  // server short-circuits if no-op.
  const markRead = useMarkRead(conversationId);
  const lastSeenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user || items.length === 0) return;
    const latest = items[items.length - 1];
    if (latest.id === lastSeenRef.current) return;
    lastSeenRef.current = latest.id;
    // Always advance to the newest visible message — even when it's
    // my own. The server's markRead is monotonic; pushing the
    // cursor past my own reply also clears any earlier unread tail
    // from the other side that I just scrolled past. Skipping the
    // call when the latest message is mine was the bug: replying to
    // an unread message left the badge stuck.
    markRead.mutate({ lastReadMessageId: latest.id });
  }, [items, user, markRead]);

  // Scroll to bottom on first load + on new messages.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [items.length]);

  if (convLoading || !conversation) {
    return (
      <div className="flex h-full items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const me = user ? conversation.participants.find((p) => p.userId === user.id) : undefined;
  const myRole = me?.role ?? null;

  return (
    <section className="flex h-full flex-col">
      <ConversationHeader conversation={conversation} viewerId={user?.id ?? null} />

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.hasNextPage ? (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={() => messages.fetchNextPage()}
              disabled={messages.isFetchingNextPage}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              {messages.isFetchingNextPage ? (
                <IconLoader2 className="inline size-3 animate-spin" />
              ) : null}
              {tm("loadEarlier")}
            </button>
          </div>
        ) : null}

        {items.length === 0 ? (
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
              prev={items[i - 1]}
              onOrderCreated={(orderId) => router.push(localizePath(`/orders/${orderId}`, locale))}
            />
          ))
        )}
      </div>

      <Composer
        conversationId={conversationId}
        canSendProposal={myRole === "creator" && conversation.contextType === "service"}
      />
    </section>
  );
}

// ─── Header ─────────────────────────────────────────────────

function ConversationHeader({
  conversation,
  viewerId,
}: {
  conversation: ConversationDTO;
  viewerId: string | null;
}) {
  const tm = useTranslations("messages");
  const locale = useLocale() as Locale;
  const counterparty = viewerId
    ? conversation.participants.find((p) => p.userId !== viewerId)
    : conversation.participants[0];
  const ids = counterparty ? [counterparty.userId] : [];
  const displays = useUserDisplays(ids);
  const name = counterparty
    ? (displays.get(counterparty.userId)?.nickname ?? `User ${counterparty.userId}`)
    : "—";

  const Icon = conversation.contextType === "order" ? IconShoppingBag : IconBriefcase;
  const contextHref =
    conversation.contextType === "order"
      ? localizePath(`/orders/${conversation.contextId}`, locale)
      : null;

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
      <Link
        href={localizePath("/messages", locale)}
        className="rounded-md p-1 text-muted-foreground hover:bg-secondary lg:hidden"
        aria-label={tm("backToInbox")}
      >
        <IconArrowLeft className="size-4" />
      </Link>
      <UserAvatar
        src={counterparty ? displays.get(counterparty.userId)?.avatar : undefined}
        name={name}
        seed={counterparty?.userId ?? "x"}
        className="size-9"
      />
      <div className="min-w-0 flex-1">
        <div className="line-clamp-1 text-sm font-medium text-foreground">{name}</div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Icon className="size-3" />
          {tm(`contextType.${conversation.contextType}`)}
          {contextHref ? (
            <>
              <span>·</span>
              <Link href={contextHref} className="text-primary hover:underline">
                {tm("openOrder")}
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
  prev,
  onOrderCreated,
}: {
  message: MessageDTO;
  viewerId: string | null;
  participants: ConversationDTO["participants"];
  myRole: "buyer" | "creator" | null;
  conversationId: string;
  contextType: ConversationDTO["contextType"];
  prev?: MessageDTO;
  onOrderCreated: (orderId: string) => void;
}) {
  if (message.type === "system") {
    return <SystemRow message={message} />;
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
  const showAvatar = !isMine && prev?.authorId !== message.authorId;

  return (
    <TextRow
      message={message}
      isMine={isMine}
      showAvatar={showAvatar}
      authorId={author?.userId ?? null}
    />
  );
}

function TextRow({
  message,
  isMine,
  showAvatar,
  authorId,
}: {
  message: MessageDTO;
  isMine: boolean;
  showAvatar: boolean;
  authorId: string | null;
}) {
  const ids = authorId ? [authorId] : [];
  const displays = useUserDisplays(ids);
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
      <div
        className={cn(
          "max-w-[min(70%,32rem)] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm",
          isMine ? "bg-primary text-primary-foreground" : "bg-card text-foreground"
        )}
      >
        {message.body}
      </div>
    </div>
  );
}

function SystemRow({ message }: { message: MessageDTO }) {
  const tm = useTranslations("messages");
  const payload = (message.payload ?? null) as MessagePayload | null;
  if (!payload || payload.kind !== "system") return null;
  const kind = payload.system.kind;
  const key = `system.${kind}` as const;
  // Server params surface as i18n interpolation variables. Cast to
  // string|number to satisfy the t() signature.
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(payload.system.params)) {
    params[k] = v as string | number;
  }
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
  myRole: "buyer" | "creator" | null;
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
  myRole: "buyer" | "creator" | null;
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

function Composer({
  conversationId,
  canSendProposal,
}: {
  conversationId: string;
  canSendProposal: boolean;
}) {
  const tm = useTranslations("messages");
  const send = useSendText(conversationId);
  const [text, setText] = useState("");
  const [proposalOpen, setProposalOpen] = useState(false);

  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    try {
      await send.mutateAsync({ body });
      setText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tm("sendFailed"));
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
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 4000))}
          placeholder={tm("composerPlaceholder")}
          rows={1}
          className="min-h-[40px] max-h-32 flex-1 resize-none rounded-lg bg-card px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-primary"
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter newline (common chat convention).
            if (e.key === "Enter" && !e.shiftKey) {
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
