"use client";

import { useMemo } from "react";
import { IconCoin, IconLock } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import type { Episode } from "@/app/(site)/ips/_hooks/use-ip";
import type { IpPricing } from "@/app/(site)/ips/_hooks/use-pricing";

interface PaywallPreviewProps {
  episodes: Episode[];
  pricing: IpPricing;
}

/**
 * The Pricing tab's visual centerpiece — a horizontal chip rail that
 * shows the IP owner what the viewer-side paywall will look like, at
 * a glance. Free episodes render as outlined chips, paid episodes as
 * locked chips with the resolved price (override > default).
 *
 * No paywall divider in this layout: free episodes can be sparse
 * (e.g. EP01, EP05, EP12), so there's no single line where "free
 * ends and paid begins". The chip color tells the whole story.
 */
export function PaywallPreview({ episodes, pricing }: PaywallPreviewProps) {
  const t = useTranslations("ipEdit");

  const freeSet = useMemo(() => new Set(pricing.freeEpisodeIds), [pricing.freeEpisodeIds]);

  if (episodes.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
        {t("pricingPreviewEmpty")}
      </div>
    );
  }

  const freeCount = episodes.filter((ep) => freeSet.has(ep.id)).length;
  const paidCount = episodes.length - freeCount;
  const allFree = freeCount >= episodes.length;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("pricingPreviewTitle")}
        </h4>
        <div className="text-xs text-muted-foreground">
          {allFree
            ? t("pricingPreviewAllFree")
            : t("pricingPreviewSummary", { free: freeCount, paid: paidCount })}
        </div>
      </div>

      <div className="-mx-1 flex items-stretch gap-2 overflow-x-auto px-1 pb-1">
        {episodes.map((ep, idx) => {
          const position = idx + 1;
          const isFree = freeSet.has(ep.id);
          const override = pricing.overrides[ep.id];
          const resolvedPrice =
            typeof override === "number" ? override : pricing.defaultPriceIntegral;
          // Override of 0 / default of 0 → effectively free even if
          // the episode isn't in the explicit free list. Mirror the
          // access-judgment rules in pricing-spec.md.
          const effectivelyFree = isFree || resolvedPrice === 0;
          return (
            <EpisodeChip
              key={ep.id}
              index={position}
              title={ep.title}
              price={effectivelyFree ? null : resolvedPrice}
              hasOverride={!effectivelyFree && typeof override === "number"}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Internal atoms ────────────────────────────────────

function EpisodeChip({
  index,
  title,
  price,
  hasOverride,
}: {
  index: number;
  title: string;
  price: number | null;
  hasOverride: boolean;
}) {
  const t = useTranslations("ipEdit");
  const isFree = price === null;
  return (
    <div
      className={cn(
        "relative flex w-24 shrink-0 flex-col items-stretch justify-between rounded-lg border px-2 py-2 text-center transition-colors",
        isFree ? "border-green-400/40 bg-green-400/5" : "border-violet-400/40 bg-violet-400/5"
      )}
      title={title || `EP${index}`}
    >
      <div className="flex items-center justify-between text-[10px] font-mono tabular-nums">
        <span className={cn("font-semibold", isFree ? "text-green-400" : "text-violet-400")}>
          EP{String(index).padStart(2, "0")}
        </span>
        {!isFree ? <IconLock className="size-3 text-violet-400/80" /> : null}
      </div>
      <div className="mt-1 line-clamp-1 text-[10px] text-muted-foreground">{title || "—"}</div>
      <div
        className={cn(
          "mt-1.5 flex items-center justify-center gap-0.5 text-xs font-semibold",
          isFree ? "text-green-400" : "text-violet-300"
        )}
      >
        {isFree ? (
          t("pricingFree")
        ) : (
          <>
            <IconCoin className="size-3" />
            <span className="tabular-nums">{price}</span>
            {hasOverride ? <span className="ml-0.5 text-blue-400">*</span> : null}
          </>
        )}
      </div>
    </div>
  );
}
