"use client";

/**
 * MessagesButton — top-nav inbox shortcut. Links to /messages with
 * an unread-count badge fed from the first page of `useInbox()`.
 *
 * Render only for logged-in users (caller gates on
 * `useCurrentUser`). Live updates: `useInbox` is invalidated by
 * `ConversationsProvider` on every incoming WS push, so the badge
 * stays current without polling.
 *
 * The badge sums the first page of conversations (≤ 24 items).
 * That's an under-count for users with > 24 active inquiries with
 * unread tail; not Phase 1b critical. A dedicated
 * `/conversations/unread-count` endpoint can replace this when the
 * miscount starts to matter.
 */
import Link from "next/link";
import { IconMessageCircle } from "@tabler/icons-react";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { cn } from "@/lib/utils";
import { useInbox } from "@/app/(site)/creators/_hooks/use-conversations";

export function MessagesButton({ className }: { className?: string }) {
  const t = useTranslations("messages");
  const locale = useLocale() as Locale;
  const inbox = useInbox();
  const items = inbox.data?.items ?? [];
  const unread = items.reduce((s, c) => s + c.unreadCount, 0);
  const label = unread > 99 ? "99+" : String(unread);

  return (
    <Link
      href={localizePath("/messages", locale)}
      aria-label={t("inboxTitle")}
      className={cn(
        "relative flex size-9 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      <IconMessageCircle className="size-4" />
      {unread > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold tabular-nums text-primary-foreground">
          {label}
        </span>
      ) : null}
    </Link>
  );
}
