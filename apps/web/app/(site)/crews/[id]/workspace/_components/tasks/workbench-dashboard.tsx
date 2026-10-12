"use client";

import { IconWand, IconFileText, IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import type { CrewTaskListItemDTO } from "@/app/(site)/crews/_hooks/types";

export function WorkbenchDashboard({
  canInitialize,
  disabled,
  analysisStatus = "idle",
  onInitialize,
}: {
  tasks: CrewTaskListItemDTO[];
  ready: boolean;
  canInitialize: boolean;
  disabled: boolean;
  analysisStatus?: string;
  onInitialize: () => void;
}) {
  const t = useTranslations("crewTaskProject.workbench");
  const analyzing = analysisStatus === "queued" || analysisStatus === "analyzing";
  return (
    <section className="grid gap-4 @[900px]:grid-cols-12" aria-label={t("dashboardStatistics")}>
      {canInitialize && (
        <button
          type="button"
          onClick={onInitialize}
          disabled={disabled}
          className="group flex min-h-20 items-center gap-3 rounded-sm border border-[#e52227]/40 bg-black/20 p-4 text-left transition hover:border-[#e52227] focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 @[900px]:col-span-12"
        >
          <span className="flex size-16 shrink-0 items-center justify-center rounded-sm bg-white/5">
            {analyzing ? (
              <IconLoader2
                className="size-7 text-primary motion-safe:animate-spin"
                aria-hidden="true"
              />
            ) : (
              <IconFileText
                className="size-7 text-muted-foreground group-hover:text-primary"
                aria-hidden="true"
              />
            )}
          </span>
          <span>
            <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
              <IconWand className="size-4 text-primary" />
              {t("initializeTasks")}
            </span>
            <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">
              {t("dashboardInitializeHelp")}
            </span>
            <span role="status" className="block text-xs text-primary">
              {analysisStatus !== "idle"
                ? t("analysisStatus", { status: t(`analysis_${analysisStatus}`) })
                : null}
            </span>
          </span>
        </button>
      )}
    </section>
  );
}
