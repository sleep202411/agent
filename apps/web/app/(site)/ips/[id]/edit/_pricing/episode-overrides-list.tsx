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
  savedFreeEpisodeIds: string[];
  savedDefaultPriceIntegral: number;
  savedOverrides: Record<string, number>;
  overrides: Record<string, number>;
  onChangeOverride: (episodeId: string, price: number) => void;
  onClearOverride: (episodeId: string) => void;
  savingEpisodeId?: string | null;
  onSaveEpisode: (episodeId: string) => void;
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
  savedFreeEpisodeIds,
  savedDefaultPriceIntegral,
  savedOverrides,
  overrides,
  onChangeOverride,
  onClearOverride,
  savingEpisodeId,
  onSaveEpisode,
}: EpisodeOverridesListProps) {
  const t = useTranslations("ipEdit");
  const [open, setOpen] = useState(true);
  const freeSet = new Set(freeEpisodeIds);
  const savedFreeSet = new Set(savedFreeEpisodeIds);

  // Trust the array order — `videoNumber` may be 0 / missing from
  // some backend rows. Position is computed as `idx + 1` at render time.
  const unsavedCount = episodes.filter((ep) =>
    episodeDirty({
      episodeId: ep.id,
      freeSet,
      defaultPrice: defaultPriceIntegral,
      overrides,
      savedFreeSet,
      savedDefaultPrice: savedDefaultPriceIntegral,
      savedOverrides,
    })
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
            {unsavedCount > 0
              ? t("pricingUnsavedEpisodeSummary", { n: unsavedCount })
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
                    savedIsFree={savedFreeSet.has(ep.id)}
                    defaultPrice={defaultPriceIntegral}
                    savedDefaultPrice={savedDefaultPriceIntegral}
                    override={overrides[ep.id]}
                    savedOverride={savedOverrides[ep.id]}
                    onChange={(price) => onChangeOverride(ep.id, price)}
                    onClear={() => onClearOverride(ep.id)}
                    saving={savingEpisodeId === ep.id}
                    onSave={() => onSaveEpisode(ep.id)}
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
  savedIsFree: boolean;
  defaultPrice: number;
  savedDefaultPrice: number;
  override: number | undefined;
  savedOverride: number | undefined;
  onChange: (price: number) => void;
  onClear: () => void;
  saving?: boolean;
  onSave: () => void;
}

function OverrideRow({
  episode,
  position,
  isFree,
  savedIsFree,
  defaultPrice,
  savedDefaultPrice,
  override,
  savedOverride,
  onChange,
  onClear,
  saving,
  onSave,
}: OverrideRowProps) {
  const t = useTranslations("ipEdit");
  const hasOverride = typeof override === "number";
  const displayValue = hasOverride ? override : defaultPrice;
  const savedPrice = savedIsFree
    ? 0
    : typeof savedOverride === "number"
      ? savedOverride
      : savedDefaultPrice;
  const currentPrice = isFree ? 0 : displayValue;
  const dirty = currentPrice !== savedPrice;

  return (
    <li
      className={cn(
        "grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2 sm:grid-cols-[3rem_minmax(0,1fr)_auto_auto]",
        dirty
          ? "border-primary/35 bg-primary/[0.04]"
          : hasOverride
            ? "border-blue-400/30 bg-blue-400/5"
            : "border-border/50 bg-secondary/20"
      )}
    >
      <span className="w-12 shrink-0 font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
        EP{String(position).padStart(2, "0")}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {episode.title || t("pricingOverridesUntitled")}
      </span>
      {isFree ? (
        <div className="flex items-center justify-end gap-2">
          <span className="rounded-full border border-green-400/40 bg-green-400/10 px-2 py-0.5 text-xs font-semibold text-green-400">
            {t("pricingFree")}
          </span>
          {dirty ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              {t("pricingUnsaved")}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2">
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
          {dirty ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              {t("pricingUnsaved")}
            </span>
          ) : null}
        </div>
      )}
      <Button
        type="button"
        variant={dirty ? "solid" : "outline"}
        color={dirty ? "primary" : "muted"}
        size="sm"
        loading={saving}
        disabled={!dirty}
        onClick={onSave}
        className="col-span-3 justify-self-end sm:col-span-1"
      >
        {dirty ? t("pricingSaveEpisode") : t("pricingSaved")}
      </Button>
    </li>
  );
}

function episodeDirty({
  episodeId,
  freeSet,
  defaultPrice,
  overrides,
  savedFreeSet,
  savedDefaultPrice,
  savedOverrides,
}: {
  episodeId: string;
  freeSet: Set<string>;
  defaultPrice: number;
  overrides: Record<string, number>;
  savedFreeSet: Set<string>;
  savedDefaultPrice: number;
  savedOverrides: Record<string, number>;
}) {
  const current = freeSet.has(episodeId) ? 0 : (overrides[episodeId] ?? defaultPrice);
  const saved = savedFreeSet.has(episodeId) ? 0 : (savedOverrides[episodeId] ?? savedDefaultPrice);
  return current !== saved;
}
