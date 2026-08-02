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

interface CrewSwitcherRailProps {
  currentCrew: Pick<CrewDTO, "id" | "logo" | "name">;
}

export function CrewSwitcherRail({ currentCrew }: CrewSwitcherRailProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations("crewWorkbench");
  const myCrews = useMyCrews();
  const crews = useMemo(() => {
    const byId = new Map<string, Pick<CrewDTO, "id" | "logo" | "name">>();
    for (const crew of [...(myCrews.data?.founded ?? []), ...(myCrews.data?.joined ?? [])]) {
      byId.set(crew.id, crew);
    }
    if (!byId.has(currentCrew.id)) byId.set(currentCrew.id, currentCrew);
    return [...byId.values()];
  }, [currentCrew, myCrews.data]);

  return (
    <aside
      aria-label={t("crewSwitcherNavigation")}
      className="hidden min-h-0 flex-col items-center border-r border-white/[0.075] bg-[#07080a] px-2 py-2 md:flex"
    >
      <Link
        href={localizePath("/crews", locale)}
        aria-label={t("allCrews")}
        title={t("allCrews")}
        className="grid size-10 shrink-0 place-items-center rounded-[12px] text-[#858a95] outline-none transition-colors hover:bg-white/[0.055] hover:text-[#eceef2] focus-visible:ring-2 focus-visible:ring-[#e52227]/70"
      >
        <IconLayoutGrid className="size-[18px]" stroke={1.75} />
      </Link>

      <div className="my-2 h-px w-8 shrink-0 bg-white/[0.075]" />

      <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto py-0.5">
        {myCrews.isPending
          ? Array.from({ length: 3 }).map((_, index) => (
              <span
                key={index}
                className="size-10 shrink-0 animate-pulse rounded-[12px] bg-white/[0.055]"
                aria-hidden="true"
              />
            ))
          : null}

        {!myCrews.isPending
          ? crews.map((crew) => {
              const active = crew.id === currentCrew.id;
              return (
                <Link
                  key={crew.id}
                  href={localizePath(`/crews/${encodeURIComponent(crew.id)}/workspace`, locale)}
                  aria-label={crew.name}
                  aria-current={active ? "page" : undefined}
                  title={crew.name}
                  className={cn(
                    "group relative grid size-10 shrink-0 place-items-center rounded-[12px] outline-none transition-[border-radius,background-color] focus-visible:ring-2 focus-visible:ring-[#e52227]/70",
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
                    className="size-9 rounded-[10px] transition-[border-radius] group-hover:rounded-[8px]"
                  />
                </Link>
              );
            })
          : null}

        {myCrews.isError ? (
          <span
            role="alert"
            aria-label={
              myCrews.error instanceof Error ? myCrews.error.message : String(myCrews.error)
            }
            title={myCrews.error instanceof Error ? myCrews.error.message : String(myCrews.error)}
            className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[#e52227]/10 text-[#e85b60]"
          >
            <IconAlertTriangle className="size-[18px]" stroke={1.75} />
          </span>
        ) : null}
      </div>
    </aside>
  );
}
