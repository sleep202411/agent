"use client";

import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";
import type { TimelineExportReport } from "@repo/timeline-export";

export function TimelineExportReportPanel({
  report,
  onDismiss,
}: {
  report: TimelineExportReport;
  onDismiss: () => void;
}) {
  const t = useTranslations("timeline");
  const common = useTranslations("common");
  return (
    <section
      aria-label={t("exportReportTitle")}
      className="shrink-0 border-b border-white/10 px-4 py-3 text-sm text-white/80"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium" role="status">
          {t("exportReportTitle")}
        </h3>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          {common("close")}
        </Button>
      </div>
      <p>{t("exportReportHelp")}</p>
      <ul className="max-h-32 overflow-y-auto">
        {report.issues.map((issue, index) => (
          <li key={`${issue.index}:${index}`} className="py-1">
            {t("exportReportShot", { number: issue.index + 1 })}: {t(`exportIssue.${issue.reason}`)}
          </li>
        ))}
      </ul>
    </section>
  );
}
