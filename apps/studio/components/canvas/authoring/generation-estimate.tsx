"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/** Estimated remaining duration, anchored to the job rather than the mounted card. */
export function GenerationEstimate({
  seconds,
  createdAt,
}: {
  seconds?: number;
  createdAt?: string;
}) {
  const t = useTranslations("canvasOps");
  const [now, setNow] = useState<number | null>(null);
  const start = createdAt ? Date.parse(createdAt) : NaN;
  const valid = seconds != null && Number.isFinite(seconds) && seconds > 0;
  useEffect(() => {
    if (!valid || !Number.isFinite(start)) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [valid, start]);
  if (!valid) return <>{t("statusGenerating")}</>;
  if (!Number.isFinite(start) || now === null)
    return <>{t("statusGeneratingEstimate", { seconds: Math.ceil(seconds) })}</>;
  const remaining = Math.ceil(seconds - Math.max(0, now - start) / 1000);
  return (
    <>
      {remaining > 0
        ? t("statusGeneratingRemaining", { seconds: remaining })
        : t("statusGeneratingLonger")}
    </>
  );
}
