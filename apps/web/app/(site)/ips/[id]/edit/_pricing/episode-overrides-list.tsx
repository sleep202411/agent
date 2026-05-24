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
  defaultPriceIntegral: number;
  savedOverrides: Record<string, number>;
  overrides: Record<string, number>;
  onChangeOverride: (episodeId: string, price: number) => void;
  onClearOverride: (episodeId: string) => void;
  savingEpisodeId?: string | null;
  onSaveEpisode: (episodeId: string) => void | Promise<void>;
}

/**
 * Collapsible per-episode rule editor. The Java backend exposes
 * single-target price rules only: no batch save and no separate free
 * list. A row without a rule inherits the project default price; a row
 * rule with price 0 means that episode is free.
 */
export function EpisodeOverridesList({
  episodes,
  defaultPriceIntegral,
  savedOverrides,
  overrides,
  onChangeOverride,
  onClearOverride,
  savingEpisodeId,
  onSaveEpisode,
}: EpisodeOverridesListProps) {
  const t = useTranslations("ipEdit");
  const [open, setOpen] = useState(true);

  // Trust the array order — `videoNumber` may be 0 / missing from
  // some backend rows. Position is computed as `idx + 1` at render time.
  const unsavedCount = episodes.filter((ep) =>
    episodeDirty(ep.id, overrides, savedOverrides)
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
                    defaultPrice={defaultPriceIntegral}
                    hasOverride={hasOwn(overrides, ep.id)}
                    override={overrides[ep.id] ?? null}
                    savedHasOverride={hasOwn(savedOverrides, ep.id)}
                    savedOverride={savedOverrides[ep.id] ?? null}
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
  defaultPrice: number;
  hasOverride: boolean;
  override: number | null;
  savedHasOverride: boolean;
  savedOverride: number | null;
  onChange: (price: number) => void;
  onClear: () => void;
  saving?: boolean;
  onSave: () => void;
}

function OverrideRow({
  episode,
  position,
  defaultPrice,
  hasOverride,
  override,
  savedHasOverride,
  savedOverride,
  onChange,
  onClear,
  saving,
  onSave,
}: OverrideRowProps) {
  const t = useTranslations("ipEdit");
  const displayValue = hasOverride ? (override ?? 0) : defaultPrice;
  const dirty =
    hasOverride !== savedHasOverride ||
    (hasOverride && savedHasOverride && (override ?? 0) !== (savedOverride ?? 0));
  const statusLabel = hasOverride
    ? displayValue <= 0
      ? t("pricingExplicitFree")
      : t("pricingCustomPrice")
    : t("pricingInheritedDefault");

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
      <div className="flex flex-wrap items-center justify-end gap-2">
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
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
            hasOverride
              ? displayValue <= 0
                ? "border-green-400/40 bg-green-400/10 text-green-400"
                : "border-blue-400/40 bg-blue-400/10 text-blue-400"
              : "border-border bg-secondary/60 text-muted-foreground"
          )}
        >
          {statusLabel}
        </span>
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

function episodeDirty(
  episodeId: string,
  overrides: Record<string, number>,
  savedOverrides: Record<string, number>
) {
  const currentHasOverride = hasOwn(overrides, episodeId);
  const savedHasOverride = hasOwn(savedOverrides, episodeId);
  if (currentHasOverride !== savedHasOverride) return true;
  if (!currentHasOverride) return false;
  return overrides[episodeId] !== savedOverrides[episodeId];
}

function hasOwn(record: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}
