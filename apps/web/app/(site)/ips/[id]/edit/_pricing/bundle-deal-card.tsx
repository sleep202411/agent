"use client";

import { IconWand, IconTag } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SwitchControl } from "@/components/ui/schema-field/switch-control";
import { PricingCard } from "./free-preview-card";

interface BundleDealCardProps {
  /** `undefined` means the bundle offer is disabled. */
  value: number | undefined;
  /** Default per-episode price — used to compute the auto-suggested
   *  bundle price (paid-count × default × 0.7, rounded). */
  defaultPriceIntegral: number;
  /** Number of paid episodes — `totalEpisodes - freeEpisodeCount`. */
  paidEpisodeCount: number;
  onChange: (next: number | undefined) => void;
  dirty: boolean;
  saving?: boolean;
  onSave: () => void;
}

const BUNDLE_DISCOUNT = 0.7;

export function BundleDealCard({
  value,
  defaultPriceIntegral,
  paidEpisodeCount,
  onChange,
  dirty,
  saving,
  onSave,
}: BundleDealCardProps) {
  const t = useTranslations("ipEdit");
  const enabled = value != null;
  const suggested =
    paidEpisodeCount > 0 && defaultPriceIntegral > 0
      ? Math.max(1, Math.round(paidEpisodeCount * defaultPriceIntegral * BUNDLE_DISCOUNT))
      : 0;

  return (
    <PricingCard icon={<IconTag className="size-4" />} title={t("pricingBundleTitle")}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t("pricingBundleHint")}</p>
        <SwitchControl
          value={enabled}
          onChange={(checked) => onChange(checked ? suggested || 1 : undefined)}
        />
      </div>

      {enabled ? (
        <>
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
            {suggested > 0 ? (
              <Button
                type="button"
                variant="outline"
                color="primary"
                size="xs"
                className="ml-1"
                onClick={() => onChange(suggested)}
                disabled={value === suggested}
              >
                <IconWand className="size-3" />
                {t("pricingBundleUseSuggestion", { n: suggested })}
              </Button>
            ) : null}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {paidEpisodeCount > 0
              ? t("pricingBundleSummary", { paid: paidEpisodeCount })
              : t("pricingBundleNoPaidEpisodes")}
          </p>
          <p className="mt-1 text-[11px] text-amber-400/80">{t("pricingBundleCoversFuture")}</p>
        </>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">{t("pricingBundleDisabledHint")}</p>
      )}

      <div className="mt-auto flex items-center justify-end pt-4">
        <Button
          type="button"
          variant={dirty ? "solid" : "outline"}
          color={dirty ? "primary" : "muted"}
          size="sm"
          loading={saving}
          disabled={!dirty}
          onClick={onSave}
        >
          {dirty ? t("pricingSaveBundle") : t("pricingSaved")}
        </Button>
      </div>
    </PricingCard>
  );
}
