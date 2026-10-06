"use client";

import { IconCloudExclamation, IconCopy } from "@tabler/icons-react";
import { useTranslations } from "next-intl";

/** A failed status lookup is distinct from both generation progress and failure. */
export function GenerationStatusUnavailable({
  jobId,
  onCopyId,
}: {
  jobId?: string;
  onCopyId: () => void;
}) {
  const t = useTranslations("canvasOps");
  return (
    <div className="flex max-w-full flex-col items-center gap-3 px-5 text-center">
      <IconCloudExclamation className="size-8 text-white/65" stroke={1.6} aria-hidden="true" />
      <div role="status" className="space-y-1">
        <p className="text-sm font-medium text-white/80">{t("statusReadUnavailableTitle")}</p>
        <p className="text-xs leading-relaxed text-white/55">{t("statusReadUnavailable")}</p>
      </div>
      {jobId && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onCopyId();
          }}
          className="nodrag flex max-w-full items-center gap-1.5 rounded-full px-2 py-1 text-xs text-white/55 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          title={jobId}
          aria-label={t("copyTaskId")}
        >
          <span className="truncate font-mono">{jobId}</span>
          <IconCopy className="size-3.5 shrink-0" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
