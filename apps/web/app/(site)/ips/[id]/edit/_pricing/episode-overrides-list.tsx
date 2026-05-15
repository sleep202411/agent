"use client";

import { useState } from "react";
import { IconChevronDown, IconRefresh } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Episode } from "@/app/(site)/ips/_hooks/use-ip";

interface EpisodeOverridesListProps {
  episodes: Episode[];
  freeEpisodeIds: string[];
  defaultPriceIntegral: number;
  overrides: Record<string, number>;
  onChangeOverride: (episodeId: string, price: number) => void;
  onClearOverride: (episodeId: string) => void;
}

/**
 * Collapsible per-episode override editor. The common case (one price
 * for everything) doesn't need this; the panel stays folded by default
 * so it's discoverable but not noisy. Free episodes show a "Free" pill
 * and don't accept input — the IP owner has to un-tick the episode
 * from the Free preview card first if they want to charge for it.
 */
export function EpisodeOverridesList({
  episodes,
  freeEpisodeIds,
  defaultPriceIntegral,
  overrides,
  onChangeOverride,
  onClearOverride,
}: EpisodeOverridesListProps) {
  const t = useTranslations("ipEdit");
  const [open, setOpen] = useState(false);
  const freeSet = new Set(freeEpisodeIds);

  // Trust the array order — `videoNumber` may be 0 / missing from
  // some backend rows. Position is computed as `idx + 1` at render time.
  const overrideCount = Object.keys(overrides).filter(
    (id) => episodes.some((e) => e.id === id) // ignore stale overrides for deleted episodes
  ).length;

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/30"
      >
        <div>
          <div className="text-sm font-semibold text-foreground">{t("pricingOverridesTitle")}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {overrideCount > 0
              ? t("pricingOverridesSummary", { n: overrideCount })
              : t("pricingOverridesEmpty")}
          </div>
        </div>
        <IconChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open ? (
        <div className="border-t border-border/60 px-4 py-3">
          {episodes.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              {t("pricingOverridesNoEpisodes")}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {episodes.map((ep, idx) => {
                const position = idx + 1;
                return (
                  <OverrideRow
                    key={ep.id}
                    episode={ep}
                    position={position}
                    isFree={freeSet.has(ep.id)}
                    defaultPrice={defaultPriceIntegral}
                    override={overrides[ep.id]}
                    onChange={(price) => onChangeOverride(ep.id, price)}
                    onClear={() => onClearOverride(ep.id)}
                  />
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

interface OverrideRowProps {
  episode: Episode;
  /** 1-based position in the episode list (not `episode.videoNumber`,
   *  which the backend leaves at 0 for some rows). */
  position: number;
  isFree: boolean;
  defaultPrice: number;
  override: number | undefined;
  onChange: (price: number) => void;
  onClear: () => void;
}

function OverrideRow({
  episode,
  position,
  isFree,
  defaultPrice,
  override,
  onChange,
  onClear,
}: OverrideRowProps) {
  const t = useTranslations("ipEdit");
  const hasOverride = typeof override === "number";
  const displayValue = hasOverride ? override : defaultPrice;

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2",
        hasOverride ? "border-blue-400/30 bg-blue-400/5" : "border-border/50 bg-secondary/20"
      )}
    >
      <span className="w-12 shrink-0 font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
        EP{String(position).padStart(2, "0")}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {episode.title || t("pricingOverridesUntitled")}
      </span>
      {isFree ? (
        <span className="rounded-full border border-green-400/40 bg-green-400/10 px-2 py-0.5 text-xs font-semibold text-green-400">
          {t("pricingFree")}
        </span>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            value={String(displayValue)}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(n) && n >= 0) onChange(n);
              else if (e.target.value === "") onChange(0);
            }}
            className={cn(
              "h-7 w-20 text-center text-xs tabular-nums",
              hasOverride && "border-blue-400/40"
            )}
          />
          <span className="text-xs text-muted-foreground">{t("pricingScoreUnit")}</span>
          {hasOverride ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={onClear}
              aria-label={t("pricingOverridesReset")}
              title={t("pricingOverridesReset")}
            >
              <IconRefresh className="size-3" />
            </Button>
          ) : null}
        </div>
      )}
    </li>
  );
}
