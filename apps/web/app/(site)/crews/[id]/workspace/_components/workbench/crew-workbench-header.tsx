"use client";

import { IconCube } from "@tabler/icons-react";

import { useCrewProductionOverview } from "@/app/(site)/crews/_hooks/use-production";
import { useTranslations } from "@/src/i18n/i18n";
import { CrewStudioWorkspacePicker } from "./crew-studio-workspace-picker";

export function CrewWorkbenchHeader({
  crewId,
  crewName,
  pageTitle,
  showProductionActions,
}: {
  crewId: string;
  crewName: string;
  pageTitle: string;
  showProductionActions: boolean;
}) {
  const tw = useTranslations("crewWorkbench");
  const overview = useCrewProductionOverview(crewId, showProductionActions);

  return (
    <header
      aria-label={tw("header")}
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.065] bg-background px-3 py-3 sm:flex-nowrap"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-[#e52227]/10 text-[#ef4444]">
        <IconCube className="size-4" stroke={1.8} />
      </span>
      <div className="flex min-w-0 flex-1 basis-24 items-center gap-2 sm:basis-auto">
        <h1 className="truncate text-[13px] font-semibold text-[#e8e9ec]" title={crewName}>
          {crewName}
        </h1>
        <span aria-hidden="true" className="hidden text-[#454a53] sm:block">
          /
        </span>
        <span className="hidden shrink-0 text-xs text-[#858a95] sm:block">{pageTitle}</span>
      </div>
      <div className="ml-auto flex min-w-0 max-w-full shrink-0 items-center gap-2">
        {showProductionActions ? (
          <CrewStudioWorkspacePicker
            key={crewId}
            crewId={crewId}
            value={overview.data?.studioWorkspace ?? null}
            legacyProject={overview.data?.studioProject ?? null}
            disabled={overview.isError || !overview.data?.capabilities.linkWorkspace}
          />
        ) : null}
      </div>
    </header>
  );
}
