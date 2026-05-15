"use client";

import { useMemo } from "react";
import { IconGift } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Episode } from "@/app/(site)/ips/_hooks/use-ip";

interface FreePreviewCardProps {
  /** Currently-free episode ids (sparse). */
  value: string[];
  episodes: Episode[];
  onChange: (next: string[]) => void;
}

/**
 * Creator picks any episodes to make free — non-contiguous picks are
 * fine (e.g. EP01, EP05, EP12). This replaces the old "first N free"
 * model which constrained the creator to a contiguous prefix.
 *
 * Layout: scrollable grid of episode chips, each toggleable. Free
 * episodes highlight in green. Top-row actions cover the common
 * shortcuts (select first N / clear all) so power users aren't stuck
 * click-by-click on long IPs.
 */
export function FreePreviewCard({ value, episodes, onChange }: FreePreviewCardProps) {
  const t = useTranslations("ipEdit");
  const freeSet = useMemo(() => new Set(value), [value]);
  const freeCount = freeSet.size;
  const total = episodes.length;
  const allFree = total > 0 && freeCount >= total;

  const toggle = (id: string) => {
    if (freeSet.has(id)) {
      onChange(value.filter((x) => x !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const setFirstN = (n: number) => {
    const ids = episodes.slice(0, n).map((e) => e.id);
    onChange(ids);
  };

  const clearAll = () => onChange([]);

  return (
    <PricingCard icon={<IconGift className="size-4" />} title={t("pricingFreePreviewTitle")}>
      <p className="text-xs text-muted-foreground">{t("pricingFreePreviewHint")}</p>

      {total === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          {t("pricingFreePreviewNoEpisodes")}
        </p>
      ) : (
        <>
          {/* Quick-action shortcuts. "First 3" is the dominant pattern
              in short-drama monetization; offer it as a one-click but
              keep manual toggle as primary. */}
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{t("pricingFreePreviewQuick")}</span>
            {[1, 3, 5].map((n) =>
              n <= total ? (
                <Button
                  key={n}
                  type="button"
                  variant="outline"
                  color="muted"
                  size="xs"
                  onClick={() => setFirstN(n)}
                >
                  {t("pricingFreePreviewFirstN", { n })}
                </Button>
              ) : null
            )}
            {freeCount > 0 ? (
              <Button
                type="button"
                variant="ghost"
                color="muted"
                size="xs"
                onClick={clearAll}
                className="ml-auto"
              >
                {t("pricingFreePreviewClearAll")}
              </Button>
            ) : null}
          </div>

          {/* Episode grid — toggleable chips. max-height keeps the
              card compact even with 100+ episodes; the grid scrolls
              internally. */}
          <div className="mt-3 max-h-44 overflow-y-auto rounded-lg border border-border/60 bg-secondary/20 p-2">
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 md:grid-cols-6">
              {episodes.map((ep, idx) => {
                const isFree = freeSet.has(ep.id);
                const position = idx + 1;
                return (
                  <button
                    key={ep.id}
                    type="button"
                    onClick={() => toggle(ep.id)}
                    title={ep.title || `EP${position}`}
                    aria-pressed={isFree}
                    className={cn(
                      "flex items-center justify-center rounded border px-1.5 py-1 font-mono text-[11px] font-semibold tabular-nums transition-colors",
                      isFree
                        ? "border-green-400/50 bg-green-400/15 text-green-400 hover:bg-green-400/25"
                        : "border-border bg-card text-muted-foreground hover:border-border/80 hover:text-foreground"
                    )}
                  >
                    EP{String(position).padStart(2, "0")}
                  </button>
                );
              })}
            </div>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            {allFree
              ? t("pricingFreePreviewAllFreeWarn")
              : freeCount === 0
                ? t("pricingFreePreviewNoneSelected")
                : t("pricingFreePreviewSummary", { n: freeCount, total })}
          </p>
        </>
      )}
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
