"use client";

import { useEffect, useState } from "react";
import { IconWand, IconFileText } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import type { CrewTaskListItemDTO } from "@/app/(site)/crews/_hooks/types";
import { workbenchStatistics } from "./workbench-statistics";

export function WorkbenchDashboard({
  tasks,
  ready,
  canInitialize,
  disabled,
  onInitialize,
}: {
  tasks: CrewTaskListItemDTO[];
  ready: boolean;
  canInitialize: boolean;
  disabled: boolean;
  onInitialize: () => void;
}) {
  const t = useTranslations("crewTaskProject.workbench");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const stats = workbenchStatistics(tasks, now);
  return (
    <section className="grid gap-4 @[900px]:grid-cols-12" aria-label={t("dashboardStatistics")}>
      <dl
        className={`grid grid-cols-2 gap-3 rounded-sm bg-white/[0.035] p-3 @[500px]:grid-cols-4 ${canInitialize ? "@[900px]:col-span-7" : "@[900px]:col-span-12"}`}
      >
        {(["total", "inProgress", "overdue", "completed"] as const).map((key) => (
          <div key={key}>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t(`dashboard_${key}`)}
            </dt>
            <dd
              className={`mt-2 text-3xl font-semibold tabular-nums ${key === "overdue" ? "text-[#e52227]" : key === "inProgress" ? "text-[#4D8DFF]" : "text-foreground"}`}
            >
              {ready ? stats[key] : "—"}
            </dd>
          </div>
        ))}
      </dl>
      {canInitialize && (
        <button
          type="button"
          onClick={onInitialize}
          disabled={disabled}
          className="group flex min-h-20 items-center gap-3 rounded-sm border border-[#e52227]/40 bg-black/20 p-4 text-left transition hover:border-[#e52227] focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 @[900px]:col-span-5"
        >
          <span className="flex size-16 shrink-0 items-center justify-center rounded-sm bg-white/5">
            <IconFileText className="size-7 text-muted-foreground group-hover:text-primary" />
          </span>
          <span>
            <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
              <IconWand className="size-4 text-primary" />
              {t("initializeTasks")}
            </span>
            <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">
              {t("dashboardInitializeHelp")}
            </span>
          </span>
        </button>
      )}
    </section>
  );
}
