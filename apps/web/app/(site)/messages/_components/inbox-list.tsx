"use client";

/**
 * InboxList — left pane of the messages route. Renders the user's
 * conversation cards ordered by lastMessageAt desc. Tabs filter by
 * context type (all / crews / inquiries / orders).
 *
 * Crew group chats live in this same inbox on purpose: the nav bell
 * sums inbox unread counts, so leaving crews out would show a reader
 * with twelve unread crew messages a zero badge.
 *
 * Highlights the currently-active conversation by matching the id
 * against the route's selected segment. The active row is passed in
 * because URL params can't be read reliably inside server-component
 * boundaries from this client component.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  IconAlertTriangle,
  IconBriefcase,
  IconLoader2,
  IconMessageCircle,
  IconShoppingBag,
  IconUsersGroup,
} from "@tabler/icons-react";
import type { ConversationCardDTO, ConversationContextType } from "@repo/shared/conversation";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { cn } from "@/lib/utils";
import { useInbox } from "@/app/(site)/creators/_hooks/use-conversations";
import { useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { crewIdentityOf } from "@/app/(site)/messages/_lib/crew-identity";
import { CrewLogo } from "@/app/(site)/messages/_components/crew-logo";
import { UserAvatar } from "@/components/user-avatar";

type Filter = "all" | ConversationContextType;
const MAX_AUTOMATIC_EMPTY_PAGE_HOPS = 8;

interface InboxListProps {
  /** Currently routed conversation id (highlighted). */
  activeId: string | null;
}

export function InboxList({ activeId }: InboxListProps) {
  const t = useTranslations("messages");
  const tc = useTranslations("common");
  const orders = useTranslations("orders");
  const locale = useLocale() as Locale;
  const [filter, setFilter] = useState<Filter>("all");

  const inbox = useInbox(filter === "all" ? undefined : filter);
  const items = useMemo(() => inbox.data?.items ?? [], [inbox.data]);
  const automaticEmptyPageHops = useRef(0);
  const fetchNextInboxPage = inbox.fetchNextPage;
  const hasNextInboxPage = inbox.hasNextPage;
  const isFetchingNextInboxPage = inbox.isFetchingNextPage;
  const isInboxLoading = inbox.isLoading;
  const isInboxError = inbox.isError;

  // Permission/context filtering can make a cursor page empty even
  // though the server still has a next cursor. Walk through a bounded
  // number of those pages automatically so the inbox does not falsely
  // stop at "empty"; the visible Load more control remains available
  // after the safety cap.
  useEffect(() => {
    automaticEmptyPageHops.current = 0;
  }, [filter]);
  useEffect(() => {
    if (
      isInboxLoading ||
      isInboxError ||
      isFetchingNextInboxPage ||
      items.length > 0 ||
      !hasNextInboxPage ||
      automaticEmptyPageHops.current >= MAX_AUTOMATIC_EMPTY_PAGE_HOPS
    ) {
      return;
    }
    automaticEmptyPageHops.current += 1;
    void fetchNextInboxPage();
  }, [
    fetchNextInboxPage,
    filter,
    hasNextInboxPage,
    isFetchingNextInboxPage,
    isInboxError,
    isInboxLoading,
    items.length,
  ]);

  // Batch resolve counterparty display names + avatars. Crew rows are
  // excluded: their `counterpartyId` is the CREW id, and looking it up
  // as a user both misses and burns a slot in the batch.
  const counterpartyIds = useMemo(
    () => items.filter((c) => c.contextType !== "crew").map((c) => c.counterpartyId),
    [items]
  );
  const displays = useUserDisplays(counterpartyIds);

  return (
    <aside className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 space-y-2 px-3 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="px-1 font-heading text-base font-semibold text-foreground">
            {t("inboxTitle")}
          </h2>
          <Link
            href={localizePath("/orders", locale)}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            {orders("list.title")}
          </Link>
        </div>
        {/* Four filters in a 320px rail: let them scroll rather than
            wrap into a second row that shoves the list down. */}
        <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-secondary p-1 md:w-fit">
          {(["all", "crew", "service", "order"] as Filter[]).map((f) => {
            const active = filter === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t(`tabs.${f}`)}
              </button>
            );
          })}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 pb-4">
        {inbox.isError ? (
          <div
            role="alert"
            className="mx-1 mb-2 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            <IconAlertTriangle className="mt-px size-4 shrink-0" />
            <span className="min-w-0 flex-1 break-words">
              <span className="font-semibold">{t("inboxUnavailableTitle")}</span>
              {" — "}
              {inbox.error instanceof Error ? inbox.error.message : t("inboxUnavailableFallback")}
            </span>
            <button
              type="button"
              onClick={() => void inbox.refetch()}
              className="shrink-0 font-semibold underline underline-offset-2"
            >
              {tc("retry")}
            </button>
          </div>
        ) : null}
        {inbox.isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 && !inbox.isError ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 px-3 text-center">
            <IconMessageCircle className="size-7 text-muted-foreground/70" />
            <p className="text-xs text-muted-foreground">
              {inbox.hasNextPage ? t("inboxSearchingMore") : t("inboxEmpty")}
            </p>
            {inbox.hasNextPage ? (
              <LoadMoreButton
                loading={inbox.isFetchingNextPage}
                label={t("loadMore")}
                onLoadMore={() => void inbox.fetchNextPage()}
              />
            ) : null}
          </div>
        ) : (
          <ul className="space-y-1">
            {items.map((c) => {
              // A crew row is identified by the crew, not by a person —
              // see `_lib/crew-identity`. Everything else keeps the
              // two-party counterparty projection.
              const crew = crewIdentityOf(c);
              const display = crew ? undefined : displays.get(c.counterpartyId);
              const name = crew
                ? (crew.name ?? t("crewChatFallbackName"))
                : (display?.nickname ?? t("unknownUser", { userId: c.counterpartyId }));
              const isActive = c.id === activeId;
              return (
                <li key={c.id}>
                  <Link
                    href={localizePath(`/messages/${c.id}`, locale)}
                    className={cn(
                      "flex items-start gap-3 rounded-lg px-2.5 py-2.5 transition-colors",
                      isActive ? "bg-card" : "hover:bg-card/60"
                    )}
                  >
                    {crew ? (
                      <CrewLogo
                        logo={crew.logo}
                        name={name}
                        crewId={crew.crewId}
                        className="size-10 shrink-0"
                      />
                    ) : (
                      <UserAvatar
                        src={display?.avatar}
                        name={name}
                        seed={c.counterpartyId}
                        className="size-10 shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                          {name}
                        </span>
                        <ContextChip type={c.contextType} />
                      </div>
                      <p
                        className={cn(
                          "line-clamp-1 text-xs",
                          c.unreadCount > 0
                            ? "font-medium text-foreground"
                            : "text-muted-foreground"
                        )}
                      >
                        <PreviewText card={c} />
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-muted-foreground">
                          {formatTime(c.lastMessageAt)}
                          {crew && crew.memberCount !== null ? (
                            <> · {t("crewMemberCount", { count: crew.memberCount })}</>
                          ) : null}
                        </span>
                        {c.unreadCount > 0 ? (
                          <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                            {c.unreadCount > 99 ? "99+" : c.unreadCount}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
            {inbox.hasNextPage ? (
              <li>
                <LoadMoreButton
                  loading={inbox.isFetchingNextPage}
                  label={t("loadMore")}
                  onLoadMore={() => void inbox.fetchNextPage()}
                />
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </aside>
  );
}

function LoadMoreButton({
  loading,
  label,
  onLoadMore,
}: {
  loading: boolean;
  label: string;
  onLoadMore: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onLoadMore}
      disabled={loading}
      className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-card/60 disabled:opacity-50"
    >
      {loading ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
      {label}
    </button>
  );
}

const CONTEXT_ICONS: Record<ConversationContextType, typeof IconBriefcase> = {
  service: IconBriefcase,
  order: IconShoppingBag,
  crew: IconUsersGroup,
};

function ContextChip({ type }: { type: ConversationContextType }) {
  const t = useTranslations("messages");
  const Icon = CONTEXT_ICONS[type];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider",
        type === "order" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"
      )}
    >
      <Icon className="size-2.5" />
      {t(`contextType.${type}`)}
    </span>
  );
}

function PreviewText({ card }: { card: ConversationCardDTO }) {
  const t = useTranslations("messages");
  // System messages come back as "[system:order.submitted]" etc. —
  // render via i18n template so the inbox row stays localized.
  const raw = card.lastMessagePreview;
  if (raw.startsWith("[system:")) {
    const kind = raw.slice("[system:".length, -1);
    return <>{t(`preview.system.${kind}`, { defaultValue: t("preview.system.fallback") })}</>;
  }
  if (raw === "[proposal]") return <>{t("preview.proposal")}</>;
  if (raw === "[image]") return <>{t("preview.image")}</>;
  if (raw === "[file]") return <>{t("preview.file")}</>;
  if (raw === "[task]") return <>{t("preview.task")}</>;
  if (!raw) return <>{t("preview.empty")}</>;
  return <>{raw}</>;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
