"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { IconExternalLink, IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { useProjectEpisodes } from "@/app/(site)/ips/_hooks/use-ip";
import {
  useDeletePointPriceRule,
  useIpPricing,
  useSavePointPriceRule,
} from "@/app/(site)/ips/_hooks/use-pricing";
import type { IpPricing } from "@/app/(site)/ips/_hooks/use-pricing";
import { PaywallPreview } from "./paywall-preview";
import { DefaultPriceCard } from "./default-price-card";
import { EpisodeOverridesList } from "./episode-overrides-list";

interface PricingTabProps {
  ipId: string;
  /** Locale segment for the "preview as viewer" deep link. */
  locale: string;
}

/**
 * Pricing tab orchestrator — fetches the current IP's pricing config
 * and episode list, then keeps a local draft that the cards mutate.
 *
 * The draft pattern matters: price inputs should not burst-fire
 * mutations. Java exposes single-target CRUD, so the page saves the
 * project package rule and each episode rule independently.
 */
export function PricingTab({ ipId, locale }: PricingTabProps) {
  const t = useTranslations("ipEdit");
  const tc = useTranslations("common");

  const { data: episodes = [], isLoading: episodesLoading } = useProjectEpisodes(ipId);
  const episodeIds = useMemo(() => episodes.map((episode) => episode.id), [episodes]);
  const { data: remote, isLoading: pricingLoading } = useIpPricing(ipId, episodeIds);
  const saveProjectPackagePrice = useSavePointPriceRule(ipId, episodeIds);
  const saveEpisodePrice = useSavePointPriceRule(ipId, episodeIds);
  const deletePriceRule = useDeletePointPriceRule(ipId, episodeIds);

  const [bundleDraft, setBundleDraft] = useState<number | null>(null);
  const [episodeDrafts, setEpisodeDrafts] = useState<Record<string, number | null>>({});
  const [savingEpisodeId, setSavingEpisodeId] = useState<string | null>(null);

  const draft = useMemo(() => {
    if (!remote) return null;
    const overrides = applyEpisodeDrafts(remote.overrides, episodeDrafts);
    const bundleValue = bundleDraft ?? remote.bundleIntegral ?? 0;
    return {
      ...remote,
      defaultPriceIntegral: 0,
      bundleIntegral: bundleValue > 0 ? bundleValue : undefined,
      freeEpisodeIds: Object.entries(overrides)
        .filter(([, price]) => price <= 0)
        .map(([episodeId]) => episodeId),
      overrides,
    } satisfies IpPricing;
  }, [remote, bundleDraft, episodeDrafts]);

  const dirty = bundleDraft !== null || Object.keys(episodeDrafts).length > 0;

  const handleDiscard = () => {
    setBundleDraft(null);
    setEpisodeDrafts({});
  };

  const handleSaveProjectPackage = async () => {
    if (!remote || !draft) return;
    const nextPrice = bundleDraft ?? remote.bundleIntegral ?? 0;
    try {
      if (nextPrice > 0) {
        await saveProjectPackagePrice.mutateAsync({
          priceType: 1,
          targetId: ipId,
          points: nextPrice,
          existingRule: remote.projectRule,
        });
      } else if (remote.projectRule?.id) {
        await deletePriceRule.mutateAsync({ ruleId: remote.projectRule.id });
      }
      setBundleDraft(null);
      toast.success(t("pricingSaveSuccess"));
    } catch (error) {
      toast.error(errorMessage(error, t("pricingSaveFailed")));
    }
  };

  const handleSaveEpisode = async (episodeId: string) => {
    if (!remote || !draft) return;
    if (!hasOwn(episodeDrafts, episodeId)) return;

    setSavingEpisodeId(episodeId);
    try {
      const draftValue = episodeDrafts[episodeId];
      if (typeof draftValue === "number") {
        await saveEpisodePrice.mutateAsync({
          priceType: 2,
          targetId: episodeId,
          points: draftValue,
          existingRule: remote.episodeRules[episodeId],
        });
      } else {
        const existingRule = remote.episodeRules[episodeId];
        if (existingRule?.id) {
          await deletePriceRule.mutateAsync({ ruleId: existingRule.id });
        }
      }
      setEpisodeDrafts((prev) => omitKey(prev, episodeId));
      toast.success(t("pricingSaveSuccess"));
    } catch (error) {
      toast.error(errorMessage(error, t("pricingSaveFailed")));
    } finally {
      setSavingEpisodeId(null);
    }
  };

  if (episodesLoading || pricingLoading || !draft) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        <IconLoader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const bundleDirty = bundleDraft !== null;
  const bundleValue = bundleDraft ?? remote?.bundleIntegral ?? 0;

  return (
    <div className="space-y-4">
      {/* Header — title + save bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-foreground">{t("pricingTabTitle")}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("pricingTabSubtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/${locale}/ips/${ipId}?preview=pricing`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
          >
            <IconExternalLink className="size-3" />
            {t("pricingPreviewAsViewer")}
          </Link>
          {dirty ? (
            <Button type="button" variant="outline" color="muted" size="sm" onClick={handleDiscard}>
              {tc("discard")}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Top — paywall preview */}
      <PaywallPreview episodes={episodes} pricing={draft} />

      {/* Middle — project-level package rule */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DefaultPriceCard
          value={bundleValue}
          onChange={(n) => {
            setBundleDraft(n === (remote?.bundleIntegral ?? 0) ? null : n);
          }}
          dirty={bundleDirty}
          saving={saveProjectPackagePrice.isPending || deletePriceRule.isPending}
          onSave={handleSaveProjectPackage}
        />
      </div>

      {/* Bottom — per-episode overrides */}
      <EpisodeOverridesList
        episodes={episodes}
        defaultPriceIntegral={draft.defaultPriceIntegral}
        savedOverrides={remote?.overrides ?? {}}
        overrides={draft.overrides}
        onChangeOverride={(episodeId, price) => {
          if (!remote) return;
          setEpisodeDrafts((prev) =>
            nextEpisodeDrafts(prev, episodeId, price, draft.defaultPriceIntegral, remote.overrides)
          );
        }}
        onClearOverride={(episodeId) => {
          if (!remote) return;
          setEpisodeDrafts((prev) =>
            hasOwn(remote.overrides, episodeId)
              ? { ...prev, [episodeId]: null }
              : omitKey(prev, episodeId)
          );
        }}
        savingEpisodeId={savingEpisodeId}
        onSaveEpisode={handleSaveEpisode}
      />
    </div>
  );
}

function applyEpisodeDrafts(
  savedOverrides: Record<string, number>,
  episodeDrafts: Record<string, number | null>
) {
  const next = { ...savedOverrides };
  for (const [episodeId, price] of Object.entries(episodeDrafts)) {
    if (price === null) delete next[episodeId];
    else next[episodeId] = price;
  }
  return next;
}

function nextEpisodeDrafts(
  prev: Record<string, number | null>,
  episodeId: string,
  price: number,
  defaultPrice: number,
  savedOverrides: Record<string, number>
) {
  if (price === defaultPrice) {
    return hasOwn(savedOverrides, episodeId)
      ? { ...prev, [episodeId]: null }
      : omitKey(prev, episodeId);
  }

  if (hasOwn(savedOverrides, episodeId) && savedOverrides[episodeId] === price) {
    return omitKey(prev, episodeId);
  }

  return { ...prev, [episodeId]: price };
}

function omitKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

function hasOwn(record: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
