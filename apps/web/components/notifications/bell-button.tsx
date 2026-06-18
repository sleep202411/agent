"use client";

/**
 * BellButton — top-nav bell with unread badge and recent-items dropdown.
 *
 * Render only for logged-in users (the parent nav already gates on
 * useCurrentUser). The dropdown shows up to 10 most-recent items;
 * "See all" navigates to the full inbox at /notifications.
 *
 * Click on an item marks it read and (if a deeplink is present)
 * navigates. Unread items get a left-edge dot indicator.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { IconBell, IconBellOff } from "@tabler/icons-react";
import type { NotificationDTO } from "@repo/shared/notifications";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { localizePath } from "@/src/i18n/locale-url";
import { useLocale } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import {
  useMarkAllRead,
  useMarkRead,
  useRecentNotifications,
  useUnreadCount,
} from "@/src/lib/notifications";

const DROPDOWN_LIMIT = 10;

export function BellButton() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const locale = useLocale() as Locale;

  const { data: unreadCount = 0 } = useUnreadCount();
  const { data: list, isLoading } = useRecentNotifications(DROPDOWN_LIMIT);
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  const items = list?.items ?? [];
  const hasUnread = unreadCount > 0;

  const badge = useMemo(() => {
    if (unreadCount <= 0) return null;
    if (unreadCount > 99) return "99+";
    return String(unreadCount);
  }, [unreadCount]);

  const handleItemClick = (n: NotificationDTO) => {
    if (!n.readAt) markRead.mutate(n.id);
    const deeplink = typeof n.meta?.deeplink === "string" ? (n.meta.deeplink as string) : null;
    if (deeplink) {
      setOpen(false);
      router.push(deeplink);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={badge ? `Notifications (${badge} unread)` : "Notifications"}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
        >
          <IconBell className="size-5" />
          {badge != null && (
            <span
              data-notification-badge
              className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
            >
              {badge}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-[380px] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-foreground">Notifications</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!hasUnread || markAll.isPending}
            onClick={() => markAll.mutate()}
            className="h-7 px-2 text-xs"
          >
            Mark all read
          </Button>
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {isLoading ? (
            <ItemSkeleton count={3} />
          ) : items.length === 0 ? (
            <EmptyState />
          ) : (
            items.map((n) => (
              <NotificationRow key={n.id} item={n} onClick={() => handleItemClick(n)} />
            ))
          )}
        </div>

        <div className="border-t border-border px-4 py-2">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              router.push(localizePath("/notifications", locale));
            }}
            className="block w-full rounded-md py-1.5 text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            See all notifications
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationRow({ item, onClick }: { item: NotificationDTO; onClick: () => void }) {
  const unread = !item.readAt;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/50",
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
          className={cn(
            "truncate text-sm",
            unread ? "font-semibold text-foreground" : "text-foreground/90"
          )}
        >
          {item.title}
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground">{item.body}</span>
        <span className="text-[11px] text-muted-foreground/80">{formatAgo(item.createdAt)}</span>
      </div>
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
      <IconBellOff className="size-8 opacity-60" />
      <span>You&apos;re all caught up</span>
    </div>
  );
}

function ItemSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex gap-3 px-4 py-3">
          <div className="mt-1.5 size-2 shrink-0 rounded-full bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </>
  );
}

/** Compact relative time — "just now", "5m", "2h", "3d", or absolute date. */
function formatAgo(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return iso;
  const diffMs = Date.now() - ts;
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h`;
  if (diffMs < 7 * 86_400_000) return `${Math.floor(diffMs / 86_400_000)}d`;
  return new Date(iso).toLocaleDateString();
}
