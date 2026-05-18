"use client";

/**
 * Full notification inbox — the "see all" destination from the bell.
 *
 * Layout:
 *   - Header with filter tabs (All / Unread / Crew / System)
 *   - Day-grouped list (Today / Yesterday / Earlier — locale-aware)
 *   - Infinite scroll via the next-page cursor
 *   - "Mark all read" action in the header
 *
 * Empty state mirrors the dropdown's "all caught up" copy. Items
 * behave identically to the dropdown rows — click marks read and
 * navigates to the deeplink.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { IconBellOff } from "@tabler/icons-react";
import {
  notificationCategory,
  type NotificationCategory,
  type NotificationDTO,
} from "@repo/shared/notifications";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useMarkAllRead,
  useMarkRead,
  useNotificationFeed,
  useUnreadCount,
} from "@/src/lib/notifications";

type Filter = "all" | "unread" | NotificationCategory;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "crew", label: "Crew" },
  { id: "system", label: "System" },
];

export default function NotificationsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const router = useRouter();

  const feed = useNotificationFeed(30);
  const { data: unreadCount = 0 } = useUnreadCount();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  const items = useMemo<NotificationDTO[]>(() => {
    const pages = feed.data?.pages ?? [];
    return pages.flatMap((p) => p.items);
  }, [feed.data]);

  const filtered = useMemo(() => items.filter((n) => matchesFilter(n, filter)), [items, filter]);
  const grouped = useMemo(() => groupByDay(filtered), [filtered]);

  const handleClick = (n: NotificationDTO) => {
    if (!n.readAt) markRead.mutate(n.id);
    const deeplink = typeof n.meta?.deeplink === "string" ? (n.meta.deeplink as string) : null;
    if (deeplink) router.push(deeplink);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-24 pt-10">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
          {unreadCount > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">{unreadCount} unread</p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={unreadCount === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          Mark all read
        </Button>
      </header>

      <nav className="mb-4 flex gap-2 border-b border-border" aria-label="Filter">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              "px-3 py-2 text-sm font-medium transition-colors -mb-px border-b-2",
              filter === f.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {f.label}
          </button>
        ))}
      </nav>

      {feed.isLoading ? (
        <FeedSkeleton />
      ) : filtered.length === 0 ? (
        <Empty />
      ) : (
        <div className="space-y-8">
          {grouped.map(([label, rows]) => (
            <section key={label}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {label}
              </h2>
              <ul className="overflow-hidden rounded-2xl border border-border bg-card/40">
                {rows.map((n, i) => (
                  <li key={n.id} className={cn(i > 0 && "border-t border-border")}>
                    <FeedRow item={n} onClick={() => handleClick(n)} />
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
                {feed.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FeedRow({ item, onClick }: { item: NotificationDTO; onClick: () => void }) {
  const unread = !item.readAt;
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
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={cn("text-sm", unread ? "font-semibold text-foreground" : "text-foreground/90")}
        >
          {item.title}
        </span>
        <span className="text-sm text-muted-foreground">{item.body}</span>
        <span className="text-xs text-muted-foreground/80">{formatTime(item.createdAt)}</span>
      </div>
    </button>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
      <IconBellOff className="size-8 opacity-60" />
      <span>You're all caught up</span>
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

function matchesFilter(n: NotificationDTO, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "unread") return !n.readAt;
  return notificationCategory(n.type) === filter;
}

/** Bucket rows into Today / Yesterday / Earlier groups (preserves order). */
function groupByDay(items: NotificationDTO[]): [string, NotificationDTO[]][] {
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
  if (today.length) out.push(["Today", today]);
  if (yesterday.length) out.push(["Yesterday", yesterday]);
  if (earlier.length) out.push(["Earlier", earlier]);
  return out;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
