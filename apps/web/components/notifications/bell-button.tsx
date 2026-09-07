"use client";

/**
 * BellButton — top-nav bell with unread badge and recent-items dropdown.
 *
 * Render only for logged-in users (the parent nav already gates on
 * useCurrentUser). The dropdown shows up to 10 most-recent items;
 * "See all" navigates to the full inbox in the message center.
 *
 * Click on an item marks it read and (if a deeplink is present)
 * navigates. Unread items get a left-edge dot indicator.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { IconAlertTriangle, IconBell, IconBellOff } from "@tabler/icons-react";
import type { NotificationDTO } from "@repo/shared/notifications";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { localizePath } from "@/src/i18n/locale-url";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import {
  notificationHref,
  notificationContent,
  useMarkAllRead,
  useMarkRead,
  useRecentNotifications,
  useUnreadCount,
} from "@/src/lib/notifications";

const DROPDOWN_LIMIT = 10;

export interface BellButtonProps {
  /**
   * `rail` adapts the global notification inbox to narrow product workbench
   * navigation. It intentionally keeps the same authoritative notification
   * queries and mutations as the site header instead of creating a crew-only
   * shadow inbox.
   */
  variant?: "header" | "rail";
}

export function BellButton({ variant = "header" }: BellButtonProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const locale = useLocale() as Locale;
  const t = useTranslations("notifications");
  const isRail = variant === "rail";

  const { data: unreadCount = 0 } = useUnreadCount();
  const recent = useRecentNotifications(DROPDOWN_LIMIT);
  const { data: list, isLoading } = recent;
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
    const href = notificationHref(n, locale);
    if (href) {
      setOpen(false);
      if (href.startsWith("/")) router.push(href);
      else window.location.assign(href);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={badge ? t("ariaUnread", { count: badge }) : t("title")}
          className={cn(
            "relative inline-flex items-center justify-center text-muted-foreground outline-none transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/70",
            isRail ? "size-10 shrink-0 rounded-lg" : "h-9 w-9 rounded-lg"
          )}
        >
          <IconBell className={isRail ? "size-[18px]" : "size-5"} stroke={1.75} />
          {badge != null && (
            <span
              data-notification-badge
              className={cn(
                "absolute inline-flex items-center justify-center rounded-full bg-primary font-semibold leading-none text-primary-foreground",
                isRail
                  ? "right-0.5 top-0.5 h-3.5 min-w-3.5 px-1 text-[9px]"
                  : "-right-0.5 -top-0.5 h-4 min-w-4 px-1 text-[10px]"
              )}
            >
              {badge}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align={isRail ? "start" : "end"}
        side={isRail ? "right" : "bottom"}
        sideOffset={8}
        className="w-[380px] p-0"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-foreground">{t("title")}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!hasUnread || markAll.isPending}
            onClick={() => markAll.mutate()}
            className="h-7 px-2 text-xs"
          >
            {t("markAllRead")}
          </Button>
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {isLoading ? (
            <ItemSkeleton count={3} />
          ) : recent.isError ? (
            <div role="alert" className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <IconAlertTriangle className="size-6 text-destructive" />
              <p className="text-xs text-muted-foreground">
                {recent.error instanceof Error ? recent.error.message : t("loadErrorFallback")}
              </p>
              <button
                type="button"
                onClick={() => void recent.refetch()}
                className="text-xs font-semibold text-foreground underline underline-offset-2"
              >
                {t("retry")}
              </button>
            </div>
          ) : items.length === 0 ? (
            <EmptyState label={t("empty")} />
          ) : (
            items.map((n) => (
              <NotificationRow
                key={n.id}
                item={n}
                locale={locale}
                onClick={() => handleItemClick(n)}
              />
            ))
          )}
        </div>

        <div className="border-t border-border px-4 py-2">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              router.push(localizePath("/messages?tab=notifications", locale));
            }}
            className="block w-full rounded-md py-1.5 text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            {t("seeAll")}
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationRow({
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
          {content.title}
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground">{content.body}</span>
        <span className="text-[11px] text-muted-foreground/80">
          {formatAgo(item.createdAt, locale)}
        </span>
      </div>
    </button>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
      <IconBellOff className="size-8 opacity-60" />
      <span>{label}</span>
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
function formatAgo(iso: string, locale: Locale): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return iso;
  const diffMs = Date.now() - ts;
  const formatter = new Intl.RelativeTimeFormat(locale, {
    numeric: "auto",
    style: "narrow",
  });
  if (diffMs < 60_000) return formatter.format(0, "second");
  if (diffMs < 3_600_000) return formatter.format(-Math.floor(diffMs / 60_000), "minute");
  if (diffMs < 86_400_000) return formatter.format(-Math.floor(diffMs / 3_600_000), "hour");
  if (diffMs < 7 * 86_400_000) return formatter.format(-Math.floor(diffMs / 86_400_000), "day");
  return new Date(iso).toLocaleDateString(locale);
}
