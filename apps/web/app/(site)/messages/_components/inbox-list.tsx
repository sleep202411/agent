"use client";

/**
 * InboxList — left pane of the messages route. Renders the user's
 * conversation cards ordered by lastMessageAt desc. Tabs filter by
 * context type (all / inquiries / orders).
 *
 * Highlights the currently-active conversation by matching the id
 * against the route's selected segment. The active row is passed in
 * because URL params can't be read reliably inside server-component
 * boundaries from this client component.
 */
import { useState } from "react";
import Link from "next/link";
import {
  IconBriefcase,
  IconLoader2,
  IconMessageCircle,
  IconShoppingBag,
} from "@tabler/icons-react";
import type { ConversationCardDTO, ConversationContextType } from "@repo/shared/conversation";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { cn } from "@/lib/utils";
import { useInbox } from "@/app/(site)/creators/_hooks/use-conversations";
import { useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { UserAvatar } from "@/components/user-avatar";

type Filter = "all" | ConversationContextType;

interface InboxListProps {
  /** Currently routed conversation id (highlighted). */
  activeId: string | null;
}

export function InboxList({ activeId }: InboxListProps) {
  const t = useTranslations("messages");
  const locale = useLocale() as Locale;
  const [filter, setFilter] = useState<Filter>("all");

  const inbox = useInbox(filter === "all" ? undefined : filter);
  const items = inbox.data?.items ?? [];

  // Batch resolve counterparty display names + avatars.
  const counterpartyIds = items.map((c) => c.counterpartyId);
  const displays = useUserDisplays(counterpartyIds);

  return (
    <aside className="flex h-full flex-col">
      <header className="space-y-2 px-3 pb-3 pt-4">
        <h1 className="px-1 font-heading text-base font-semibold text-foreground">
          {t("inboxTitle")}
        </h1>
        <div className="inline-flex w-fit items-center gap-1 rounded-lg bg-secondary p-1">
          {(["all", "service", "order"] as Filter[]).map((f) => {
            const active = filter === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
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

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {inbox.isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 px-3 text-center">
            <IconMessageCircle className="size-7 text-muted-foreground/70" />
            <p className="text-xs text-muted-foreground">{t("inboxEmpty")}</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {items.map((c) => {
              const display = displays.get(c.counterpartyId);
              const name = display?.nickname ?? `User ${c.counterpartyId}`;
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
                    <UserAvatar
                      src={display?.avatar}
                      name={name}
                      seed={c.counterpartyId}
                      className="size-10 shrink-0"
                    />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-medium text-foreground">
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
                <button
                  type="button"
                  onClick={() => inbox.fetchNextPage()}
                  disabled={inbox.isFetchingNextPage}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs text-muted-foreground hover:bg-card/60 disabled:opacity-50"
                >
                  {inbox.isFetchingNextPage ? (
                    <IconLoader2 className="size-3.5 animate-spin" />
                  ) : null}
                  {t("loadMore")}
                </button>
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </aside>
  );
}

function ContextChip({ type }: { type: ConversationContextType }) {
  const t = useTranslations("messages");
  const Icon = type === "order" ? IconShoppingBag : IconBriefcase;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider",
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
