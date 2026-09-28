"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { IconBriefcase, IconCoins, IconListCheck, IconUsers } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";

type LobbyView = "mine" | "crews" | "positions";
type CrewSection = LobbyView | "tasks" | "income" | "applications" | "feedback" | "cases";

const sections = [
  { id: "mine", label: "myCrewsTitle", icon: IconUsers, href: "/crews?view=mine" },
  {
    id: "applications",
    label: "myApplicationsTab",
    icon: IconBriefcase,
    href: "/crews/applications",
  },
  { id: "tasks", label: "myTasksTab", icon: IconListCheck, href: "/crews/tasks" },
  { id: "feedback", label: "myFeedbackTab", icon: IconListCheck, href: "/crews/feedback" },
  { id: "cases", label: "myCasesTab", icon: IconListCheck, href: "/crews/cases" },
  { id: "income", label: "myIncomeTab", icon: IconCoins, href: "/crews/income" },
  { id: "crews", label: "allCrewsTitle", icon: IconUsers, href: "/crews?view=crews" },
  { id: "positions", label: "allPositionsTab", icon: IconBriefcase, href: "/crews?view=positions" },
] as const;

/** Keep the same section navigation above the lobby, task center and income. */
export function CrewSectionNavigation({
  active,
  onViewChange,
  children,
}: {
  active: CrewSection;
  onViewChange?: (view: LobbyView) => void;
  children?: ReactNode;
}) {
  const t = useTranslations("crew");
  const locale = useLocale() as Locale;
  return (
    <nav
      aria-label={t("navigationLabel")}
      className="sticky top-[80px] z-30 mb-6 flex flex-wrap items-center gap-1 border-b border-border bg-background py-1 md:top-[88px] lg:top-[96px]"
    >
      {sections.map(({ id, label, icon: Icon, href }) => {
        const selected = active === id;
        const className = cn(
          "relative inline-flex min-h-11 items-center gap-2 px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          selected ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        );
        const content = (
          <>
            {Icon && <Icon className="size-4" aria-hidden="true" />}
            {t(label)}
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
  );
}
