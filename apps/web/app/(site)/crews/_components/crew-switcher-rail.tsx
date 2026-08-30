"use client";

import { useMemo } from "react";
import Link from "next/link";
import { IconAlertTriangle, IconLayoutGrid } from "@tabler/icons-react";

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
  currentCrew: RailCrew;
  showNames?: boolean;
}

/** Workspace adapter: owns the shared query and ensures the open crew is
 * always present, even while the membership cache is refreshing. */
export function CrewSwitcherRail({ currentCrew, showNames = false }: CrewSwitcherRailProps) {
  const myCrews = useMyCrews();
  const crews = useMemo(
    () =>
      mergeCrewMemberships(myCrews.data?.founded ?? [], myCrews.data?.joined ?? [], currentCrew),
    [currentCrew, myCrews.data]
  );

  return (
    <CrewSwitcherRailView
      crews={crews}
      currentCrewId={currentCrew.id}
      showNames={showNames}
      isPending={myCrews.isPending}
      error={myCrews.error}
      onRetry={() => void myCrews.refetch()}
      className="md:flex"
    />
  );
}

interface CrewSwitcherRailViewProps {
  crews: RailCrew[];
  currentCrewId?: string;
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
  crews,
  currentCrewId,
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
  const effectiveRootLabel = rootLabel ?? t("allCrews");

  return (
    <aside
      aria-label={t("crewSwitcherNavigation")}
      className={cn(
        "hidden min-h-0 flex-col items-center border-r border-white/[0.075] bg-[#07080a] px-2 py-2",
        showNames && "min-[1152px]:items-stretch",
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
          showNames &&
            "min-[1152px]:flex min-[1152px]:w-full min-[1152px]:justify-start min-[1152px]:gap-3 min-[1152px]:px-2",
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
          <span className="hidden min-w-0 truncate text-[12px] font-medium min-[1152px]:block">
            {effectiveRootLabel}
          </span>
        ) : null}
      </Link>

      <div
        className={cn(
          "my-2 h-px w-8 shrink-0 bg-white/[0.075]",
          showNames && "min-[1152px]:w-full"
        )}
      />

      <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto py-0.5">
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
                  href={localizePath(`/crews/${encodeURIComponent(crew.id)}/workspace`, locale)}
                  aria-label={crew.name}
                  aria-current={active ? "page" : undefined}
                  title={crew.name}
                  className={cn(
                    "group relative grid size-10 shrink-0 place-items-center rounded-[12px] outline-none transition-[border-radius,background-color] focus-visible:ring-2 focus-visible:ring-[#e52227]/70",
                    showNames &&
                      "min-[1152px]:flex min-[1152px]:w-full min-[1152px]:justify-start min-[1152px]:gap-3 min-[1152px]:px-2",
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
                  {showNames ? (
                    <span className="hidden min-w-0 truncate text-[12px] font-medium text-[#d8dae0] min-[1152px]:block">
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
