"use client";

import { CrewUnreadMarker } from "./crew-unread-marker";

import { useMemo } from "react";
import Link from "next/link";
import { IconAlertTriangle, IconLayoutGrid, IconListCheck } from "@tabler/icons-react";

import { CrewLogo } from "@/app/(site)/messages/_components/crew-logo";
import { useMyCrews, type CrewDTO } from "@/app/(site)/crews/_hooks/use-crew";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";

type RailCrew = Pick<CrewDTO, "id" | "logo" | "name">;

export function shouldShowCrewSwitcherRail({
  crewCount,
  isPending,
  isError,
}: {
  crewCount: number;
  isPending: boolean;
  isError: boolean;
}): boolean {
  return isPending || isError || crewCount > 0;
}

interface CrewSwitcherRailProps {
  embedded?: boolean;
  currentCrew: RailCrew;
  currentCrewHref?: string;
  showNames?: boolean;
}

/** Workspace adapter: owns the shared query and ensures the open crew is
 * always present, even while the membership cache is refreshing. */
export function CrewSwitcherRail({
  embedded = false,
  currentCrew,
  currentCrewHref,
  showNames = false,
}: CrewSwitcherRailProps) {
  const myCrews = useMyCrews();
  const crews = useMemo(
    () =>
      mergeCrewMemberships(myCrews.data?.founded ?? [], myCrews.data?.joined ?? [], currentCrew),
    [currentCrew, myCrews.data]
  );

  return (
    <CrewSwitcherRailView
      embedded={embedded}
      crews={crews}
      currentCrewId={currentCrew.id}
      currentCrewHref={currentCrewHref}
      showNames={showNames}
      isPending={myCrews.isPending}
      error={myCrews.error}
      onRetry={() => void myCrews.refetch()}
      className="md:flex"
    />
  );
}

interface CrewSwitcherRailViewProps {
  embedded?: boolean;
  crews: RailCrew[];
  currentCrewId?: string;
  currentCrewHref?: string;
  allCrewsActive?: boolean;
  rootLabel?: string;
  showNames?: boolean;
  isPending?: boolean;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}

/** Shared desktop crew rail used by both Crew Hall and the crew workspace. */
export function CrewSwitcherRailView({
  embedded = false,
  crews,
  currentCrewId,
  currentCrewHref,
  allCrewsActive = false,
  rootLabel,
  showNames = false,
  isPending = false,
  error,
  onRetry,
  className,
}: CrewSwitcherRailViewProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations("crewWorkbench");
  const taskT = useTranslations("crewTaskCenter");
  const effectiveRootLabel = rootLabel ?? t("allCrews");

  return (
    <aside
      aria-label={t("crewSwitcherNavigation")}
      className={cn(
        "hidden min-h-0 flex-col items-center overflow-y-auto border-r border-white/[0.075] bg-background py-2",
        showNames && "md:items-stretch",
        className
      )}
    >
      <Link
        href={localizePath("/crews", locale)}
        aria-label={effectiveRootLabel}
        aria-current={allCrewsActive ? "page" : undefined}
        title={effectiveRootLabel}
        className={cn(
          "relative grid size-10 shrink-0 place-items-center rounded-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#e52227]/70",
          showNames && "md:flex md:w-full md:justify-start md:gap-3 md:px-2",
          allCrewsActive
            ? "bg-white/[0.09] text-[#eceef2]"
            : "text-[#858a95] hover:bg-white/[0.055] hover:text-[#eceef2]"
        )}
      >
        {allCrewsActive ? (
          <span className="absolute -left-2 h-5 w-0.5 rounded-r bg-[#e52227]" />
        ) : null}
        <IconLayoutGrid className="size-[18px] shrink-0" stroke={1.75} />
        {showNames ? (
          <span className="hidden min-w-0 truncate text-[12px] font-medium md:block">
            {effectiveRootLabel}
          </span>
        ) : null}
      </Link>

      <Link
        href={localizePath("/crews/tasks", locale)}
        aria-label={taskT("title")}
        title={taskT("title")}
        className="grid size-10 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-secondary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
      >
        <IconListCheck className="size-[18px]" stroke={1.75} />
      </Link>

      <div className={cn("my-2 h-px w-8 shrink-0 bg-white/[0.075]", showNames && "md:w-full")} />

      <div className="flex min-h-12 w-full flex-1 flex-col items-center gap-2 overflow-x-hidden overflow-y-auto px-2 py-1">
        {isPending
          ? Array.from({ length: 3 }).map((_, index) => (
              <span
                key={index}
                className="size-10 shrink-0 animate-pulse rounded-[12px] bg-white/[0.055]"
                aria-hidden="true"
              />
            ))
          : null}

        {!isPending
          ? crews.map((crew) => {
              const active = crew.id === currentCrewId;
              return (
                <Link
                  key={crew.id}
                  href={
                    active && currentCrewHref
                      ? currentCrewHref
                      : localizePath(
                          embedded
                            ? `/crews?view=mine&crew=${encodeURIComponent(crew.id)}`
                            : `/crews/${encodeURIComponent(crew.id)}/workspace`,
                          locale
                        )
                  }
                  aria-label={crew.name}
                  aria-current={active ? "page" : undefined}
                  title={crew.name}
                  className={cn(
                    "group relative grid size-10 shrink-0 place-items-center rounded-[12px] outline-none transition-[border-radius,background-color] focus-visible:ring-2 focus-visible:ring-[#e52227]/70",
                    showNames && "md:flex md:w-full md:justify-start md:gap-3 md:px-2",
                    active ? "bg-white/[0.09]" : "hover:bg-white/[0.055]"
                  )}
                >
                  {active ? (
                    <span className="absolute -left-2 h-5 w-0.5 rounded-r bg-[#e52227]" />
                  ) : null}
                  <CrewLogo
                    logo={crew.logo}
                    name={crew.name}
                    crewId={crew.id}
                    className="size-9 shrink-0 rounded-[10px] transition-[border-radius] group-hover:rounded-[8px]"
                  />
                  <CrewUnreadMarker crewId={crew.id} />
                  {showNames ? (
                    <span className="hidden min-w-0 truncate text-[12px] font-medium text-[#d8dae0] md:block">
                      {crew.name}
                    </span>
                  ) : null}
                </Link>
              );
            })
          : null}

        {error ? (
          <button
            type="button"
            onClick={onRetry}
            role="alert"
            aria-label={error instanceof Error ? error.message : String(error)}
            title={error instanceof Error ? error.message : String(error)}
            className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[#e52227]/10 text-[#e85b60] outline-none hover:bg-[#e52227]/20 focus-visible:ring-2 focus-visible:ring-[#e52227]/70"
          >
            <IconAlertTriangle className="size-[18px]" stroke={1.75} />
          </button>
        ) : null}
      </div>
    </aside>
  );
}

export function mergeCrewMemberships(
  founded: RailCrew[],
  joined: RailCrew[],
  currentCrew?: RailCrew
): RailCrew[] {
  const byId = new Map<string, RailCrew>();
  for (const crew of [...founded, ...joined]) byId.set(crew.id, crew);
  if (currentCrew && !byId.has(currentCrew.id)) byId.set(currentCrew.id, currentCrew);
  return [...byId.values()];
}
