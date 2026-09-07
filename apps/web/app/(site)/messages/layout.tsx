"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { IconBell, IconMessageCircle } from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { useUnreadCount } from "@/src/lib/notifications";
import { cn } from "@/lib/utils";

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  const t = useTranslations("messages");
  const pathname = usePathname();
  const params = useSearchParams();
  const notifications = pathname?.endsWith("/messages") && params.get("tab") === "notifications";
  const { data: unread = 0 } = useUnreadCount();
  const tabs = [
    {
      href: `/${locale}/messages`,
      label: t("chatTab"),
      Icon: IconMessageCircle,
      active: !notifications,
    },
    {
      href: `/${locale}/messages?tab=notifications`,
      label: t("notificationTab"),
      Icon: IconBell,
      active: notifications,
    },
  ];

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] min-h-[360px] w-full max-w-6xl flex-col">
      <header className="shrink-0 px-4 pt-6 sm:px-6">
        <h1 className="text-xl font-semibold text-foreground">{t("centerTitle")}</h1>
        <nav className="mt-4 flex gap-6 border-b border-border" aria-label={t("centerTitle")}>
          {tabs.map(({ href, label, Icon, active }, index) => (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-medium",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-4" />
              {label}
              {index === 1 && unread > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
          ))}
        </nav>
      </header>
      <div
        className={cn(
          "min-h-0 flex-1",
          notifications ? "overflow-y-auto overscroll-y-contain" : "overflow-hidden"
        )}
      >
        {children}
      </div>
    </div>
  );
}
