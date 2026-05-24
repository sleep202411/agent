"use client";

import { IconCoin } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PricingCard } from "./pricing-card";

interface DefaultPriceCardProps {
  value: number;
  onChange: (n: number) => void;
  dirty?: boolean;
  saving?: boolean;
  onSave?: () => void;
}

const SUGGESTIONS = [30, 50, 99];

export function DefaultPriceCard({
  value,
  onChange,
  dirty = false,
  saving = false,
  onSave,
}: DefaultPriceCardProps) {
  const t = useTranslations("ipEdit");
  return (
    <PricingCard icon={<IconCoin className="size-4" />} title={t("pricingProjectPackageTitle")}>
      <p className="text-xs text-muted-foreground">{t("pricingProjectPackageHint")}</p>

      <div className="mt-4 flex items-center gap-2">
        <Input
          type="number"
          min={0}
          inputMode="numeric"
          value={String(value)}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            if (Number.isFinite(n) && n >= 0) onChange(n);
            else if (e.target.value === "") onChange(0);
          }}
          className="h-8 w-24 text-center text-sm tabular-nums"
        />
        <span className="text-xs text-muted-foreground">{t("pricingScoreUnit")}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">{t("pricingSuggestionsLabel")}</span>
        {SUGGESTIONS.map((s) => (
          <Button
            key={s}
            type="button"
            variant={value === s ? "soft" : "outline"}
            color={value === s ? "primary" : "muted"}
            size="xs"
            onClick={() => onChange(s)}
          >
            {s}
          </Button>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">{t("pricingProjectPackageBenchmark")}</p>

      {onSave ? (
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            variant={dirty ? "solid" : "outline"}
            color={dirty ? "primary" : "muted"}
            size="sm"
            loading={saving}
            disabled={!dirty}
            onClick={onSave}
          >
            {dirty ? t("pricingSaveProjectPackage") : t("pricingSaved")}
          </Button>
        </div>
      ) : null}
    </PricingCard>
  );
}
