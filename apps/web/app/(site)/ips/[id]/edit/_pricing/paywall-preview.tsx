"use client";

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
 * locked chips with the resolved price (override wins over default).
 * A dotted divider marks where the paywall begins.
 */
export function PaywallPreview({ episodes, pricing }: PaywallPreviewProps) {
  const t = useTranslations("ipEdit");

  if (episodes.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
        {t("pricingPreviewEmpty")}
      </div>
    );
  }

  // Episodes are persisted in `videoNumber` order; defensive sort
  // keeps the preview correct even if the cache hands us a stale
  // reorder mid-mutation.
  const ordered = [...episodes].sort((a, b) => a.videoNumber - b.videoNumber);
  const freeCount = Math.min(pricing.freeEpisodeCount, ordered.length);
  const allFree = freeCount >= ordered.length;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("pricingPreviewTitle")}
        </h4>
        <div className="text-xs text-muted-foreground">
          {allFree
            ? t("pricingPreviewAllFree")
            : t("pricingPreviewSummary", {
                free: freeCount,
                paid: ordered.length - freeCount,
              })}
        </div>
      </div>

      <div className="-mx-1 flex items-stretch gap-2 overflow-x-auto px-1 pb-1">
        {ordered.map((ep, idx) => {
          const isFree = idx < freeCount;
          const showWall = !isFree && idx === freeCount;
          const override = pricing.overrides[ep.id];
          const price = isFree
            ? null
            : typeof override === "number"
              ? override
              : pricing.defaultPriceIntegral;
          return (
            <div key={ep.id} className="flex items-stretch gap-2">
              {showWall ? <PaywallDivider /> : null}
              <EpisodeChip
                index={ep.videoNumber}
                title={ep.title}
                price={price}
                hasOverride={!isFree && typeof override === "number"}
              />
            </div>
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

function PaywallDivider() {
  const t = useTranslations("ipEdit");
  return (
    <div className="relative flex w-px shrink-0 flex-col items-center self-stretch">
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 border-l-2 border-dashed border-amber-400/70" />
      <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[-90deg] whitespace-nowrap text-[9px] font-bold uppercase tracking-widest text-amber-400">
        {t("pricingPaywallMarker")}
      </span>
    </div>
  );
}
