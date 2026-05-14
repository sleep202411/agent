"use client";

import { IconGift } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Input } from "@/components/ui/input";

interface FreePreviewCardProps {
  value: number;
  /** Total episode count — caps the slider's upper bound and lets us
   *  warn the IP owner when *every* episode is free. */
  totalEpisodes: number;
  onChange: (n: number) => void;
}

export function FreePreviewCard({ value, totalEpisodes, onChange }: FreePreviewCardProps) {
  const t = useTranslations("ipEdit");
  const max = Math.max(totalEpisodes, 1);
  const clamped = Math.max(0, Math.min(value, max));
  const allFree = totalEpisodes > 0 && clamped >= totalEpisodes;

  return (
    <PricingCard icon={<IconGift className="size-4" />} title={t("pricingFreePreviewTitle")}>
      <p className="text-xs text-muted-foreground">{t("pricingFreePreviewHint")}</p>

      <div className="mt-4 flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={clamped}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
          aria-label={t("pricingFreePreviewTitle")}
        />
        <Input
          type="number"
          min={0}
          max={max}
          inputMode="numeric"
          value={String(clamped)}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            if (Number.isFinite(n)) onChange(Math.max(0, Math.min(n, max)));
          }}
          className="h-8 w-16 text-center text-sm tabular-nums"
        />
        <span className="shrink-0 text-xs text-muted-foreground">
          / {totalEpisodes} {t("pricingEpisodes")}
        </span>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {totalEpisodes === 0
          ? t("pricingFreePreviewNoEpisodes")
          : allFree
            ? t("pricingFreePreviewAllFreeWarn")
            : t("pricingFreePreviewSummary", { n: clamped })}
      </p>
    </PricingCard>
  );
}

// Local atom — kept here so all three cards share a single
// visual rhythm without a separate "ui/card" abstraction.
function PricingCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="text-primary">{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

export { PricingCard };
