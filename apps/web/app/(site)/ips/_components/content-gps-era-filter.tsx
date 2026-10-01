"use client";

import { useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";

/** The timeline exists only for an explicit valid story interval. Its domain is
 * derived from that interval, never the release date or current year. */
export function ContentGpsEraFilter({
  startYear,
  endYear,
  onChange,
}: {
  startYear: number;
  endYear: number;
  onChange: (start: number, end: number) => void;
}) {
  const t = useTranslations("contentGpsDiscovery");
  const [domain, setDomain] = useState(() => ({
    min: Math.max(Number.MIN_SAFE_INTEGER, startYear - 100),
    max: Math.min(Number.MAX_SAFE_INTEGER, endYear + 100),
  }));
  // Keep a stable scale while dragging. Explicit year input may expand it.
  if (startYear < domain.min || endYear > domain.max)
    setDomain({ min: Math.min(domain.min, startYear), max: Math.max(domain.max, endYear) });
  const { min, max } = domain;
  return (
    <fieldset className="mt-4 space-y-3 rounded-xl bg-muted/20 p-4">
      <legend className="px-1 text-sm font-medium">{t("storyEra")}</legend>
      <p className="text-sm tabular-nums" aria-live="polite">
        {startYear}–{endYear}
      </p>
      <label className="flex min-h-11 items-center gap-3 text-xs">
        <span className="w-20 shrink-0">{t("fromYear")}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={startYear}
          aria-valuetext={String(startYear)}
          className="min-w-0 flex-1 accent-primary"
          onChange={(event) => onChange(Math.min(Number(event.target.value), endYear), endYear)}
        />
      </label>
      <label className="flex min-h-11 items-center gap-3 text-xs">
        <span className="w-20 shrink-0">{t("toYear")}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={endYear}
          aria-valuetext={String(endYear)}
          className="min-w-0 flex-1 accent-primary"
          onChange={(event) => onChange(startYear, Math.max(startYear, Number(event.target.value)))}
        />
      </label>
      <p className="text-xs text-muted-foreground">{t("unapplied")}</p>
    </fieldset>
  );
}
