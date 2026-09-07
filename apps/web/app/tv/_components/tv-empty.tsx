"use client";

import { useTranslations } from "@/src/i18n/i18n";
import { IconDeviceTv, IconRefresh } from "@tabler/icons-react";

export function TvLoadingState() {
  const t = useTranslations("tv");
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white/50">
      <IconDeviceTv className="size-10 animate-pulse text-white/30" />
      <p className="text-sm">{t("loading")}</p>
    </div>
  );
}

export function TvEmptyState({ hasItems }: { hasItems: boolean }) {
  const t = useTranslations("tv");
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
      <IconDeviceTv className="size-12 text-white/30" />
      <p className="text-sm text-white/70">{hasItems ? t("selectIp") : t("noIps")}</p>
    </div>
  );
}

export function TvErrorState({ message, onRetry }: { message?: string; onRetry: () => void }) {
  const t = useTranslations("tv");
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
      <p className="text-sm text-white/70">{message || t("loadFailed")}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20"
      >
        <IconRefresh className="size-4" />
        {t("retry")}
      </button>
    </div>
  );
}
