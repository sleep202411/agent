"use client";

/**
 * Notification tab in the message center.
 *
 * Layout:
 *   - Header with filter tabs (All / Unread / Crew / System)
 *   - Day-grouped list (Today / Yesterday / Earlier — locale-aware)
 *   - Server-filtered pagination via the next-page cursor
 *   - "Mark all read" action in the header
 *
 * Empty state mirrors the dropdown's "all caught up" copy. Items
 * behave identically to the dropdown rows — click marks read and
 * navigates to the deeplink.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { IconAlertTriangle, IconBellOff } from "@tabler/icons-react";
import {
  NOTIFICATION_FILTERS,
  type NotificationFilter,
  type NotificationDTO,
} from "@repo/shared/notifications";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import {
  notificationHref,
  notificationContent,
  useMarkAllRead,
  useMarkRead,
  useNotificationFeed,
  useUnreadCount,
} from "@/src/lib/notifications";

export function NotificationsFeed() {
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const router = useRouter();
  const locale = useLocale() as Locale;
  const t = useTranslations("notifications");

  const feed = useNotificationFeed(30, filter);
  const { data: unreadCount = 0 } = useUnreadCount();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  const items = useMemo<NotificationDTO[]>(() => {
    const pages = feed.data?.pages ?? [];
    return pages.flatMap((p) => p.items);
  }, [feed.data]);

  const grouped = useMemo(
    () =>
      groupByDay(items, {
        today: t("today"),
        yesterday: t("yesterday"),
        earlier: t("earlier"),
      }),
    [items, t]
  );

  const handleClick = (n: NotificationDTO) => {
    if (!n.readAt) markRead.mutate(n.id);
    const href = notificationHref(n, locale);
    if (href?.startsWith("/")) router.push(href);
    else if (href) window.location.assign(href);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("title")}</h2>
          {unreadCount > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("unreadCount", { count: unreadCount })}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={unreadCount === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          {t("markAllRead")}
        </Button>
      </header>

      <nav
        className="mb-4 flex gap-2 overflow-x-auto border-b border-border"
        aria-label={t("filterLabel")}
      >
        {NOTIFICATION_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={cn(
              "shrink-0 px-3 py-2 text-sm font-medium transition-colors -mb-px border-b-2",
              filter === f
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t(`filters.${f}`)}
          </button>
        ))}
      </nav>

      {feed.isLoading ? (
        <FeedSkeleton />
      ) : feed.isError ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-2xl bg-destructive/10 px-6 py-12 text-center"
        >
          <IconAlertTriangle className="size-7 text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">{t("loadErrorTitle")}</p>
            <p className="text-xs text-muted-foreground">
              {feed.error instanceof Error ? feed.error.message : t("loadErrorFallback")}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void feed.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <Empty label={t("empty")} />
      ) : (
        <div className="space-y-8">
          {grouped.map(([label, rows]) => (
            <section key={label}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {label}
              </h2>
              <ul className="overflow-hidden rounded-2xl bg-card/40">
                {rows.map((n, i) => (
                  <li key={n.id} className={cn(i > 0 && "border-t border-border")}>
                    <FeedRow item={n} locale={locale} onClick={() => handleClick(n)} />
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {feed.hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={feed.isFetchingNextPage}
                onClick={() => feed.fetchNextPage()}
              >
                {feed.isFetchingNextPage ? t("loading") : t("loadMore")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FeedRow({
  item,
  locale,
  onClick,
}: {
  item: NotificationDTO;
  locale: Locale;
  onClick: () => void;
}) {
  const unread = !item.readAt;
  const t = useTranslations("notifications");
  const content = notificationContent(item, locale, t);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full gap-3 px-5 py-4 text-left transition-colors hover:bg-secondary/40",
        unread && "bg-primary/[0.04]"
      )}
    >
      <span
        className={cn(
          "mt-1.5 size-2 shrink-0 rounded-full",
          unread ? "bg-primary" : "bg-transparent"
        )}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1 break-words">
        <span
          className={cn("text-sm", unread ? "font-semibold text-foreground" : "text-foreground/90")}
        >
          {content.title}
        </span>
        <span className="text-sm text-muted-foreground">{content.body}</span>
        <span className="text-xs text-muted-foreground/80">
          {formatTime(item.createdAt, locale)}
        </span>
      </div>
    </button>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-card/40 py-16 text-center text-sm text-muted-foreground">
      <IconBellOff className="size-8 opacity-60" />
      <span>{label}</span>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-3 rounded-2xl border border-border bg-card/40 px-5 py-4">
          <div className="mt-1.5 size-2 shrink-0 rounded-full bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Bucket rows into Today / Yesterday / Earlier groups (preserves order). */
function groupByDay(
  items: NotificationDTO[],
  labels: { today: string; yesterday: string; earlier: string }
): [string, NotificationDTO[]][] {
  const today: NotificationDTO[] = [];
  const yesterday: NotificationDTO[] = [];
  const earlier: NotificationDTO[] = [];

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;

  for (const n of items) {
    const ts = new Date(n.createdAt).getTime();
    if (ts >= startOfToday) today.push(n);
    else if (ts >= startOfYesterday) yesterday.push(n);
    else earlier.push(n);
  }

  const out: [string, NotificationDTO[]][] = [];
  if (today.length) out.push([labels.today, today]);
  if (yesterday.length) out.push([labels.yesterday, yesterday]);
  if (earlier.length) out.push([labels.earlier, earlier]);
  return out;
}

function formatTime(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
