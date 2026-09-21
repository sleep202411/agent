"use client";

import { useTranslations } from "next-intl";

/** The API supplies a total estimate, never a remaining-time clock. */
export function GenerationEstimate({ seconds }: { seconds?: number }) {
  const t = useTranslations("canvasOps");
  return (
    <>
      {seconds != null && Number.isFinite(seconds) && seconds > 0
        ? t("statusGeneratingEstimate", { seconds: Math.ceil(seconds) })
        : t("statusGenerating")}
    </>
  );
}
