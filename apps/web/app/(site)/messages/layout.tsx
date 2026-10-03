"use client";

import { CrewSectionNavigation } from "../crews/_components/crew-section-navigation";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { IconBell, IconMessageCircle } from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { useUnreadCount } from "@/src/lib/notifications";
import { cn } from "@/lib/utils";

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  const t = useTranslations("messages");
  const c = useTranslations("crew");
  const pathname = usePathname();
  const params = useSearchParams();
  const notifications = pathname?.endsWith("/messages") && params.get("tab") === "notifications";
  const { data: unread = 0 } = useUnreadCount();
  const tabs = [
    {
      href: `/${locale}/messages`,
      label: t("chatTab"),
      Icon: IconMessageCircle,
      active: !notifications && params.get("tab") !== "recruitment",
    },
    {
      href: `/${locale}/messages?tab=recruitment`,
      label: c("messagesOffersTab"),
      Icon: IconMessageCircle,
      active: params.get("tab") === "recruitment",
    },
    {
      href: `/${locale}/messages?tab=notifications`,
      label: t("notificationTab"),
      Icon: IconBell,
      active: notifications,
    },
  ];

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] min-h-[360px] w-full max-w-[1800px] flex-col">
      {
        <div className="shrink-0 px-4 pt-4 sm:px-6">
          <CrewSectionNavigation active="applications" showDashboard={false} sticky={false} />
        </div>
      }
      <header className="shrink-0 px-4 pt-2 sm:px-6">
        <h1 className="text-base font-semibold text-foreground">{t("centerTitle")}</h1>
        <nav
          className="mt-2 flex flex-wrap gap-4 border-b border-border"
          aria-label={t("centerTitle")}
        >
          {tabs.map(({ href, label, Icon, active }) => (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex items-center gap-2 border-b-2 px-1 pb-2 text-xs font-medium",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-4" />
              {label}
              {Icon === IconBell && unread > 0 && (
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
