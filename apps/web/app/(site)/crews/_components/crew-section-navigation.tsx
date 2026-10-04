"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { IconBriefcase, IconListCheck, IconUsers, IconMessageCircle } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";

type LobbyView = "mine" | "crews" | "positions";
type CrewSection = LobbyView | "tasks" | "income" | "applications" | "feedback" | "cases";

const sections = [
  { id: "positions", label: "allPositionsTab", icon: IconBriefcase, href: "/crews?view=positions" },
  {
    id: "applications",
    label: "messagesOffersTab",
    icon: IconMessageCircle,
    href: "/messages?tab=recruitment",
  },
  { id: "mine", label: "myCrewsTitle", icon: IconUsers, href: "/crews?view=mine" },
  { id: "tasks", label: "taskDashboardTab", icon: IconListCheck, href: "/crews/tasks" },
  { id: "crews", label: "allCrewsTitle", icon: IconUsers, href: "/crews?view=crews" },
] as const;
const dashboardSections = [
  { id: "applications", label: "myApplicationsTab", href: "/messages?tab=recruitment" },
  { id: "tasks", label: "myTasksTab", href: "/crews/tasks" },
] as const;

/** Keep the same section navigation above the lobby, task center and income. */
export function CrewSectionNavigation({
  active,
  onViewChange,
  children,
  showDashboard = true,
  sticky = true,
}: {
  active: CrewSection;
  onViewChange?: (view: LobbyView) => void;
  children?: ReactNode;
  showDashboard?: boolean;
  sticky?: boolean;
}) {
  const t = useTranslations("crew");
  const messagesT = useTranslations("messages");
  const locale = useLocale() as Locale;
  return (
    <div
      className={cn(
        "mb-3 shrink-0 bg-background",
        sticky && "md:sticky md:top-[88px] md:z-30 lg:top-[96px]"
      )}
    >
      <nav
        aria-label={t("navigationLabel")}
        className="flex flex-wrap items-center gap-1 border-b border-border bg-background py-1"
      >
        {sections.map(({ id, label, icon: Icon, href }) => {
          const selected =
            active === id || (id === "tasks" && (active === "feedback" || active === "cases"));
          const className = cn(
            "relative inline-flex min-h-11 items-center gap-2 px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            selected ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          );
          const content = (
            <>
              {Icon && <Icon className="size-4" aria-hidden="true" />}
              {id === "applications" ? messagesT("centerTitle") : t(label)}
              {selected && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </>
          );
          // Preserve the lobby's query/filter state and scroll behavior.
          if (onViewChange && (id === "mine" || id === "crews" || id === "positions")) {
            return (
              <button
                key={id}
                type="button"
                className={className}
                aria-pressed={selected}
                onClick={() => onViewChange(id)}
              >
                {content}
              </button>
            );
          }
          return (
            <Link
              key={id}
              href={localizePath(href, locale)}
              className={className}
              aria-current={selected ? "page" : undefined}
            >
              {content}
            </Link>
          );
        })}
        {children}
      </nav>
      {showDashboard && dashboardSections.some((section) => section.id === active) ? (
        <nav
          aria-label={t("taskDashboardTab")}
          className="flex flex-wrap items-center gap-1 border-b border-border py-2"
        >
          {dashboardSections.map((section) => (
            <Link
              key={section.id}
              href={localizePath(section.href, locale)}
              aria-current={active === section.id ? "page" : undefined}
              className={cn(
                "rounded-full px-3 py-2 text-xs",
                active === section.id
                  ? "bg-white/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t(section.label)}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
