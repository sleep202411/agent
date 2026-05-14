"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { IconExternalLink, IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { useProjectEpisodes } from "@/app/(site)/ips/_hooks/use-ip";
import { useIpPricing, useUpdateIpPricing } from "@/app/(site)/ips/_hooks/use-pricing";
import type { IpPricing } from "@/app/(site)/ips/_hooks/use-pricing";
import { PaywallPreview } from "./paywall-preview";
import { FreePreviewCard } from "./free-preview-card";
import { DefaultPriceCard } from "./default-price-card";
import { BundleDealCard } from "./bundle-deal-card";
import { EpisodeOverridesList } from "./episode-overrides-list";

interface PricingTabProps {
  ipId: string;
  /** Locale segment for the "preview as viewer" deep link. */
  locale: string;
}

/**
 * Pricing tab orchestrator — fetches the current IP's pricing config
 * and episode list, keeps a local draft that the cards mutate, and
 * commits the whole config in one `useUpdateIpPricing` call on Save.
 *
 * The draft pattern matters: tweaking the free-episode slider or the
 * default-price input shouldn't burst-fire mutations. The IP owner
 * iterates locally; the wire is hit once at the end.
 */
export function PricingTab({ ipId, locale }: PricingTabProps) {
  const t = useTranslations("ipEdit");
  const tc = useTranslations("common");

  const { data: episodes = [], isLoading: episodesLoading } = useProjectEpisodes(ipId);
  const { data: remote, isLoading: pricingLoading } = useIpPricing(ipId);
  const updatePricing = useUpdateIpPricing(ipId);

  const [draft, setDraft] = useState<IpPricing | null>(remote ?? null);

  // Sync draft when the remote config (re)loads. Doesn't clobber an
  // in-progress edit because we only adopt remote on first arrival;
  // saves update both via `setQueryData` so this also fires post-save.
  useEffect(() => {
    if (remote) setDraft(remote);
  }, [remote]);

  const dirty = useMemo(() => {
    if (!remote || !draft) return false;
    return JSON.stringify(remote) !== JSON.stringify(draft);
  }, [remote, draft]);

  const handleSave = () => {
    if (!draft || !dirty) return;
    updatePricing.mutate(draft, {
      onSuccess: () => toast.success(t("pricingSaveSuccess")),
      onError: (err) => toast.error(err instanceof Error ? err.message : t("pricingSaveFailed")),
    });
  };

  const handleDiscard = () => {
    if (remote) setDraft(remote);
  };

  if (episodesLoading || pricingLoading || !draft) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        <IconLoader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const totalEpisodes = episodes.length;
  const paidEpisodeCount = Math.max(0, totalEpisodes - draft.freeEpisodeCount);

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
            href={`/${locale}/ip/${ipId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
          >
            <IconExternalLink className="size-3" />
            {t("pricingPreviewAsViewer")}
          </Link>
          {dirty ? (
            <Button
              type="button"
              variant="outline"
              color="muted"
              size="sm"
              onClick={handleDiscard}
              disabled={updatePricing.isPending}
            >
              {tc("discard")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="solid"
            color="primary"
            size="sm"
            onClick={handleSave}
            disabled={!dirty || updatePricing.isPending}
          >
            {updatePricing.isPending ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
            {t("pricingSave")}
          </Button>
        </div>
      </div>

      {/* Top — paywall preview */}
      <PaywallPreview episodes={episodes} pricing={draft} />

      {/* Middle — 3 config cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <FreePreviewCard
          value={draft.freeEpisodeCount}
          totalEpisodes={totalEpisodes}
          onChange={(n) => setDraft({ ...draft, freeEpisodeCount: n })}
        />
        <DefaultPriceCard
          value={draft.defaultPriceIntegral}
          onChange={(n) => setDraft({ ...draft, defaultPriceIntegral: n })}
        />
        <BundleDealCard
          value={draft.bundleIntegral}
          defaultPriceIntegral={draft.defaultPriceIntegral}
          paidEpisodeCount={paidEpisodeCount}
          onChange={(v) => setDraft({ ...draft, bundleIntegral: v })}
        />
      </div>

      {/* Bottom — per-episode overrides */}
      <EpisodeOverridesList
        episodes={episodes}
        freeEpisodeCount={draft.freeEpisodeCount}
        defaultPriceIntegral={draft.defaultPriceIntegral}
        overrides={draft.overrides}
        onChangeOverride={(episodeId, price) => {
          if (price === draft.defaultPriceIntegral) {
            const next = { ...draft.overrides };
            delete next[episodeId];
            setDraft({ ...draft, overrides: next });
          } else {
            setDraft({
              ...draft,
              overrides: { ...draft.overrides, [episodeId]: price },
            });
          }
        }}
        onClearOverride={(episodeId) => {
          const next = { ...draft.overrides };
          delete next[episodeId];
          setDraft({ ...draft, overrides: next });
        }}
      />
    </div>
  );
}
